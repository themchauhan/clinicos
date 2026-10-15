// @vitest-environment node
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests } from "@/lib/offline/db";
import { getClockOffset } from "@/lib/offline/clock";
import { enqueueRegistration, listOps, updateOp } from "@/lib/offline/queue";
import { backoffMs, recoverStuckSyncing, syncNow, type SyncDeps } from "@/lib/offline/sync";
import { hashMatches } from "@/lib/offline/canonical";
import type { OfflineOperation, OpOutcome } from "@/lib/offline/protocol";
import { SYNTHETIC_PATIENT as patient, SYNTHETIC_VISIT as visit } from "@/lib/offline/test-helpers";

const SCOPE = "user-a:hospital-1";

/** A tiny in-memory stand-in for the server: idempotent by op_id, like the real function. */
class FakeServer {
  healthy = true;
  /** op ids whose response is "lost" once (server commits, client hears nothing). */
  dropResponseFor = new Set<string>();
  failNextWith: "network" | "500" | "401" | null = null;
  outcomeOverride: ((op: OfflineOperation) => Partial<OpOutcome> | null) | null = null;
  created = new Map<string, { patient_id: string; visit_id: string }>(); // keyed by op_id
  received: OfflineOperation[] = [];
  posts = 0;
  serverClockSkewMs = 0;

  fetchFn: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/api/health")) {
      return this.healthy
        ? Response.json({
            ok: true,
            now: new Date(Date.now() + this.serverClockSkewMs).toISOString(),
          })
        : new Response("{}", { status: 503 });
    }
    this.posts++;
    if (this.failNextWith === "network") {
      this.failNextWith = null;
      throw new TypeError("network down");
    }
    if (this.failNextWith === "500") {
      this.failNextWith = null;
      return new Response("oops", { status: 500 });
    }
    if (this.failNextWith === "401") {
      this.failNextWith = null;
      return new Response("{}", { status: 401 });
    }
    const { ops } = JSON.parse(String(init?.body)) as { ops: OfflineOperation[] };
    this.received.push(...ops);
    const outcomes: OpOutcome[] = ops.map((op) => {
      const replayed = this.created.has(op.op_id);
      if (!replayed) {
        this.created.set(op.op_id, { patient_id: op.visit.patient_id, visit_id: op.visit.id });
      }
      const base: OpOutcome = {
        op_id: op.op_id,
        status: "applied",
        error_code: null,
        replayed,
        payload_hash: op.payload_hash,
        result: { ...this.created.get(op.op_id), patient_code: "T001", token_number: 7 },
      };
      return { ...base, ...(this.outcomeOverride?.(op) ?? {}) } as OpOutcome;
    });
    if (ops.some((o) => this.dropResponseFor.delete(o.op_id))) {
      throw new TypeError("connection reset after commit");
    }
    return Response.json({ outcomes });
  };
}

let server: FakeServer;
let clock: number;
const deps = (): SyncDeps => ({ fetchFn: server.fetchFn, now: () => clock, random: () => 0.5 });

beforeEach(async () => {
  await resetDbForTests();
  server = new FakeServer();
  clock = Date.now();
});

