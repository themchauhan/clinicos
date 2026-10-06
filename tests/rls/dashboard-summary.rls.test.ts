import { describe, expect, it } from "vitest";
import {
  SEED_ACCOUNTS,
  anonClient,
  hospitalIdByName,
  serviceRoleClient,
  signInAs,
} from "./helpers";

type Client = Awaited<ReturnType<typeof signInAs>>;

const todayIst = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

/** A calendar day no visit in this hospital has used, far in the past, so
 * expectations about "that day" are exact however often the suite has run. */
async function unusedDate(hospitalId: string): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const date = `${2001 + Math.floor(Math.random() * 15)}-${String(1 + Math.floor(Math.random() * 12)).padStart(2, "0")}-${String(1 + Math.floor(Math.random() * 28)).padStart(2, "0")}`;
    const { count } = await serviceRoleClient()
      .from("visits")
      .select("id", { count: "exact", head: true })
      .eq("hospital_id", hospitalId)
      .eq("visit_date", date);
    if (!count) return date;
  }
  throw new Error("no unused date found");
}

async function sunriseOpdTypeId(): Promise<string> {
  const { data } = await serviceRoleClient()
    .from("visit_types")
    .select("id")
    .eq("name", "OPD Consultation")
    .eq("hospital_id", await hospitalIdByName("Sunrise General Hospital"))
    .single();
  return data!.id;
}

async function summary(client: Client, from: string, to: string) {
  const { data, error } = await client.rpc("dashboard_summary", {
    p_from: from,
    p_to: to,
  });
  expect(error).toBeNull();
  return data!;
}

