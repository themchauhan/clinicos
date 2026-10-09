import { describe, expect, it } from "vitest";
import { SEED_ACCOUNTS, hospitalIdByName, serviceRoleClient, signInAs } from "./helpers";

type Client = Awaited<ReturnType<typeof signInAs>>;

const FAKE_PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);

function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function makePatient(client: Client, extra: Record<string, unknown> = {}) {
  const { data, error } = await client
    .from("patients")
    .insert({ name: "Form F Support Test Patient", ...extra })
    .select()
    .single();
  if (error || !data) throw error ?? new Error("failed to create test patient");
  return data;
}

async function makeVisit(client: Client, patientId: string) {
  const sunriseId = await hospitalIdByName("Sunrise General Hospital");
  const { data: type } = await serviceRoleClient()
    .from("visit_types")
    .select("id")
    .eq("hospital_id", sunriseId)
    .eq("name", "OPD Consultation")
    .single();
  const { data, error } = await client
    .from("visits")
    .insert({ patient_id: patientId, visit_type_id: type!.id, fee_amount: 100 })
    .select()
    .single();
  if (error || !data) throw error ?? new Error("failed to create test visit");
  return data;
}

async function makeTemplate(client: Client, extra: Record<string, unknown> = {}) {
  const patient = await makePatient(client);
  const storagePath = `${patient.hospital_id}/form-templates/${crypto.randomUUID()}.pdf`;
  const { error: uploadError } = await client.storage
    .from("documents")
    .upload(storagePath, FAKE_PDF, { contentType: "application/pdf" });
  if (uploadError) throw uploadError;
  return client
    .from("form_templates")
    .insert({
      name: "Form F support test",
      storage_path: storagePath,
      page_width: 595,
      page_height: 842,
      signature_x: 50,
      signature_y: 100,
      signature_width: 150,
      signature_height: 50,
      ...extra,
    })
    .select()
    .single();
}

describe("patients: children counts (Form F item 4)", () => {
  it("happy path: counts and ages save and read back", async () => {
    const sunrise = await signInAs(SEED_ACCOUNTS.sunrise.receptionist);
    const p = await makePatient(sunrise, {
      living_sons: 1,
      living_sons_ages: "4 yrs",
      living_daughters: 0,
    });
    expect(p.living_sons).toBe(1);
    expect(p.living_sons_ages).toBe("4 yrs");
    expect(p.living_daughters).toBe(0);
    expect(p.living_daughters_ages).toBeNull();
  });

  it("rejects a negative or absurd count and an over-long ages note", async () => {
    const sunrise = await signInAs(SEED_ACCOUNTS.sunrise.receptionist);
    const bad = [
      { living_sons: -1 },
      { living_daughters: 31 },
      { living_sons_ages: "x".repeat(201) },
    ];
    for (const extra of bad) {
      const { error } = await sunrise.from("patients").insert({ name: "Bad Children", ...extra });
      expect(error, JSON.stringify(extra)).not.toBeNull();
    }
  });

  it("cross-tenant: another hospital cannot read or change the children data", async () => {
    const sunrise = await signInAs(SEED_ACCOUNTS.sunrise.receptionist);
    const p = await makePatient(sunrise, { living_sons: 2 });

    const clarity = await signInAs(SEED_ACCOUNTS.clarity.receptionist);
    const { data: seen } = await clarity.from("patients").select("living_sons").eq("id", p.id);
    expect(seen).toHaveLength(0);

    await clarity.from("patients").update({ living_sons: 9 }).eq("id", p.id);
    const { data: still } = await sunrise.from("patients").select("living_sons").eq("id", p.id);
    expect(still?.[0]?.living_sons).toBe(2);
  });
});