describe("syncNow", () => {
  it("sends a pending registration and marks it synced only after the server says applied", async () => {
    const op = await enqueueRegistration(SCOPE, { patient, visit }, clock);
    const report = await syncNow(SCOPE, deps());
    expect(report).toMatchObject({ ran: true, sent: 1, applied: 1 });
    const [after] = await listOps(SCOPE);
    expect(after.op_id).toBe(op.op_id);
    expect(after.status).toBe("synced");
    expect(after.result).toMatchObject({ patient_code: "T001", token_number: 7 });
    expect(after.op).toBeNull(); // details no longer kept on the device
    expect(after.display_name).toBeNull();
    expect(server.created.size).toBe(1);
  });

  it("sends the exact bytes that were saved, hash included", async () => {
    const saved = await enqueueRegistration(SCOPE, { patient, visit }, clock);
    await syncNow(SCOPE, deps());
    expect(server.received).toHaveLength(1);
    expect(server.received[0]).toEqual(saved.op);
    expect(await hashMatches(server.received[0] as never)).toBe(true);
  });

  it("measures the clock difference from the health check", async () => {
    server.serverClockSkewMs = 2 * 3_600_000;
    await enqueueRegistration(SCOPE, { patient, visit }, clock);
    await syncNow(SCOPE, deps());
    expect(Math.abs((await getClockOffset()) - 2 * 3_600_000)).toBeLessThan(5000);
  });

  it("does nothing, and loses nothing, while the cloud is unreachable", async () => {
    await enqueueRegistration(SCOPE, { patient, visit }, clock);
    server.healthy = false;
    expect(await syncNow(SCOPE, deps())).toMatchObject({ ran: false, reason: "cloud_unreachable" });
    expect(server.posts).toBe(0);
    expect((await listOps(SCOPE))[0].status).toBe("pending");
  });

  it("LOST ACKNOWLEDGEMENT: the server committed, the client never heard -- the retry sends the SAME op and creates nothing new", async () => {
    const op = await enqueueRegistration(SCOPE, { patient, visit }, clock);
    server.dropResponseFor.add(op.op_id);
    expect((await syncNow(SCOPE, deps())).retrying).toBe(1);
    expect((await listOps(SCOPE))[0].status).toBe("retryable_error");
    expect(server.created.size).toBe(1); // already committed on the server

    clock += 10 * 60_000; // past any backoff
    expect((await syncNow(SCOPE, deps())).applied).toBe(1);
    expect(server.created.size).toBe(1); // still exactly one record
    expect(server.received[0]).toEqual(server.received[1]); // byte-identical retry
    expect((await listOps(SCOPE))[0].status).toBe("synced");
  });

  it("retries many times with the same op id and still only one record exists", async () => {
    const op = await enqueueRegistration(SCOPE, { patient, visit }, clock);
    for (let i = 0; i < 4; i++) {
      server.failNextWith = "network";
      await syncNow(SCOPE, deps());
      clock += 10 * 60_000;
    }
    await syncNow(SCOPE, deps());
    expect([...server.created.keys()]).toEqual([op.op_id]);
  });

  it("a server error keeps the record queued and backs off, counting the attempt", async () => {
    await enqueueRegistration(SCOPE, { patient, visit }, clock);
    server.failNextWith = "500";
    await syncNow(SCOPE, deps());
    const [op] = await listOps(SCOPE);
    expect(op).toMatchObject({ status: "retryable_error", attempts: 1 });
    expect(op.next_attempt_at).toBeGreaterThan(clock);
    expect((await syncNow(SCOPE, deps())).reason).toBe("nothing_to_send");
  });

  it("an expired login keeps everything queued and says sign-in is needed", async () => {
    await enqueueRegistration(SCOPE, { patient, visit }, clock);
    server.failNextWith = "401";
    expect((await syncNow(SCOPE, deps())).reason).toBe("auth_required");
    expect(await listOps(SCOPE)).toMatchObject([{ status: "pending", attempts: 0 }]);
  });

  it("holds a record the server wants reviewed, keeps its details, and does not retry it by itself", async () => {
    await enqueueRegistration(SCOPE, { patient, visit }, clock);
    server.outcomeOverride = () => ({
      status: "needs_review",
      error_code: "possible_duplicate",
      result: { candidates: [{ id: "x", patient_code: "T9", matched_on: "mobile" }] },
    });
    expect((await syncNow(SCOPE, deps())).needsReview).toBe(1);
    const [op] = await listOps(SCOPE);
    expect(op).toMatchObject({ status: "needs_review", review_reason: "possible_duplicate" });
    expect(op.op).not.toBeNull();
    server.outcomeOverride = null;
    expect((await syncNow(SCOPE, deps())).reason).toBe("nothing_to_send");
  });

  it("a rejected record is kept for a person, never dropped", async () => {
    await enqueueRegistration(SCOPE, { patient, visit }, clock);
    server.outcomeOverride = () => ({
      status: "rejected",
      error_code: "visit_type_inactive",
      result: {},
    });
    await syncNow(SCOPE, deps());
    const [op] = await listOps(SCOPE);
    expect(op).toMatchObject({ status: "needs_review", review_reason: "visit_type_inactive" });
    expect(op.op?.patient?.name).toBe("Synthetic Patient");
  });

  it("an acknowledgement about a different record is NOT accepted", async () => {
    await enqueueRegistration(SCOPE, { patient, visit }, clock);
    server.outcomeOverride = () => ({
      result: { patient_id: "someone-else", visit_id: "other-visit" },
    });
    await syncNow(SCOPE, deps());
    const [op] = await listOps(SCOPE);
    expect(op).toMatchObject({ status: "needs_review", review_reason: "ack_mismatch" });
    expect(op.op).not.toBeNull();
  });

  it("an acknowledgement that echoes a different hash is NOT accepted (the server saw other bytes)", async () => {
    await enqueueRegistration(SCOPE, { patient, visit }, clock);
    server.outcomeOverride = () => ({ payload_hash: "f".repeat(64) });
    await syncNow(SCOPE, deps());
    expect((await listOps(SCOPE))[0]).toMatchObject({
      status: "needs_review",
      review_reason: "ack_mismatch",
    });
    // ...and an acknowledgement with no hash at all is not accepted either.
    await resetDbForTests();
    await enqueueRegistration(SCOPE, { patient, visit }, clock);
    server.outcomeOverride = () => ({ payload_hash: undefined });
    await syncNow(SCOPE, deps());
    expect((await listOps(SCOPE))[0].status).toBe("needs_review");
  });

  it("LOCAL CORRUPTION: a stored copy that no longer matches its hash is never sent", async () => {
    const saved = await enqueueRegistration(SCOPE, { patient, visit }, clock);
    await updateOp(saved.op_id, (o) => ({
      ...o,
      op: {
        ...(o.op as OfflineOperation),
        visit: { ...(o.op as OfflineOperation).visit, fee_amount: 99999 },
      },
    }));
    const report = await syncNow(SCOPE, deps());
    expect(report.needsReview).toBe(1);
    expect(server.posts).toBe(0);
    expect((await listOps(SCOPE))[0]).toMatchObject({
      status: "needs_review",
      review_reason: "local_corruption",
    });
  });

  it("bytes altered in transit are retried (the stored copy was verified), and held only if it keeps happening", async () => {
    await enqueueRegistration(SCOPE, { patient, visit }, clock);
    server.outcomeOverride = () => ({ status: "malformed", reason: "hash_mismatch" }) as never;
    await syncNow(SCOPE, deps());
    expect((await listOps(SCOPE))[0]).toMatchObject({ status: "retryable_error", attempts: 1 });
    for (let i = 0; i < 6; i++) {
      clock += 10 * 60_000;
      await syncNow(SCOPE, deps(), { force: true });
    }
    expect((await listOps(SCOPE))[0]).toMatchObject({
      status: "needs_review",
      review_reason: "hash_mismatch",
    });
  });

  it("REGRESSION (found by the chaos test): committed, reply lost, then the retry is corrupted in transit -- it must still end up synced, not held", async () => {
    const op = await enqueueRegistration(SCOPE, { patient, visit }, clock);
    server.dropResponseFor.add(op.op_id);
    await syncNow(SCOPE, deps()); // the server commits; the device never hears
    expect(server.created.size).toBe(1);

    clock += 10 * 60_000;
    server.outcomeOverride = () => ({ status: "malformed", reason: "hash_mismatch" }) as never;
    await syncNow(SCOPE, deps(), { force: true }); // this attempt is corrupted in transit
    expect((await listOps(SCOPE))[0].status).toBe("retryable_error");

    server.outcomeOverride = null;
    clock += 10 * 60_000;
    expect((await syncNow(SCOPE, deps())).applied).toBe(1);
    expect((await listOps(SCOPE))[0].status).toBe("synced");
    expect(server.created.size).toBe(1);
  });

  it("a paused centre leaves records untouched and looks again later", async () => {
    await enqueueRegistration(SCOPE, { patient, visit }, clock);
    server.outcomeOverride = () => ({
      status: "paused",
      reason: "offline_sync_disabled",
      result: {},
    });
    expect((await syncNow(SCOPE, deps())).reason).toBe("paused");
    const [op] = await listOps(SCOPE);
    expect(op.status).toBe("pending");
    expect(op.next_attempt_at).toBeGreaterThan(clock);
    expect(op.op).not.toBeNull();
  });

  it("two simultaneous syncs send the batch once", async () => {
    await enqueueRegistration(SCOPE, { patient, visit }, clock);
    const [a, b] = await Promise.all([syncNow(SCOPE, deps()), syncNow(SCOPE, deps())]);
    expect([a.ran, b.ran].filter(Boolean)).toHaveLength(1);
    expect(server.posts).toBe(1);
    expect(server.created.size).toBe(1);
  });

  it("an operation left 'syncing' by a crash is sent again, safely", async () => {
    const op = await enqueueRegistration(SCOPE, { patient, visit }, clock);
    await updateOp(op.op_id, (o) => ({ ...o, status: "syncing" }));
    await recoverStuckSyncing(SCOPE, clock);
    expect((await listOps(SCOPE))[0].status).toBe("retryable_error");
    expect((await syncNow(SCOPE, deps())).applied).toBe(1);
  });

  it("only sends its own scope's records", async () => {
    await enqueueRegistration("someone-else:hospital-1", { patient, visit }, clock);
    expect((await syncNow(SCOPE, deps())).reason).toBe("nothing_to_send");
  });

  it("a person pressing Sync now skips the retry wait; the automatic loop does not", async () => {
    await enqueueRegistration(SCOPE, { patient, visit }, clock);
    server.failNextWith = "500";
    await syncNow(SCOPE, deps());
    expect((await syncNow(SCOPE, deps())).reason).toBe("nothing_to_send");
    expect((await syncNow(SCOPE, deps(), { force: true })).applied).toBe(1);
  });
});

describe("backoffMs", () => {
  it("grows, is jittered, and is capped at five minutes", () => {
    expect(backoffMs(0, 1)).toBeLessThanOrEqual(2000);
    expect(backoffMs(3, 1)).toBeGreaterThan(backoffMs(0, 1));
    expect(backoffMs(30, 1)).toBeLessThanOrEqual(5 * 60_000);
    expect(backoffMs(5, 0)).toBeGreaterThanOrEqual(1000);
    expect(backoffMs(5, 0.1)).not.toBe(backoffMs(5, 0.9));
  });
});
