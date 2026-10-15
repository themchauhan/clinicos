// @vitest-environment node
import "fake-indexeddb/auto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetDbForTests, type LocalOp } from "../../src/lib/offline/db";
import {
  enqueueRegistration,
  listOps,
  resolveAsNew,
  resolveUseExisting,
} from "../../src/lib/offline/queue";
import { MAX_OPS_PER_BATCH, parseSyncRequest } from "../../src/lib/offline/protocol";
import { processSyncBatch, type RpcCall } from "../../src/lib/offline/server";
import { syncNow, type SyncDeps } from "../../src/lib/offline/sync";
import type { PatientFields } from "../../src/lib/patients/parse";
import { SEED_ACCOUNTS, hospitalIdByName, serviceRoleClient, signInAs } from "./helpers";

/**
 * Chaos test: the real sync engine on two simulated devices against the REAL
 * database function, with a hostile network. Faults are injected on every
 * round (requests dropped before reaching the server, replies lost AFTER the
 * server committed, 500s, timeouts after commit, the same batch delivered
 * twice at once, bytes corrupted in transit, the cloud briefly unreachable),
 * with a seeded random generator so any failure can be replayed.
 *
 * It runs on its OWN centre (Wellspring): the other offline test files switch
 * Sunrise's offline flag and deliberately tamper with its ledger, and Vitest
 * runs test files in parallel.
 *
 * After the dust settles, invariants are checked straight against the
 * database: exactly one patient and one visit per accepted operation, none for
 * a held one, ledger and devices agree, and the hash chain verifies.
 */

const sr = serviceRoleClient();
const SEEDS = process.env.CHAOS_SEED ? [Number(process.env.CHAOS_SEED)] : [1, 2, 3];
const OPS_PER_DEVICE = 18;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const letters = "bcdfghjklmnpqrstvwxz";
const word = (rng: () => number, n: number) =>
  Array.from({ length: n }, () => letters[Math.floor(rng() * letters.length)]).join("");
const digits = (rng: () => number) => `9${String(Math.floor(rng() * 1e9)).padStart(9, "0")}`;

let centreId: string;
let visitTypeId: string;
let originalFlag = false;

beforeAll(async () => {
  centreId = await hospitalIdByName("Wellspring Multispecialty");
  const { data } = await sr
    .from("hospitals")
    .select("offline_sync_enabled")
    .eq("id", centreId)
    .single();
  originalFlag = data!.offline_sync_enabled;
  await sr.from("hospitals").update({ offline_sync_enabled: true }).eq("id", centreId);
  // A visit type of our own, so other test files that switch the centre's visit
  // types on and off can never change what this test sees.
  const name = "Offline Sync Test Visit Type";
  const { data: existing } = await sr
    .from("visit_types")
    .select("id")
    .eq("hospital_id", centreId)
    .eq("name", name)
    .maybeSingle();
  if (existing) {
    visitTypeId = existing.id;
  } else {
    const { data: created, error } = await sr
      .from("visit_types")
      .insert({ hospital_id: centreId, module: "GENERAL_OPD", name, default_fee: 0 })
      .select("id")
      .single();
    if (error) throw error;
    visitTypeId = created.id;
  }
});
afterAll(async () => {
  await sr.from("hospitals").update({ offline_sync_enabled: originalFlag }).eq("id", centreId);
});

type Client = Awaited<ReturnType<typeof signInAs>>;

function rpcFor(client: Client): RpcCall {
  return async (op) => {
    const { data, error } = await client.rpc("apply_offline_operation", { p_op: op });
    return { data, error };
  };
}

interface Stats {
  dropRequest: number;
  dropResponse: number;
  server500: number;
  timeoutAfterCommit: number;
  duplicateDelivery: number;
  corruptInTransit: number;
  healthDown: number;
}