describe("visits: last menstrual period", () => {
  it("happy path: a plausible LMP saves", async () => {
    const sunrise = await signInAs(SEED_ACCOUNTS.sunrise.receptionist);
    const visit = await makeVisit(sunrise, (await makePatient(sunrise)).id);
    const lmp = shiftDate(visit.visit_date, -90);
    const { error } = await sunrise.from("visits").update({ lmp_date: lmp }).eq("id", visit.id);
    expect(error).toBeNull();
    const { data } = await sunrise.from("visits").select("lmp_date").eq("id", visit.id).single();
    expect(data?.lmp_date).toBe(lmp);
  });

  it("rejects an LMP after the visit or more than 330 days before it", async () => {
    const sunrise = await signInAs(SEED_ACCOUNTS.sunrise.receptionist);
    const visit = await makeVisit(sunrise, (await makePatient(sunrise)).id);
    for (const lmp of [shiftDate(visit.visit_date, 1), shiftDate(visit.visit_date, -331)]) {
      const { error } = await sunrise.from("visits").update({ lmp_date: lmp }).eq("id", visit.id);
      expect(error, lmp).not.toBeNull();
    }
  });

  it("cross-tenant: another hospital cannot set a visit's LMP", async () => {
    const sunrise = await signInAs(SEED_ACCOUNTS.sunrise.receptionist);
    const visit = await makeVisit(sunrise, (await makePatient(sunrise)).id);
    const clarity = await signInAs(SEED_ACCOUNTS.clarity.receptionist);
    await clarity
      .from("visits")
      .update({ lmp_date: shiftDate(visit.visit_date, -60) })
      .eq("id", visit.id);
    const { data } = await sunrise.from("visits").select("lmp_date").eq("id", visit.id).single();
    expect(data?.lmp_date).toBeNull();
  });
});

describe("form templates: checklist fields, tick marks and extra stamps", () => {
  const stamp = { kind: "SEAL", page: 4, x: 1, y: 1, width: 10, height: 10 };

  it("happy path: extra stamps and a checklist field with tick marks round-trip", async () => {
    const sunrise = await signInAs(SEED_ACCOUNTS.sunrise.admin);
    const { data: template, error } = await makeTemplate(sunrise, { extra_stamps: [stamp] });
    expect(error).toBeNull();
    expect(template?.extra_stamps).toEqual([stamp]);

    const { data: field, error: fieldError } = await sunrise
      .from("form_template_fields")
      .insert({
        form_template_id: template!.id,
        field_key: "indications",
        label: "Indications",
        input_type: "checklist",
        checklist_key: "pcpndt_indications",
        tick_marks: [{ code: "ii", page: 2, x: 36, y: 733 }],
        x: 50,
        y: 100,
      })
      .select()
      .single();
    expect(fieldError).toBeNull();
    expect(field?.tick_marks).toEqual([{ code: "ii", page: 2, x: 36, y: 733 }]);
  });

  it("rejects more than 12 extra stamps and a non-array value", async () => {
    const sunrise = await signInAs(SEED_ACCOUNTS.sunrise.admin);
    const tooMany = await makeTemplate(sunrise, { extra_stamps: Array(13).fill(stamp) });
    expect(tooMany.error).not.toBeNull();
    const notArray = await makeTemplate(sunrise, { extra_stamps: { kind: "SEAL" } });
    expect(notArray.error).not.toBeNull();
  });

  it("keeps checklist_key and tick_marks tied to the checklist type", async () => {
    const sunrise = await signInAs(SEED_ACCOUNTS.sunrise.admin);
    const { data: template } = await makeTemplate(sunrise);
    const base = { form_template_id: template!.id, label: "L", x: 1, y: 1 };

    const checklistWithoutKey = await sunrise
      .from("form_template_fields")
      .insert({ ...base, field_key: "a", input_type: "checklist" });
    expect(checklistWithoutKey.error).not.toBeNull();

    const textWithKey = await sunrise
      .from("form_template_fields")
      .insert({ ...base, field_key: "b", input_type: "text", checklist_key: "pcpndt_indications" });
    expect(textWithKey.error).not.toBeNull();

    const textWithTicks = await sunrise.from("form_template_fields").insert({
      ...base,
      field_key: "c",
      input_type: "text",
      tick_marks: [{ code: "i", page: 1, x: 1, y: 1 }],
    });
    expect(textWithTicks.error).not.toBeNull();

    const tickOk = await sunrise
      .from("form_template_fields")
      .insert({ ...base, field_key: "d", input_type: "tick" });
    expect(tickOk.error).toBeNull();
  });

  it("cross-tenant: another hospital cannot read the stamps or add fields to the template", async () => {
    const sunrise = await signInAs(SEED_ACCOUNTS.sunrise.admin);
    const { data: template } = await makeTemplate(sunrise, { extra_stamps: [stamp] });

    const clarity = await signInAs(SEED_ACCOUNTS.clarity.admin);
    const { data: seen } = await clarity
      .from("form_templates")
      .select("extra_stamps")
      .eq("id", template!.id);
    expect(seen).toHaveLength(0);

    const { error } = await clarity.from("form_template_fields").insert({
      form_template_id: template!.id,
      field_key: "x",
      label: "X",
      input_type: "checklist",
      checklist_key: "pcpndt_indications",
      x: 1,
      y: 1,
    });
    expect(error).not.toBeNull();
  });
});
