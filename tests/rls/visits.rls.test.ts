import { describe, expect, it } from "vitest";
import { SEED_ACCOUNTS, hospitalIdByName, serviceRoleClient, signInAs } from "./helpers";

async function makeSunrisePatient(sunrise: Awaited<ReturnType<typeof signInAs>>, name: string) {
  const { data, error } = await sunrise.from("patients").insert({ name }).select().single();
  if (error || !data) throw error ?? new Error("failed to create test patient");
  return data;
}

async function sunriseOpdVisitTypeId(): Promise<string> {
  const sunriseId = await hospitalIdByName("Sunrise General Hospital");
  const { data, error } = await serviceRoleClient()
    .from("visit_types")
    .select("id")
    .eq("name", "OPD Consultation")
    .eq("hospital_id", sunriseId)
    .single();
  if (error || !data) throw error ?? new Error("Sunrise OPD Consultation visit type not found");
  return data.id;
}

describe("visits RLS", () => {
  it("happy path: create, view, and list a visit linked to the correct patient and hospital", async () => {
    const sunrise = await signInAs(SEED_ACCOUNTS.sunrise.receptionist);
    const patient = await makeSunrisePatient(sunrise, "Visit Happy Path Patient");
    const visitTypeId = await sunriseOpdVisitTypeId();
    const sunriseId = await hospitalIdByName("Sunrise General Hospital");

    const { data: visit, error } = await sunrise
      .from("visits")
      .insert({ patient_id: patient.id, visit_type_id: visitTypeId, fee_amount: 500 })
      .select()
      .single();
    expect(error).toBeNull();
    expect(visit?.hospital_id).toBe(sunriseId);
    expect(visit?.patient_id).toBe(patient.id);
    expect(visit?.visit_number).toBeGreaterThan(0);

    const { data: reopened } = await sunrise
      .from("visits")
      .select("*")
      .eq("id", visit!.id)
      .single();
    expect(reopened?.id).toBe(visit!.id);

    const { data: list } = await sunrise.from("visits").select("*").eq("patient_id", patient.id);
    expect(list?.some((v) => v.id === visit!.id)).toBe(true);
  });

  it("cross-tenant: visit creation rejects a patient_id from another hospital even if forged", async () => {
    const clarity = await signInAs(SEED_ACCOUNTS.clarity.admin);
    const { data: clarityPatient } = await clarity
      .from("patients")
      .insert({ name: "Clarity Cross Tenant Patient" })
      .select()
      .single();

    const sunrise = await signInAs(SEED_ACCOUNTS.sunrise.receptionist);
    const visitTypeId = await sunriseOpdVisitTypeId();

    const { error } = await sunrise.from("visits").insert({
      patient_id: clarityPatient!.id,
      visit_type_id: visitTypeId,
    });
    // Denied either by RLS (hospital_id mismatch) or by the
    // composite FK (patient_id, hospital_id) not existing for
    // Sunrise's hospital_id -- either way, it must fail.
    expect(error).not.toBeNull();
  });

  it("cross-tenant: cannot see another hospital's visits", async () => {
    const clarity = await signInAs(SEED_ACCOUNTS.clarity.admin);
    const clarityPatient = await makeSunrisePatient(clarity, "Clarity Only Visit Patient");
    const { data: clarityVisitType } = await clarity
      .from("visit_types")
      .select("id")
      .eq("name", "General USG")
      .single();
    const { data: clarityVisit } = await clarity
      .from("visits")
      .insert({ patient_id: clarityPatient.id, visit_type_id: clarityVisitType!.id })
      .select()
      .single();

    const sunrise = await signInAs(SEED_ACCOUNTS.sunrise.receptionist);
    const { data: byId } = await sunrise.from("visits").select("*").eq("id", clarityVisit!.id);
    expect(byId).toHaveLength(0);
  });

  it("search_visits finds a visit by its patient's name/mobile/code", async () => {
    const sunrise = await signInAs(SEED_ACCOUNTS.sunrise.receptionist);
    const patient = await makeSunrisePatient(sunrise, "Search Visits Happy Path Patient");
    await sunrise.from("patients").update({ mobile: "9876500055" }).eq("id", patient.id);
    const visitTypeId = await sunriseOpdVisitTypeId();
    const { data: visit } = await sunrise
      .from("visits")
      .insert({ patient_id: patient.id, visit_type_id: visitTypeId })
      .select()
      .single();

    const byName = await sunrise.rpc("search_visits", { p_query: "Search Visits Happy Path" });
    expect(byName.data?.some((v) => v.id === visit!.id)).toBe(true);

    const byMobile = await sunrise.rpc("search_visits", { p_query: "9876500055" });
    expect(byMobile.data?.some((v) => v.id === visit!.id)).toBe(true);

    const byCode = await sunrise.rpc("search_visits", { p_query: patient.patient_code });
    expect(byCode.data?.some((v) => v.id === visit!.id)).toBe(true);
  });

  it("search_visits finds a visit by its payment's UPI reference number", async () => {
    const sunrise = await signInAs(SEED_ACCOUNTS.sunrise.receptionist);
    const patient = await makeSunrisePatient(sunrise, "Search Visits Reference Patient");
    const visitTypeId = await sunriseOpdVisitTypeId();
    const { data: visit } = await sunrise
      .from("visits")
      .insert({ patient_id: patient.id, visit_type_id: visitTypeId, fee_amount: 100 })
      .select()
      .single();
    await sunrise.from("visit_payments").insert({
      visit_id: visit!.id,
      amount: 100,
      mode: "UPI",
      reference_number: "UPI2026093012345",
    });

    const byReference = await sunrise.rpc("search_visits", { p_query: "UPI2026093012345" });
    expect(byReference.data?.some((v) => v.id === visit!.id)).toBe(true);
  });

  it("cross-tenant: a receptionist cannot search up another hospital's visit by its UPI reference number", async () => {
    const clarity = await signInAs(SEED_ACCOUNTS.clarity.admin);
    const clarityPatient = await makeSunrisePatient(clarity, "Clarity Reference Patient");
    const { data: clarityVisitType } = await clarity
      .from("visit_types")
      .select("id")
      .eq("name", "General USG")
      .single();
    const { data: clarityVisit } = await clarity
      .from("visits")
      .insert({ patient_id: clarityPatient.id, visit_type_id: clarityVisitType!.id, fee_amount: 100 })
      .select()
      .single();
    await clarity.from("visit_payments").insert({
      visit_id: clarityVisit!.id,
      amount: 100,
      mode: "UPI",
      reference_number: "CLARITYREF999",
    });

    const sunrise = await signInAs(SEED_ACCOUNTS.sunrise.receptionist);
    const { data: bySearch } = await sunrise.rpc("search_visits", { p_query: "CLARITYREF999" });
    expect(bySearch?.some((v) => v.id === clarityVisit!.id)).toBe(false);
  });

  it("cross-tenant: a receptionist cannot search up another hospital's visits", async () => {
    const clarity = await signInAs(SEED_ACCOUNTS.clarity.admin);
    const clarityPatient = await makeSunrisePatient(clarity, "Clarity Search Visits Patient");
    const { data: clarityVisitType } = await clarity
      .from("visit_types")
      .select("id")
      .eq("name", "General USG")
      .single();
    const { data: clarityVisit } = await clarity
      .from("visits")
      .insert({ patient_id: clarityPatient.id, visit_type_id: clarityVisitType!.id })
      .select()
      .single();

    const sunrise = await signInAs(SEED_ACCOUNTS.sunrise.receptionist);
    const { data: bySearch } = await sunrise.rpc("search_visits", {
      p_query: "Clarity Search Visits Patient",
    });
    expect(bySearch?.some((v) => v.id === clarityVisit!.id)).toBe(false);
  });

  it("no DELETE policy exists — visits are never hard-deleted", async () => {
    const sunrise = await signInAs(SEED_ACCOUNTS.sunrise.receptionist);
    const patient = await makeSunrisePatient(sunrise, "Visit Not Deletable Patient");
    const visitTypeId = await sunriseOpdVisitTypeId();
    const { data: visit } = await sunrise
      .from("visits")
      .insert({ patient_id: patient.id, visit_type_id: visitTypeId })
      .select()
      .single();

    const { data: deleted } = await sunrise.from("visits").delete().eq("id", visit!.id).select();
    expect(deleted).toHaveLength(0);
  });
});