function hostileFetch(
  client: Client,
  rng: () => number,
  stats: Stats,
  calm: () => boolean,
): typeof fetch {
  const rpc = rpcFor(client);
  return async (input, init) => {
    const url = String(input);
    if (url.endsWith("/api/health")) {
      if (!calm() && rng() < 0.1) {
        stats.healthDown++;
        return new Response("{}", { status: 503 });
      }
      return Response.json({ ok: true });
    }

    const { ops } = JSON.parse(String(init?.body)) as { ops: Record<string, unknown>[] };
    const parsed = parseSyncRequest({ ops });
    if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });
    expect(ops.length).toBeLessThanOrEqual(MAX_OPS_PER_BATCH);

    const roll = calm() ? 1 : rng();
    if (roll < 0.1) {
      stats.dropRequest++; // never reaches the server
      throw new TypeError("connection dropped");
    }
    if (roll < 0.15) {
      stats.server500++;
      return new Response("upstream error", { status: 500 });
    }
    if (roll < 0.19) {
      // Bytes altered in transit for one operation.
      stats.corruptInTransit++;
      const mutated = ops.map((o, i) =>
        i === 0 && o.visit ? { ...o, visit: { ...(o.visit as object), fee_amount: 777 } } : o,
      );
      const r = await processSyncBatch(rpc, mutated);
      return Response.json({ outcomes: r.outcomes });
    }

    if (roll < 0.3) {
      // The same batch arrives twice at the same time (a retry racing the original).
      stats.duplicateDelivery++;
      const [a, b] = await Promise.all([processSyncBatch(rpc, ops), processSyncBatch(rpc, ops)]);
      return Response.json({ outcomes: (rng() < 0.5 ? a : b).outcomes });
    }

    const result = await processSyncBatch(rpc, ops);
    if (result.authFailed) return new Response("{}", { status: 403 });

    if (roll < 0.45) {
      stats.dropResponse++; // committed, but the device never hears
      throw new TypeError("connection reset after commit");
    }
    if (roll < 0.52) {
      // The server's own call timed out AFTER the database committed.
      stats.timeoutAfterCommit++;
      return Response.json({
        outcomes: result.outcomes.map((o, i) =>
          i === 0 ? { op_id: o.op_id, status: "retry", reason: "57014" } : o,
        ),
      });
    }
    return Response.json({ outcomes: result.outcomes });
  };
}