describe("dashboard_summary", () => {
  it("reports visits, referrers, dues and visit-type breakdown correctly for a known day", async () => {
    const admin = await signInAs(SEED_ACCOUNTS.sunrise.admin);
    const sunriseId = await hospitalIdByName("Sunrise General Hospital");
    const date = await unusedDate(sunriseId);
    const typeId = await sunriseOpdTypeId();

    const { data: patient } = await admin
      .from("patients")
      .insert({ name: "Dashboard Summary Testperson" })
      .select()
      .single();
    const visit = async (fee: number, extra: Record<string, unknown> = {}) => {
      const { data, error } = await admin
        .from("visits")
        .insert({
          patient_id: patient!.id,
          visit_type_id: typeId,
          visit_date: date,
          fee_amount: fee,
          referred_by_name: "Dr Dashboard Referrer",
          ...extra,
        })
        .select()
        .single();
      expect(error).toBeNull();
      return data!;
    };
    const v1 = await visit(500);
    const v2 = await visit(300);
    const cancelled = await visit(900);
    await admin.from("visits").update({ status: "CANCELLED" }).eq("id", cancelled.id);

    // v1 paid in full, v2 partly (UPI): 200 still owed. The cancelled
    // visit's fee must not count as billed or owed.
    await admin.from("visit_payments").insert([
      { visit_id: v1.id, amount: 500, mode: "CASH" },
      { visit_id: v2.id, amount: 100, mode: "UPI" },
    ]);

    const s = await summary(admin, date, date);
    expect(s.is_admin).toBe(true);
    expect(s.totals.visits).toBe(2);
    expect(s.totals.cancelled).toBe(1);
    expect(s.totals.patients_visited).toBe(1);
    expect(Number(s.totals.billed)).toBe(800);
    expect(s.totals.outstanding_count).toBe(1);
    expect(Number(s.totals.outstanding_amount)).toBe(200);

    expect(s.referrers?.[0]).toMatchObject({ name: "Dr Dashboard Referrer", visits: 2 });
    expect(Number(s.referrers?.[0].billed)).toBe(800);
    // The weekday list always covers Mon-Sun, and the day we used has both visits.
    expect(s.weekday).toHaveLength(7);
    expect(s.weekday!.reduce((sum, w) => sum + w.visits, 0)).toBe(2);
    // Both visits are unassigned to any doctor.
    expect(s.by_doctor?.find((d) => d.name === "Unassigned")?.visits).toBe(2);
  });

  it("collected totals match the payments table for today, split by mode and staff", async () => {
    const admin = await signInAs(SEED_ACCOUNTS.sunrise.admin);
    const sunriseId = await hospitalIdByName("Sunrise General Hospital");
    const today = todayIst();
    const s = await summary(admin, today, today);

    const start = new Date(`${today}T00:00:00+05:30`).toISOString();
    const end = new Date(new Date(`${today}T00:00:00+05:30`).getTime() + 86_400_000).toISOString();
    const { data: payments } = await serviceRoleClient()
      .from("visit_payments")
      .select("amount, mode")
      .eq("hospital_id", sunriseId)
      .gte("received_at", start)
      .lt("received_at", end);
    const expected = (payments ?? []).reduce((sum, p) => sum + Number(p.amount), 0);

    expect(Number(s.totals.collected)).toBe(expected);
    const byModeTotal = (s.by_mode ?? []).reduce((sum, m) => sum + Number(m.amount), 0);
    const byStaffTotal = (s.by_staff ?? []).reduce((sum, m) => sum + Number(m.amount), 0);
    expect(byModeTotal).toBe(expected);
    expect(byStaffTotal).toBe(expected);
  });

  it("a receptionist gets the visit figures but none of the money", async () => {
    const admin = await signInAs(SEED_ACCOUNTS.sunrise.admin);
    const reception = await signInAs(SEED_ACCOUNTS.sunrise.receptionist);
    const today = todayIst();

    const forAdmin = await summary(admin, today, today);
    const forReception = await summary(reception, today, today);

    expect(forReception.is_admin).toBe(false);
    expect(forReception.totals.visits).toBe(forAdmin.totals.visits);
    expect(forReception.totals.billed).toBeNull();
    expect(forReception.totals.collected).toBeNull();
    expect(forReception.totals.outstanding_amount).toBeNull();
    expect(forReception.by_mode).toBeNull();
    expect(forReception.by_staff).toBeNull();
    expect(forReception.by_doctor?.every((d) => d.collected === null)).toBe(true);
    expect(forReception.referrers?.every((r) => r.billed === null)).toBe(true);
  });

  it("cross-tenant: another centre's figures never include this centre's visits", async () => {
    const admin = await signInAs(SEED_ACCOUNTS.sunrise.admin);
    const clarity = await signInAs(SEED_ACCOUNTS.clarity.admin);
    const sunriseId = await hospitalIdByName("Sunrise General Hospital");
    const date = await unusedDate(sunriseId);

    const { data: patient } = await admin
      .from("patients")
      .insert({ name: "Dashboard Tenant Testperson" })
      .select()
      .single();
    await admin.from("visits").insert({
      patient_id: patient!.id,
      visit_type_id: await sunriseOpdTypeId(),
      visit_date: date,
      fee_amount: 123,
      referred_by_name: "Dr Tenant Referrer",
    });

    expect((await summary(admin, date, date)).totals.visits).toBe(1);
    const other = await summary(clarity, date, date);
    expect(other.totals.visits).toBe(0);
    expect(other.referrers ?? []).toHaveLength(0);
    expect(Number(other.totals.billed)).toBe(0);
  });

  it("totals-only skips the heavy parts, and a signed-out caller cannot call it at all", async () => {
    const admin = await signInAs(SEED_ACCOUNTS.sunrise.admin);
    const today = todayIst();
    const { data } = await admin.rpc("dashboard_summary", {
      p_from: today,
      p_to: today,
      p_totals_only: true,
    });
    expect(data?.totals.visits).toBeGreaterThanOrEqual(0);
    expect(data?.weekday).toBeNull();
    expect(data?.by_doctor).toBeNull();

    const { error } = await anonClient().rpc("dashboard_summary", { p_from: today, p_to: today });
    expect(error).not.toBeNull();
  });
});
