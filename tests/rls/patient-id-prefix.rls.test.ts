import { describe, expect, it } from "vitest";
import { SEED_ACCOUNTS, hospitalIdByName, serviceRoleClient, signInAs } from "./helpers";

async function makeCentre(name: string): Promise<{ id: string; prefix: string }> {
  const { data, error } = await serviceRoleClient()
    .from("hospitals")
    .insert({ name })
    .select("id, patient_id_prefix")
    .single();
  if (error || !data) throw error ?? new Error("could not create test centre");
  return { id: data.id, prefix: data.patient_id_prefix };
}

async function addPatient(hospitalId: string, code: string, name: string) {
  const { error } = await serviceRoleClient()
    .from("patients")
    .insert({ hospital_id: hospitalId, patient_code: code, name });
  if (error) throw error;
}

describe("patient ID prefix", () => {
  it("a new centre gets a prefix suggested from its name", async () => {
    const centre = await makeCentre("Clarity Clinics");
    // "Clarity Clinics" -> CLC (with a number appended if an earlier
    // test run already claimed it).
    expect(centre.prefix).toMatch(/^CLC\d*$/);
  });

  it("registering a patient yields prefix + at least 3 digits for the caller's own hospital", async () => {
    const sunrise = await signInAs(SEED_ACCOUNTS.sunrise.receptionist);
    const { data: patient } = await sunrise
      .from("patients")
      .insert({ name: "Prefix Code Testperson" })
      .select("patient_code")
      .single();
    const { data: hospital } = await serviceRoleClient()
      .from("hospitals")
      .select("patient_id_prefix")
      .eq("id", await hospitalIdByName("Sunrise General Hospital"))
      .single();
    expect(patient?.patient_code.startsWith(hospital!.patient_id_prefix)).toBe(true);
    expect(patient?.patient_code.slice(hospital!.patient_id_prefix.length)).toMatch(/^\d{3,}$/);
  });

  it("a HOSPITAL_ADMIN cannot change a prefix, not even their own", async () => {
    const admin = await signInAs(SEED_ACCOUNTS.sunrise.admin);
    const sunriseId = await hospitalIdByName("Sunrise General Hospital");
    const { error } = await admin.rpc("set_hospital_patient_prefix", {
      p_hospital_id: sunriseId,
      p_prefix: "HACK",
    });
    expect(error).not.toBeNull();

    const { data } = await serviceRoleClient()
      .from("hospitals")
      .select("patient_id_prefix, patient_id_prefix_locked")
      .eq("id", sunriseId)
      .single();
    expect(data?.patient_id_prefix).not.toBe("HACK");
    expect(data?.patient_id_prefix_locked).toBe(false);
  });

  it("a platform admin can change it once: existing IDs are relabelled, then it is locked", async () => {
    const centre = await makeCentre("Prefix Once Test Centre");
    const other = await makeCentre("Prefix Bystander Test Centre");
    await addPatient(centre.id, `${centre.prefix}001`, "Prefix Once Testperson A");
    await addPatient(centre.id, `${centre.prefix}1000`, "Prefix Once Testperson B");
    await addPatient(other.id, `${other.prefix}001`, "Prefix Bystander Testperson");

    const platform = await signInAs(SEED_ACCOUNTS.platformAdmin);
    const wanted = `Z${String(Date.now()).slice(-4)}`;
    const first = await platform.rpc("set_hospital_patient_prefix", {
      p_hospital_id: centre.id,
      p_prefix: wanted.toLowerCase(),
    });
    expect(first.error).toBeNull();

    const sr = serviceRoleClient();
    const { data: patients } = await sr
      .from("patients")
      .select("patient_code")
      .eq("hospital_id", centre.id)
      .order("patient_code");
    expect(patients?.map((p) => p.patient_code).sort()).toEqual(
      [`${wanted}001`, `${wanted}1000`].sort(),
    );

    // Locked now: a second change is refused and nothing moves.
    const second = await platform.rpc("set_hospital_patient_prefix", {
      p_hospital_id: centre.id,
      p_prefix: "AGAIN",
    });
    expect(second.error?.message).toMatch(/locked/);
    const { data: after } = await sr
      .from("hospitals")
      .select("patient_id_prefix, patient_id_prefix_locked")
      .eq("id", centre.id)
      .single();
    expect(after).toEqual({ patient_id_prefix: wanted, patient_id_prefix_locked: true });

    // Cross-tenant: the other centre is untouched.
    const { data: bystander } = await sr
      .from("patients")
      .select("patient_code")
      .eq("hospital_id", other.id);
    expect(bystander?.map((p) => p.patient_code)).toEqual([`${other.prefix}001`]);
  });

  it("rejects a prefix already used by another centre, and malformed ones", async () => {
    const centre = await makeCentre("Prefix Clash Test Centre");
    const platform = await signInAs(SEED_ACCOUNTS.platformAdmin);

    const clash = await platform.rpc("set_hospital_patient_prefix", {
      p_hospital_id: centre.id,
      p_prefix: "SGH",
    });
    expect(clash.error?.message).toMatch(/already used/);

    const bad = await platform.rpc("set_hospital_patient_prefix", {
      p_hospital_id: centre.id,
      p_prefix: "no spaces!",
    });
    expect(bad.error).not.toBeNull();
  });
});
