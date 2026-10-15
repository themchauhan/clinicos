// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withHash } from "../../src/lib/offline/canonical";
import {
  SEED_ACCOUNTS,
  anonClient,
  hospitalIdByName,
  serviceRoleClient,
  signInAs,
} from "./helpers";

// Synthetic data only. Every test uses fresh random names/ids so nothing can
// collide with another test (the duplicate check compares name similarity).

type Client = Awaited<ReturnType<typeof signInAs>>;
type Op = Record<string, unknown>;
type Outcome = {
  status: string;
  op_id: string;
  payload_hash: string;
  error_code: string | null;
  replayed?: boolean;
  reason?: string;
  result: Record<string, unknown>;
};

const sr = serviceRoleClient();
const letters = "bcdfghjklmnpqrstvwxz";
const word = (n: number) =>
  Array.from({ length: n }, () => letters[Math.floor(Math.random() * letters.length)]).join("");
const randomName = () => `${word(9)} ${word(8)}`;
const randomMobile = () => `9${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
const todayIst = (offsetDays = 0) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(
    new Date(Date.now() + offsetDays * 86_400_000),
  );

const hospitalIds: string[] = [];
const originalFlags = new Map<string, boolean>();
let sunriseId: string;
let clarityId: string;
let sunriseType: string;
let clarityType: string;

async function setSync(id: string, enabled: boolean) {
  const { error } = await sr
    .from("hospitals")
    .update({ offline_sync_enabled: enabled })
    .eq("id", id);
  if (error) throw error;
}
// A visit type of our own, so other test files that switch the centre's visit
// types on and off (they run in parallel) can never change what these tests see.
async function visitTypeOf(hospitalId: string) {
  const name = "Offline Sync Test Visit Type";
  const { data: existing } = await sr
    .from("visit_types")
    .select("id")
    .eq("hospital_id", hospitalId)
    .eq("name", name)
    .maybeSingle();
  if (existing) return existing.id;
  const { data, error } = await sr
    .from("visit_types")
    .insert({ hospital_id: hospitalId, module: "GENERAL_OPD", name, default_fee: 0 })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

beforeAll(async () => {
  sunriseId = await hospitalIdByName("Sunrise General Hospital");
  clarityId = await hospitalIdByName("Clarity Diagnostics");
  for (const id of [sunriseId, clarityId]) {
    hospitalIds.push(id);
    const { data } = await sr
      .from("hospitals")
      .select("offline_sync_enabled")
      .eq("id", id)
      .single();
    originalFlags.set(id, data!.offline_sync_enabled);
    await setSync(id, true);
  }
  sunriseType = await visitTypeOf(sunriseId);
  clarityType = await visitTypeOf(clarityId);
});
afterAll(async () => {
  for (const id of hospitalIds) await setSync(id, originalFlags.get(id) ?? false);
});

async function registerOp(
  visitType: string,
  over: Op = {},
  patientOver: Op = {},
  visitOver: Op = {},
): Promise<Op> {
  const patientId = crypto.randomUUID();
  return withHash({
    op_id: crypto.randomUUID(),
    op_type: "register_patient_and_visit",
    schema_version: 1,
    device_id: "test-device",
    client_created_at: new Date().toISOString(),
    clock_offset_ms: 0,
    patient: {
      id: patientId,
      name: randomName(),
      mobile: null,
      dob: null,
      gender: "FEMALE",
      ...patientOver,
    },
    visit: {
      id: crypto.randomUUID(),
      patient_id: patientId,
      visit_type_id: visitType,
      visit_date: todayIst(),
      fee_amount: 100,
      ...visitOver,
    },
    ...over,
  });
}
const createVisitOp = (patientId: string, visitType: string, over: Op = {}, visitOver: Op = {}) =>
  withHash({
    op_id: crypto.randomUUID(),
    op_type: "create_visit",
    schema_version: 1,
    client_created_at: new Date().toISOString(),
    visit: {
      id: crypto.randomUUID(),
      patient_id: patientId,
      visit_type_id: visitType,
      visit_date: todayIst(),
      fee_amount: 50,
      ...visitOver,
    },
    ...over,
  });

async function apply(client: Client, op: Op): Promise<Outcome> {
  const { data, error } = await client.rpc("apply_offline_operation", { p_op: op });
  if (error) throw error;
  return data as unknown as Outcome;
}
const P = (op: Op) => (op.patient as Op).id as string;
const V = (op: Op) => (op.visit as Op).id as string;
const patientCount = async (id: string) =>
  (await sr.from("patients").select("id", { count: "exact", head: true }).eq("id", id)).count ?? 0;
const visitCount = async (id: string) =>
  (await sr.from("visits").select("id", { count: "exact", head: true }).eq("id", id)).count ?? 0;
const ledgerRows = async (opId: string) =>
  (await sr.from("offline_operations").select("*").eq("op_id", opId)).data ?? [];

describe("applying an operation", () => {
  it("registers a patient and visit, assigns real numbers, writes ledger and audit rows", async () => {
    const rec = await signInAs(SEED_ACCOUNTS.sunrise.receptionist);
    const op = await registerOp(sunriseType, {}, { mobile: randomMobile() });
    const out = await apply(rec, op);
    expect(out.status).toBe("applied");
    expect(out.replayed).toBe(false);
    expect(out.payload_hash).toBe(op.payload_hash);
    expect(out.result.patient_id).toBe(P(op));
    expect(String(out.result.patient_code)).toMatch(/\d+$/);
    expect(Number(out.result.token_number)).toBeGreaterThan(0);
    expect(await patientCount(P(op))).toBe(1);
    expect(await visitCount(V(op))).toBe(1);
    const [row] = await ledgerRows(op.op_id as string);
    expect(row).toMatchObject({ status: "applied", patient_id: P(op), visit_id: V(op) });
    expect(row.payload).toEqual(op);
    const { data: audit } = await sr
      .from("audit_logs")
      .select("action, metadata")
      .in("target_id", [P(op), V(op), op.op_id as string]);
    expect((audit ?? []).map((a) => a.action).sort()).toEqual([
      "offline.sync.applied",
      "patient.created",
      "visit.created",
    ]);
    expect(JSON.stringify(audit)).not.toContain((op.patient as Op).name as string);
  });

  it("keeps the original creation time and the original visit date", async () => {
    const rec = await signInAs(SEED_ACCOUNTS.sunrise.receptionist);
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000);
    const op = await registerOp(
      sunriseType,
      { client_created_at: twoHoursAgo.toISOString() },
      {},
      {
        visit_date: todayIst(-1),
      },
    );
    expect((await apply(rec, op)).status).toBe("applied");
    const { data: p } = await sr.from("patients").select("created_at").eq("id", P(op)).single();
    expect(Math.abs(new Date(p!.created_at).getTime() - twoHoursAgo.getTime())).toBeLessThan(2000);
    const { data: v } = await sr.from("visits").select("visit_date").eq("id", V(op)).single();
    expect(v!.visit_date).toBe(todayIst(-1));
  });

  it("an existing patient gets a new visit through create_visit", async () => {
    const rec = await signInAs(SEED_ACCOUNTS.sunrise.receptionist);
    const first = await registerOp(sunriseType);
    await apply(rec, first);
    const out = await apply(rec, await createVisitOp(P(first), sunriseType));
    expect(out.status).toBe("applied");
    expect(out.result.patient_id).toBe(P(first));
    expect(await patientCount(P(first))).toBe(1);
  });
});

describe("exactly-once effect", () => {
  it("replaying three times creates one patient, one visit, one ledger row", async () => {
    const rec = await signInAs(SEED_ACCOUNTS.sunrise.receptionist);
    const op = await registerOp(sunriseType);
    const a = await apply(rec, op);
    const b = await apply(rec, op);
    const c = await apply(rec, op);
    expect([a.replayed, b.replayed, c.replayed]).toEqual([false, true, true]);
    expect(b.result).toEqual(a.result);
    expect(c.payload_hash).toBe(a.payload_hash);
    expect(await patientCount(P(op))).toBe(1);
    expect(await ledgerRows(op.op_id as string)).toHaveLength(1);
    const { count } = await sr
      .from("visits")
      .select("id", { count: "exact", head: true })
      .eq("patient_id", P(op));
    expect(count).toBe(1);
  });

  it("eight concurrent retries still create exactly one record with one result", async () => {
    const rec = await signInAs(SEED_ACCOUNTS.sunrise.receptionist);
    const op = await registerOp(sunriseType);
    const outs = await Promise.all(Array.from({ length: 8 }, () => apply(rec, op)));
    expect(outs.every((o) => o.status === "applied")).toBe(true);
    expect(outs.filter((o) => o.replayed === false)).toHaveLength(1);
    expect(new Set(outs.map((o) => JSON.stringify(o.result))).size).toBe(1);
    expect(await patientCount(P(op))).toBe(1);
    expect(await ledgerRows(op.op_id as string)).toHaveLength(1);
  });

  it("the same op_id with different content is refused and changes nothing", async () => {
    const rec = await signInAs(SEED_ACCOUNTS.sunrise.receptionist);
    const op = await registerOp(sunriseType);
    await apply(rec, op);
    const tampered = await withHash({
      ...op,
      patient: { ...(op.patient as Op), name: randomName() },
    });
    const out = await apply(rec, tampered);
    expect(out).toMatchObject({ status: "rejected", error_code: "op_id_reused" });
    const { data } = await sr.from("patients").select("name").eq("id", P(op)).single();
    expect(data!.name).toBe((op.patient as Op).name);
    expect(await ledgerRows(op.op_id as string)).toHaveLength(1);
  });

  it("two different operations cannot claim the same patient or visit id", async () => {
    const rec = await signInAs(SEED_ACCOUNTS.sunrise.receptionist);
    const first = await registerOp(sunriseType);
    await apply(rec, first);
    const dupPatient = await registerOp(
      sunriseType,
      {},
      { id: P(first) },
      { patient_id: P(first) },
    );
    expect((await apply(rec, dupPatient)).status).toBe("rejected");
    const dupVisit = await registerOp(sunriseType, {}, {}, { id: V(first) });
    expect((await apply(rec, dupVisit)).status).toBe("rejected");
    expect(await patientCount(P(first))).toBe(1);
    expect(await patientCount(P(dupVisit))).toBe(0);
  });
});

describe("possible duplicates are held, and a hold is settled exactly once", () => {
  async function heldPair(over: Op = {}) {
    const rec = await signInAs(SEED_ACCOUNTS.sunrise.receptionist);
    const mobile = randomMobile();
    const existing = await registerOp(sunriseType, {}, { mobile, address: "Original Address" });
    await apply(rec, existing);
    const held = await registerOp(sunriseType, over, { mobile, address: "Different Address" });
    const out = await apply(rec, held);
    return { rec, existing, held, out };
  }

  it("holds a same-mobile registration without inserting or merging anything", async () => {
    const { existing, held, out, rec } = await heldPair();
    expect(out).toMatchObject({ status: "needs_review", error_code: "possible_duplicate" });
    const candidates = out.result.candidates as { id: string; matched_on: string }[];
    expect(candidates.map((c) => c.id)).toContain(P(existing));
    expect(candidates[0].matched_on).toBe("mobile");
    // No patient details are copied into the ledger's result.
    expect(JSON.stringify(out.result)).not.toContain("Original Address");
    expect(await patientCount(P(held))).toBe(0);
    expect(await visitCount(V(held))).toBe(0);
    expect((await apply(rec, held)).replayed).toBe(true);
  });

  it("'register as new' settles the hold; the held ledger row itself never changes", async () => {
    const { rec, held } = await heldPair();
    const asNew = await withHash({
      ...held,
      op_id: crypto.randomUUID(),
      confirm_new: true,
      resolves_op_id: held.op_id,
    });
    expect((await apply(rec, asNew)).status).toBe("applied");
    expect(await patientCount(P(held))).toBe(1);
    expect((await ledgerRows(held.op_id as string))[0].status).toBe("needs_review");
    expect((await ledgerRows(asNew.op_id as string))[0].resolves_op_id).toBe(held.op_id);
  });

  it("'use existing patient' attaches the visit without touching the existing patient", async () => {
    const { rec, existing, held } = await heldPair();
    const use = await createVisitOp(
      P(existing),
      sunriseType,
      { resolves_op_id: held.op_id },
      { id: V(held) },
    );
    expect((await apply(rec, use)).status).toBe("applied");
    const { data } = await sr.from("patients").select("address").eq("id", P(existing)).single();
    expect(data!.address).toBe("Original Address");
  });

  it("a hold can be settled only once, and only about its own visit", async () => {
    const { rec, existing, held } = await heldPair();
    const use = await createVisitOp(
      P(existing),
      sunriseType,
      { resolves_op_id: held.op_id },
      { id: V(held) },
    );
    expect((await apply(rec, use)).status).toBe("applied");
    // A second resolution of the same hold (either kind) is refused.
    const again = await withHash({
      ...held,
      op_id: crypto.randomUUID(),
      confirm_new: true,
      resolves_op_id: held.op_id,
    });
    expect(await apply(rec, again)).toMatchObject({
      status: "rejected",
      error_code: "already_resolved",
    });
    expect(await patientCount(P(held))).toBe(0);

    const { rec: rec2, existing: ex2, held: held2 } = await heldPair();
    const wrongVisit = await createVisitOp(P(ex2), sunriseType, { resolves_op_id: held2.op_id });
    expect(await apply(rec2, wrongVisit)).toMatchObject({
      status: "rejected",
      error_code: "resolution_mismatch",
    });
  });

  it("two simultaneous resolutions of one hold: exactly one wins", async () => {
    const { rec, existing, held } = await heldPair();
    const asNew = await withHash({
      ...held,
      op_id: crypto.randomUUID(),
      confirm_new: true,
      resolves_op_id: held.op_id,
    });
    const use = await createVisitOp(
      P(existing),
      sunriseType,
      { resolves_op_id: held.op_id },
      { id: V(held) },
    );
    const [a, b] = await Promise.all([apply(rec, asNew), apply(rec, use)]);
    expect([a.status, b.status].sort()).toEqual(["applied", "rejected"]);
    expect(await visitCount(V(held))).toBe(1);
  });

  it("a resolution must point at a real hold of this centre", async () => {
    const rec = await signInAs(SEED_ACCOUNTS.sunrise.receptionist);
    const op = await registerOp(sunriseType, { resolves_op_id: crypto.randomUUID() });
    expect(await apply(rec, op)).toMatchObject({
      status: "rejected",
      error_code: "unknown_resolves_op",
    });
    expect(await patientCount(P(op))).toBe(0);
  });
});

describe("transactional, validated, fail-safe", () => {
  it("a failure after the patient insert rolls the patient back too", async () => {
    const rec = await signInAs(SEED_ACCOUNTS.sunrise.receptionist);
    const op = await registerOp(sunriseType, {}, {}, { fee_amount: -5 });
    const out = await apply(rec, op);
    expect(out.status).toBe("rejected");
    expect(out.error_code).toMatch(/^23514/);
    expect(await patientCount(P(op))).toBe(0);
    const [row] = await ledgerRows(op.op_id as string);
    expect(row.status).toBe("rejected");
    expect(row.payload).toMatchObject({ op_id: op.op_id });
  });

  it("refuses bad input with a stable code and stores nothing", async () => {
    const rec = await signInAs(SEED_ACCOUNTS.sunrise.receptionist);
    const cases: [Op, string][] = [
      [await registerOp(crypto.randomUUID()), "visit_type_inactive"],
      [
        await registerOp(sunriseType, {}, {}, { visit_date: todayIst(2) }),
        "visit_date_out_of_window",
      ],
      [
        await registerOp(sunriseType, {}, {}, { visit_date: todayIst(-40) }),
        "visit_date_out_of_window",
      ],
      [await registerOp(sunriseType, { schema_version: 99 }), "unsupported_schema_version"],
      [await registerOp(sunriseType, {}, { name: "   " }), "name_required"],
      [await registerOp(sunriseType, {}, { name: "x".repeat(201) }), "field_too_long"],
      [await registerOp(sunriseType, {}, { mobile: "12ab" }), "invalid_mobile"],
      [await registerOp(sunriseType, {}, { dob: todayIst(3) }), "invalid_dob"],
      [await registerOp(sunriseType, { op_type: "something_else" }), "unknown_op_type"],
    ];
    for (const [op, code] of cases) {
      const out = await apply(rec, op);
      expect(out.status, code).toBe("rejected");
      expect(out.error_code).toBe(code);
      expect(await patientCount(P(op))).toBe(0);
    }
  });

  it("refuses a call that cannot even be identified (no id, no or bad hash, oversized)", async () => {
    const rec = await signInAs(SEED_ACCOUNTS.sunrise.receptionist);
    const base = await registerOp(sunriseType);
    const { payload_hash, ...noHash } = base;
    void payload_hash;
    for (const bad of [
      noHash,
      { ...base, payload_hash: "xyz" },
      { ...base, op_id: "not-a-uuid" },
      { ...base, patient: { ...(base.patient as Op), address: "a".repeat(70_000) } },
    ]) {
      const { error } = await rec.rpc("apply_offline_operation", { p_op: bad });
      expect(error).not.toBeNull();
    }
    expect(await ledgerRows(base.op_id as string)).toHaveLength(0);
  });

  it("is paused (and records nothing) while the centre's offline sync is switched off", async () => {
    const rec = await signInAs(SEED_ACCOUNTS.sunrise.receptionist);
    await setSync(sunriseId, false);
    try {
      const op = await registerOp(sunriseType);
      const out = await apply(rec, op);
      expect(out).toMatchObject({ status: "paused", reason: "offline_sync_disabled" });
      expect(await ledgerRows(op.op_id as string)).toHaveLength(0);
      expect(await patientCount(P(op))).toBe(0);
    } finally {
      await setSync(sunriseId, true);
    }
  });
});

describe("tenant isolation and permissions", () => {
  it("ignores a hospital_id in the payload: the record belongs to the caller's centre", async () => {
    const rec = await signInAs(SEED_ACCOUNTS.sunrise.receptionist);
    const op = await registerOp(
      sunriseType,
      { hospital_id: clarityId },
      { hospital_id: clarityId },
      { hospital_id: clarityId },
    );
    expect((await apply(rec, op)).status).toBe("applied");
    const { data } = await sr.from("patients").select("hospital_id").eq("id", P(op)).single();
    expect(data!.hospital_id).toBe(sunriseId);
    const { data: v } = await sr.from("visits").select("hospital_id").eq("id", V(op)).single();
    expect(v!.hospital_id).toBe(sunriseId);
  });

  it("another centre cannot read the ledger and may reuse an op_id independently", async () => {
    const sunrise = await signInAs(SEED_ACCOUNTS.sunrise.receptionist);
    const clarityAdmin = await signInAs(SEED_ACCOUNTS.clarity.admin);
    const op = await registerOp(sunriseType);
    await apply(sunrise, op);
    const { data: seen } = await clarityAdmin
      .from("offline_operations")
      .select("op_id")
      .eq("op_id", op.op_id as string);
    expect(seen).toHaveLength(0);
    const theirs = await registerOp(clarityType, { op_id: op.op_id });
    const clarity = await signInAs(SEED_ACCOUNTS.clarity.receptionist);
    const out = await apply(clarity, theirs);
    expect(out).toMatchObject({ status: "applied", replayed: false });
    expect(await ledgerRows(op.op_id as string)).toHaveLength(2);
  });

  it("cannot use another centre's visit type or patient", async () => {
    const clarity = await signInAs(SEED_ACCOUNTS.clarity.receptionist);
    const sunrise = await signInAs(SEED_ACCOUNTS.sunrise.receptionist);
    expect(await apply(clarity, await registerOp(sunriseType))).toMatchObject({
      status: "rejected",
      error_code: "visit_type_inactive",
    });
    const sunriseOp = await registerOp(sunriseType);
    await apply(sunrise, sunriseOp);
    expect(await apply(clarity, await createVisitOp(P(sunriseOp), clarityType))).toMatchObject({
      status: "rejected",
      error_code: "patient_not_found",
    });
  });

  it("a possible-duplicate check never sees another centre's patients", async () => {
    const sunrise = await signInAs(SEED_ACCOUNTS.sunrise.receptionist);
    const clarity = await signInAs(SEED_ACCOUNTS.clarity.receptionist);
    const mobile = randomMobile();
    await apply(sunrise, await registerOp(sunriseType, {}, { mobile }));
    const other = await registerOp(clarityType, {}, { mobile });
    expect((await apply(clarity, other)).status).toBe("applied");
  });

  it("a soft-deleted patient cannot receive a visit", async () => {
    const rec = await signInAs(SEED_ACCOUNTS.sunrise.receptionist);
    const reg = await registerOp(sunriseType);
    await apply(rec, reg);
    await sr.from("patients").update({ deleted_at: new Date().toISOString() }).eq("id", P(reg));
    expect(await apply(rec, await createVisitOp(P(reg), sunriseType))).toMatchObject({
      status: "rejected",
      error_code: "patient_not_found",
    });
  });

  it("no app role can write the ledger directly, and anonymous callers are refused", async () => {
    const admin = await signInAs(SEED_ACCOUNTS.sunrise.admin);
    const op = await registerOp(sunriseType);
    await apply(admin, op);
    const forged = {
      hospital_id: sunriseId,
      op_id: crypto.randomUUID(),
      seq: 999999,
      op_type: "unknown",
      schema_version: 1,
      client_created_at: new Date().toISOString(),
      payload: {},
      payload_hash: "0".repeat(64),
      status: "applied",
      submitted_by: (await admin.auth.getUser()).data.user!.id,
      prev_hash: "0".repeat(64),
      row_hash: "0".repeat(64),
    };
    expect((await admin.from("offline_operations").insert(forged as never)).error).not.toBeNull();
    expect(
      (
        await admin
          .from("offline_operations")
          .update({ status: "rejected" } as never)
          .eq("op_id", op.op_id as string)
      ).error,
    ).not.toBeNull();
    expect(
      (
        await admin
          .from("offline_operations")
          .delete()
          .eq("op_id", op.op_id as string)
      ).error,
    ).not.toBeNull();
    expect((await ledgerRows(op.op_id as string))[0].status).toBe("applied");
    expect((await anonClient().rpc("apply_offline_operation", { p_op: op })).error).not.toBeNull();
    expect((await anonClient().from("offline_operations").select("op_id")).error).not.toBeNull();
  });

  it("only a centre's administrator can read its ledger", async () => {
    const rec = await signInAs(SEED_ACCOUNTS.sunrise.receptionist);
    const admin = await signInAs(SEED_ACCOUNTS.sunrise.admin);
    const op = await registerOp(sunriseType);
    await apply(rec, op);
    expect(
      (
        await rec
          .from("offline_operations")
          .select("op_id")
          .eq("op_id", op.op_id as string)
      ).data,
    ).toHaveLength(0);
    expect(
      (
        await admin
          .from("offline_operations")
          .select("op_id")
          .eq("op_id", op.op_id as string)
      ).data,
    ).toHaveLength(1);
  });
});

describe("tamper-evident hash chain", () => {
  const verify = async (c: Client) =>
    (await c.rpc("verify_offline_ledger")).data as unknown as {
      ok: boolean;
      checked: number;
      first_bad_seq: number | null;
    };

  it("the chain is gapless and verifies after many concurrent, distinct operations", async () => {
    const rec = await signInAs(SEED_ACCOUNTS.sunrise.receptionist);
    const admin = await signInAs(SEED_ACCOUNTS.sunrise.admin);
    const ops = await Promise.all(Array.from({ length: 12 }, () => registerOp(sunriseType)));
    const outs = await Promise.all(ops.map((o) => apply(rec, o)));
    expect(outs.every((o) => o.status === "applied")).toBe(true);
    const { data: rows } = await sr
      .from("offline_operations")
      .select("seq")
      .eq("hospital_id", sunriseId)
      .order("seq");
    const seqs = rows!.map((r) => r.seq);
    expect(seqs).toEqual(seqs.map((_, i) => i + 1));
    expect(await verify(admin)).toMatchObject({ ok: true });
  });

  it("the windowed check stays fast but misses old tampering; the full check (window 0) finds it", async () => {
    const rec = await signInAs(SEED_ACCOUNTS.sunrise.receptionist);
    const admin = await signInAs(SEED_ACCOUNTS.sunrise.admin);
    const old = await registerOp(sunriseType);
    await apply(rec, old);
    await apply(rec, await registerOp(sunriseType));
    await apply(rec, await registerOp(sunriseType));

    await sr
      .from("offline_operations")
      .update({ status: "rejected" } as never)
      .eq("op_id", old.op_id as string);
    try {
      const recent = (await admin.rpc("verify_offline_ledger", { p_window: 2 })).data;
      expect(recent).toMatchObject({ ok: true, checked: 2, window: 2 });
      expect(await verify(admin)).toMatchObject({ ok: false });
      const full = (await admin.rpc("verify_offline_ledger", { p_window: 0 })).data;
      expect(full).toMatchObject({ ok: false });
    } finally {
      await sr
        .from("offline_operations")
        .update({ status: "applied" } as never)
        .eq("op_id", old.op_id as string);
    }
    expect((await admin.rpc("verify_offline_ledger", { p_window: 0 })).data).toMatchObject({
      ok: true,
    });
  });

  it("detects a changed row, a removed row and a forged row, and only an admin can verify", async () => {
    const rec = await signInAs(SEED_ACCOUNTS.sunrise.receptionist);
    const admin = await signInAs(SEED_ACCOUNTS.sunrise.admin);
    const op = await registerOp(sunriseType);
    await apply(rec, op);
    expect((await rec.rpc("verify_offline_ledger")).error).not.toBeNull();
    expect(await verify(admin)).toMatchObject({ ok: true });

    const [row] = await ledgerRows(op.op_id as string);

    // Changed: flip the stored status (service role can; app roles cannot).
    await sr
      .from("offline_operations")
      .update({ status: "rejected" } as never)
      .eq("op_id", op.op_id as string);
    try {
      expect(await verify(admin)).toMatchObject({ ok: false, first_bad_seq: row.seq });
    } finally {
      await sr
        .from("offline_operations")
        .update({ status: "applied" } as never)
        .eq("op_id", op.op_id as string);
    }
    expect(await verify(admin)).toMatchObject({ ok: true });

    // Changed result (the assigned token).
    await sr
      .from("offline_operations")
      .update({ result: { token_number: 999 } } as never)
      .eq("op_id", op.op_id as string);
    try {
      expect((await verify(admin)).ok).toBe(false);
    } finally {
      await sr
        .from("offline_operations")
        .update({ result: row.result } as never)
        .eq("op_id", op.op_id as string);
    }
    expect(await verify(admin)).toMatchObject({ ok: true });

    // Removed: a gap in the sequence.
    await sr
      .from("offline_operations")
      .delete()
      .eq("op_id", op.op_id as string);
    try {
      const gap = await verify(admin);
      expect(gap.ok).toBe(false);
    } finally {
      await sr.from("offline_operations").insert(row as never);
    }
    expect(await verify(admin)).toMatchObject({ ok: true });
  });
});
