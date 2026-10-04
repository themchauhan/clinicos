import { describe, expect, it } from "vitest";
import { SEED_ACCOUNTS, hospitalIdByName, signInAs } from "./helpers";

describe("patients RLS", () => {
  it("happy path: create a patient, find them by name/mobile/code, open the same profile", async () => {
    const sunrise = await signInAs(SEED_ACCOUNTS.sunrise.receptionist);

    const { data: created, error: createError } = await sunrise
      .from("patients")
      .insert({ name: "Ramesh Kumar Testperson", mobile: "9876500001", gender: "MALE" })
      .select()
      .single();
    expect(createError).toBeNull();
    expect(created?.patient_code).toMatch(/^[A-Z0-9]{2,6}\d{3,}$/);
    expect(created?.hospital_id).toBe(await hospitalIdByName("Sunrise General Hospital"));

    const byName = await sunrise.rpc("search_patients", { p_query: "Ramesh Kumar" });
    expect(byName.data?.some((p) => p.id === created!.id)).toBe(true);

    const byMobile = await sunrise.rpc("search_patients", { p_query: "9876500001" });
    expect(byMobile.data?.some((p) => p.id === created!.id)).toBe(true);

    const byCode = await sunrise.rpc("search_patients", { p_query: created!.patient_code });
    expect(byCode.data?.some((p) => p.id === created!.id)).toBe(true);

    const { data: reopened } = await sunrise
      .from("patients")
      .select("*")
      .eq("id", created!.id)
      .single();
    expect(reopened?.id).toBe(created!.id);
  });

  it("guardian relationship: a valid value saves, null is allowed, an unknown value is rejected", async () => {
    const sunrise = await signInAs(SEED_ACCOUNTS.sunrise.receptionist);

    const { data: withRelation, error } = await sunrise
      .from("patients")
      .insert({
        name: "Guardian Relation Testperson",
        guardian_name: "Test Guardian",
        guardian_relation: "W/O",
      })
      .select()
      .single();
    expect(error).toBeNull();
    expect(withRelation?.guardian_relation).toBe("W/O");

    const { data: withoutRelation, error: nullError } = await sunrise
      .from("patients")
      .insert({ name: "Guardian Relation Null Testperson", guardian_name: "Test Guardian" })
      .select()
      .single();
    expect(nullError).toBeNull();
    expect(withoutRelation?.guardian_relation).toBeNull();

    const { error: invalid } = await sunrise.from("patients").insert({
      name: "Guardian Relation Invalid Testperson",
      guardian_relation: "X/O" as never,
    });
    expect(invalid).not.toBeNull();
  });

  it("patients_for_day: lists patients registered today, scoped to the caller's own hospital", async () => {
    const sunrise = await signInAs(SEED_ACCOUNTS.sunrise.receptionist);
    const { data: created } = await sunrise
      .from("patients")
      .insert({ name: "Registered Today Testperson" })
      .select()
      .single();

    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
    const args = { p_date: today, p_day_start: new Date(`${today}T00:00:00+05:30`).toISOString() };

    const { data: sunriseToday } = await sunrise.rpc("patients_for_day", args);
    expect(sunriseToday?.some((p) => p.id === created!.id)).toBe(true);

    const clarity = await signInAs(SEED_ACCOUNTS.clarity.receptionist);
    const { data: clarityToday } = await clarity.rpc("patients_for_day", args);
    expect(clarityToday?.some((p) => p.id === created!.id)).toBe(false);
  });

  it("fuzzy name search tolerates a spelling variant", async () => {
    const sunrise = await signInAs(SEED_ACCOUNTS.sunrise.receptionist);
    const { data: created } = await sunrise
      .from("patients")
      .insert({ name: "Priyanka Sharma", mobile: "9876500002" })
      .select()
      .single();

    // Deliberately misspelled ("Priyanaka" vs "Priyanka").
    const { data } = await sunrise.rpc("search_patients", { p_query: "Priyanaka Sharma" });
    expect(data?.some((p) => p.id === created!.id)).toBe(true);
  });

  it("cross-tenant: a receptionist cannot see or search another hospital's patients", async () => {
    const clarity = await signInAs(SEED_ACCOUNTS.clarity.admin);
    const { data: clarityPatient } = await clarity
      .from("patients")
      .insert({ name: "Clarity Only Patient", mobile: "9876500099" })
      .select()
      .single();

    const sunrise = await signInAs(SEED_ACCOUNTS.sunrise.receptionist);
    const { data: byId } = await sunrise.from("patients").select("*").eq("id", clarityPatient!.id);
    expect(byId).toHaveLength(0);

    const { data: bySearch } = await sunrise.rpc("search_patients", {
      p_query: "Clarity Only Patient",
    });
    expect(bySearch?.some((p) => p.id === clarityPatient!.id)).toBe(false);
  });

  it("cross-tenant: cannot forge hospital_id when creating a patient", async () => {
    const sunrise = await signInAs(SEED_ACCOUNTS.sunrise.receptionist);
    const clarityId = await hospitalIdByName("Clarity Diagnostics");

    const { error } = await sunrise.from("patients").insert({
      hospital_id: clarityId,
      name: "Forged Hospital Patient",
    });
    expect(error).not.toBeNull();
  });

  it("concurrent registrations never produce duplicate patient codes", async () => {
    const sunrise = await signInAs(SEED_ACCOUNTS.sunrise.receptionist);

    const results = await Promise.all(
      Array.from({ length: 15 }, (_, i) =>
        sunrise
          .from("patients")
          .insert({ name: `Concurrent Test Patient ${i}`, mobile: `98765${10000 + i}` })
          .select("patient_code")
          .single(),
      ),
    );

    expect(results.every((r) => r.error === null)).toBe(true);
    const codes = results.map((r) => r.data!.patient_code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("no DELETE policy exists — patients are never hard-deleted", async () => {
    const sunrise = await signInAs(SEED_ACCOUNTS.sunrise.receptionist);
    const { data: created } = await sunrise
      .from("patients")
      .insert({ name: "Not Actually Deletable" })
      .select()
      .single();

    const { data: deleted } = await sunrise
      .from("patients")
      .delete()
      .eq("id", created!.id)
      .select();
    expect(deleted).toHaveLength(0);

    const { data: stillThere } = await sunrise
      .from("patients")
      .select("id")
      .eq("id", created!.id)
      .single();
    expect(stillThere?.id).toBe(created!.id);
  });
});