describe.each(SEEDS)("chaos, seed %i", (seed) => {
  it("keeps every record exactly once under a hostile network, two devices and duplicate people", async () => {
    await resetDbForTests();
    const rng = mulberry32(seed);
    const rec = await signInAs(SEED_ACCOUNTS.wellspring.receptionist);
    const adm = await signInAs(SEED_ACCOUNTS.wellspring.admin);
    const devices = [
      { scope: "dev-a:wellspring", client: rec },
      { scope: "dev-b:wellspring", client: adm },
    ];
    let clock = Date.now();
    let calm = false;
    const stats: Stats = {
      dropRequest: 0,
      dropResponse: 0,
      server500: 0,
      timeoutAfterCommit: 0,
      duplicateDelivery: 0,
      corruptInTransit: 0,
      healthDown: 0,
    };
    const depsFor = (d: (typeof devices)[number]): SyncDeps => ({
      fetchFn: hostileFetch(d.client, rng, stats, () => calm),
      now: () => clock,
      random: () => rng(),
    });

    // People to register: some appear on BOTH devices (same mobile) to force holds.
    const sharedMobiles = Array.from({ length: 4 }, () => digits(rng));
    const person = (mobile: string | null): PatientFields => ({
      name: `${word(rng, 9)} ${word(rng, 8)}`,
      mobile,
      dob: null,
      approximateAgeYears: 20 + Math.floor(rng() * 40),
      guardianName: null,
      guardianRelation: null,
      gender: rng() < 0.5 ? "FEMALE" : "MALE",
      address: null,
      livingSons: null,
      livingSonsAges: null,
      livingDaughters: null,
      livingDaughtersAges: null,
    });
    const visit = {
      visitTypeId,
      doctorId: null,
      notes: null,
      referredByName: null,
      referredByHospital: null,
      feeAmount: 100,
      followUpDate: null,
      lmpDate: null,
    };

    // Interleave saving and syncing, as a clinic day would.
    let queued = 0;
    for (let round = 0; round < OPS_PER_DEVICE * 3; round++) {
      for (const d of devices) {
        if (queued < OPS_PER_DEVICE * 2 && rng() < 0.45) {
          const mobile =
            rng() < 0.3 ? sharedMobiles[Math.floor(rng() * sharedMobiles.length)] : digits(rng);
          await enqueueRegistration(d.scope, { patient: person(mobile), visit }, clock);
          queued++;
        }
        if (rng() < 0.7) await syncNow(d.scope, depsFor(d), { force: rng() < 0.5 });
      }
      clock += Math.floor(rng() * 8 * 60_000);
    }
    // Make sure everything has been saved.
    while (queued < OPS_PER_DEVICE * 2) {
      const d = devices[queued % 2];
      await enqueueRegistration(d.scope, { patient: person(digits(rng)), visit }, clock);
      queued++;
    }

    // The network recovers. Keep syncing until nothing is left to send.
    const settle = async () => {
      calm = true;
      for (let i = 0; i < 40; i++) {
        let busy = false;
        for (const d of devices) {
          clock += 10 * 60_000;
          const r = await syncNow(d.scope, depsFor(d), { force: true });
          if (r.sent > 0) busy = true;
        }
        if (!busy) break;
      }
      calm = false;
    };
    await settle();

    // A person settles every hold (some as new, some as the existing patient).
    for (const d of devices) {
      for (const op of await listOps(d.scope)) {
        if (op.status !== "needs_review") continue;
        if (op.review_reason === "possible_duplicate") {
          const candidates = (op.result?.candidates as { id: string }[] | undefined) ?? [];
          if (rng() < 0.5 && candidates[0])
            await resolveUseExisting(op.op_id, candidates[0].id, clock);
          else await resolveAsNew(op.op_id, clock);
        }
      }
    }
    await settle();

    // ---------------- invariants, checked against the database ----------------
    const local: LocalOp[] = [];
    for (const d of devices) local.push(...(await listOps(d.scope)));
    const why = `(seed ${seed}; faults ${JSON.stringify(stats)})`;

    // Nothing is left half-sent.
    for (const op of local) {
      expect(["synced", "resolved", "needs_review"], `${op.op_id} ${op.status} ${why}`).toContain(
        op.status,
      );
    }

    const { data: ledger } = await sr
      .from("offline_operations")
      .select("*")
      .eq("hospital_id", centreId)
      .in(
        "op_id",
        local.map((o) => o.op_id),
      );
    const ledgerByOp = new Map((ledger ?? []).map((r) => [r.op_id, r]));
    expect(ledgerByOp.size, `one ledger row per operation that reached the server ${why}`).toBe(
      ledger!.length,
    );

    // The ledger and the devices agree, and the server saw the exact bytes the device saved.
    for (const op of local) {
      const row = ledgerByOp.get(op.op_id);
      if (op.status === "synced") {
        expect(row?.status, `${op.op_id} ${why}`).toBe("applied");
      }
      if (row) expect(row.payload_hash, `${op.op_id} ${why}`).toBe(op.payload_hash);
    }

    const applied = (ledger ?? []).filter((r) => r.status === "applied");
    const syncedLocal = local.filter((o) => o.status === "synced");
    const mismatch = applied
      .filter((r) => local.find((o) => o.op_id === r.op_id)?.status !== "synced")
      .map((r) => {
        const o = local.find((x) => x.op_id === r.op_id);
        return {
          op: r.op_id,
          type: r.op_type,
          local: o?.status,
          reason: o?.review_reason,
          last: o?.last_error,
        };
      });
    if (mismatch.length) console.log("MISMATCH", JSON.stringify(mismatch));
    expect(applied.length, `every applied operation is synced on its device ${why}`).toBe(
      syncedLocal.length,
    );

    // Exactly one visit per applied operation, exactly one patient per registration.
    const visitIds = applied.map((r) => r.visit_id!);
    expect(new Set(visitIds).size).toBe(visitIds.length);
    const { data: visits } = await sr
      .from("visits")
      .select("id, patient_id, token_number, visit_date")
      .in("id", visitIds);
    expect(visits?.length, `a visit for every applied op, none extra ${why}`).toBe(applied.length);

    const registrations = applied.filter((r) => r.op_type === "register_patient_and_visit");
    const patientIds = registrations.map((r) => r.patient_id!);
    expect(new Set(patientIds).size).toBe(patientIds.length);
    const { data: patients } = await sr.from("patients").select("id, name").in("id", patientIds);
    expect(patients?.length, `a patient for every registration, none extra ${why}`).toBe(
      registrations.length,
    );
    const names = (patients ?? []).map((p) => p.name);
    expect(new Set(names).size, `no person created twice ${why}`).toBe(names.length);

    // A held record that was never settled created nothing.
    const held = (ledger ?? []).filter((r) => r.status === "needs_review");
    for (const r of held) {
      const hp = r.payload as { patient?: { id: string }; visit: { id: string } };
      const resolvedBy = applied.some((a) => a.resolves_op_id === r.op_id);
      if (!resolvedBy) {
        const { count } = await sr
          .from("visits")
          .select("id", { count: "exact", head: true })
          .eq("id", hp.visit.id);
        expect(count, `unsettled hold created a visit ${why}`).toBe(0);
      }
    }
    // A hold is settled at most once.
    const resolves = applied.map((r) => r.resolves_op_id).filter(Boolean);
    expect(new Set(resolves).size).toBe(resolves.length);

    // Tokens are unique per day.
    const tokenKeys = (visits ?? []).map((v) => `${v.visit_date}#${v.token_number}`);
    expect(new Set(tokenKeys).size).toBe(tokenKeys.length);

    // Audit rows match the accepted operations.
    const { count: audited } = await sr
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("action", "visit.created")
      .in("target_id", visitIds);
    expect(audited).toBe(visitIds.length);

    // The hash chain is intact after all of that.
    const verified = await adm.rpc("verify_offline_ledger");
    expect(verified.data, `ledger chain ${why}`).toMatchObject({ ok: true });

    // The test actually exercised the faults it claims to.
    expect(
      stats.dropResponse + stats.timeoutAfterCommit + stats.duplicateDelivery + stats.dropRequest,
      `faults were injected ${why}`,
    ).toBeGreaterThan(5);
    expect(applied.length).toBeGreaterThan(10);
  }, 280_000);
});
