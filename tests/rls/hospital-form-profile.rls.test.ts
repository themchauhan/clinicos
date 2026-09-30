import { describe, expect, it } from "vitest";
import { SEED_ACCOUNTS, signInAs, hospitalIdByName } from "./helpers";

describe("hospital_form_profile RLS", () => {
  it("happy path: HOSPITAL_ADMIN can upsert and read back their own hospital's profile", async () => {
    const sunrise = await signInAs(SEED_ACCOUNTS.sunrise.admin);
    const hospitalId = await hospitalIdByName("Sunrise General Hospital");

    const { error: upsertError } = await sunrise
      .from("hospital_form_profile")
      .upsert(
        { hospital_id: hospitalId, registration_no: "PCPNDT-SUNRISE-1" },
        { onConflict: "hospital_id" },
      );
    expect(upsertError).toBeNull();

    const { data: reopened } = await sunrise
      .from("hospital_form_profile")
      .select("*")
      .eq("hospital_id", hospitalId)
      .single();
    expect(reopened?.registration_no).toBe("PCPNDT-SUNRISE-1");

    // Upserting again (the "save details" form re-submitting) updates
    // the same singleton row rather than erroring on the PK conflict.
    const { error: secondUpsertError } = await sunrise
      .from("hospital_form_profile")
      .upsert(
        { hospital_id: hospitalId, registration_no: "PCPNDT-SUNRISE-2" },
        { onConflict: "hospital_id" },
      );
    expect(secondUpsertError).toBeNull();

    const { data: updated } = await sunrise
      .from("hospital_form_profile")
      .select("registration_no")
      .eq("hospital_id", hospitalId)
      .single();
    expect(updated?.registration_no).toBe("PCPNDT-SUNRISE-2");
  });

  it("cross-tenant: another hospital cannot read or write this hospital's profile", async () => {
    const sunrise = await signInAs(SEED_ACCOUNTS.sunrise.admin);
    const hospitalId = await hospitalIdByName("Sunrise General Hospital");
    await sunrise
      .from("hospital_form_profile")
      .upsert(
        { hospital_id: hospitalId, registration_no: "PCPNDT-SUNRISE-3" },
        { onConflict: "hospital_id" },
      );

    const clarity = await signInAs(SEED_ACCOUNTS.clarity.admin);
    const { data: rows } = await clarity
      .from("hospital_form_profile")
      .select("*")
      .eq("hospital_id", hospitalId);
    expect(rows).toHaveLength(0);

    // Attempting to write a row explicitly tagged with Sunrise's
    // hospital_id is rejected by the INSERT policy's WITH CHECK, not
    // just invisible afterwards.
    const { error: crossWriteError } = await clarity
      .from("hospital_form_profile")
      .upsert(
        { hospital_id: hospitalId, registration_no: "HIJACKED" },
        { onConflict: "hospital_id" },
      );
    expect(crossWriteError).not.toBeNull();

    // The row is untouched.
    const { data: stillSunrises } = await sunrise
      .from("hospital_form_profile")
      .select("registration_no")
      .eq("hospital_id", hospitalId)
      .single();
    expect(stillSunrises?.registration_no).toBe("PCPNDT-SUNRISE-3");
  });

  it("no DELETE policy -- clear fields via update instead", async () => {
    const sunrise = await signInAs(SEED_ACCOUNTS.sunrise.admin);
    const hospitalId = await hospitalIdByName("Sunrise General Hospital");
    await sunrise
      .from("hospital_form_profile")
      .upsert(
        { hospital_id: hospitalId, registration_no: "PCPNDT-SUNRISE-4" },
        { onConflict: "hospital_id" },
      );

    const { data: deleted } = await sunrise
      .from("hospital_form_profile")
      .delete()
      .eq("hospital_id", hospitalId)
      .select();
    expect(deleted).toHaveLength(0);

    const { data: updated, error } = await sunrise
      .from("hospital_form_profile")
      .update({ registration_no: null })
      .eq("hospital_id", hospitalId)
      .select()
      .single();
    expect(error).toBeNull();
    expect(updated?.registration_no).toBeNull();
  });
});