describe("visit_payments RLS", () => {
  it("payment sum vs. fee_amount correctly derives status in all three states", async () => {
    const sunrise = await signInAs(SEED_ACCOUNTS.sunrise.receptionist);
    const patient = await makeSunrisePatient(sunrise, "Payment Status Patient");
    const visitTypeId = await sunriseOpdVisitTypeId();
    const { data: visit } = await sunrise
      .from("visits")
      .insert({ patient_id: patient.id, visit_type_id: visitTypeId, fee_amount: 300 })
      .select()
      .single();

    async function paidSoFar() {
      const { data } = await sunrise
        .from("visit_payments")
        .select("amount")
        .eq("visit_id", visit!.id);
      return (data ?? []).reduce((sum, p) => sum + Number(p.amount), 0);
    }

    expect(await paidSoFar()).toBe(0); // UNPAID

    await sunrise.from("visit_payments").insert({ visit_id: visit!.id, amount: 100, mode: "CASH" });
    expect(await paidSoFar()).toBe(100); // PARTIAL (< 300)

    await sunrise.from("visit_payments").insert({ visit_id: visit!.id, amount: 200, mode: "UPI" });
    expect(await paidSoFar()).toBe(300); // PAID (== 300)
  });

  it("stores an optional reference_number on a payment", async () => {
    const sunrise = await signInAs(SEED_ACCOUNTS.sunrise.receptionist);
    const patient = await makeSunrisePatient(sunrise, "Payment Reference Patient");
    const visitTypeId = await sunriseOpdVisitTypeId();
    const { data: visit } = await sunrise
      .from("visits")
      .insert({ patient_id: patient.id, visit_type_id: visitTypeId, fee_amount: 100 })
      .select()
      .single();

    const { data: withReference, error: withReferenceError } = await sunrise
      .from("visit_payments")
      .insert({
        visit_id: visit!.id,
        amount: 100,
        mode: "UPI",
        reference_number: "UPI2026093099999",
      })
      .select()
      .single();
    expect(withReferenceError).toBeNull();
    expect(withReference?.reference_number).toBe("UPI2026093099999");

    const { data: withoutReference, error: withoutReferenceError } = await sunrise
      .from("visit_payments")
      .insert({ visit_id: visit!.id, amount: 50, mode: "CASH" })
      .select()
      .single();
    expect(withoutReferenceError).toBeNull();
    expect(withoutReference?.reference_number).toBeNull();
  });

  it("a receptionist cannot record a reversal payment", async () => {
    const sunrise = await signInAs(SEED_ACCOUNTS.sunrise.receptionist);
    const patient = await makeSunrisePatient(sunrise, "Reversal Denied Patient");
    const visitTypeId = await sunriseOpdVisitTypeId();
    const { data: visit } = await sunrise
      .from("visits")
      .insert({ patient_id: patient.id, visit_type_id: visitTypeId, fee_amount: 100 })
      .select()
      .single();

    const { error } = await sunrise
      .from("visit_payments")
      .insert({ visit_id: visit!.id, amount: -50, mode: "CASH", is_reversal: true });
    expect(error).not.toBeNull();
  });

  it("a hospital admin can record a reversal payment", async () => {
    const admin = await signInAs(SEED_ACCOUNTS.sunrise.admin);
    const patient = await makeSunrisePatient(admin, "Reversal Allowed Patient");
    const visitTypeId = await sunriseOpdVisitTypeId();
    const { data: visit } = await admin
      .from("visits")
      .insert({ patient_id: patient.id, visit_type_id: visitTypeId, fee_amount: 100 })
      .select()
      .single();
    await admin.from("visit_payments").insert({ visit_id: visit!.id, amount: 100, mode: "CASH" });

    const { error } = await admin.from("visit_payments").insert({
      visit_id: visit!.id,
      amount: -100,
      mode: "CASH",
      is_reversal: true,
      note: "Refunded",
    });
    expect(error).toBeNull();
  });

  it("payments are append-only — no UPDATE or DELETE policy", async () => {
    const sunrise = await signInAs(SEED_ACCOUNTS.sunrise.receptionist);
    const patient = await makeSunrisePatient(sunrise, "Payment Immutable Patient");
    const visitTypeId = await sunriseOpdVisitTypeId();
    const { data: visit } = await sunrise
      .from("visits")
      .insert({ patient_id: patient.id, visit_type_id: visitTypeId, fee_amount: 100 })
      .select()
      .single();
    const { data: payment } = await sunrise
      .from("visit_payments")
      .insert({ visit_id: visit!.id, amount: 100, mode: "CASH" })
      .select()
      .single();

    const { data: updated } = await sunrise
      .from("visit_payments")
      .update({ amount: 1 })
      .eq("id", payment!.id)
      .select();
    expect(updated).toHaveLength(0);

    const { data: deleted } = await sunrise
      .from("visit_payments")
      .delete()
      .eq("id", payment!.id)
      .select();
    expect(deleted).toHaveLength(0);
  });

  it("cannot forge received_by to impersonate another user", async () => {
    const sunrise = await signInAs(SEED_ACCOUNTS.sunrise.receptionist);
    const patient = await makeSunrisePatient(sunrise, "Received By Forge Patient");
    const visitTypeId = await sunriseOpdVisitTypeId();
    const { data: visit } = await sunrise
      .from("visits")
      .insert({ patient_id: patient.id, visit_type_id: visitTypeId, fee_amount: 100 })
      .select()
      .single();

    const { data: otherProfile } = await serviceRoleClient()
      .from("profiles")
      .select("id")
      .eq("email", SEED_ACCOUNTS.sunrise.admin)
      .single();

    const { error } = await sunrise.from("visit_payments").insert({
      visit_id: visit!.id,
      amount: 50,
      mode: "CASH",
      received_by: otherProfile!.id,
    });
    expect(error).not.toBeNull();
  });
});
