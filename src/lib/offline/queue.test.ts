// @vitest-environment node
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { operationHash } from "@/lib/offline/canonical";
import { closeDbForTests, getDb, resetDbForTests } from "@/lib/offline/db";
import { recordServerTime } from "@/lib/offline/clock";
import {
  MAX_OPEN_OPS,
  OfflineSaveError,
  clearScope,
  discardOp,
  enqueueRegistration,
  exportUnsynced,
  findLookalike,
  istDate,
  listOps,
  oldestUnsyncedAge,
  resolveAsNew,
  resolveUseExisting,
  updateOp,
} from "@/lib/offline/queue";
import { SYNTHETIC_PATIENT as patient, SYNTHETIC_VISIT as visit } from "@/lib/offline/test-helpers";

const SCOPE = "user-a:hospital-1";
const OTHER_SCOPE = "user-b:hospital-1";

beforeEach(async () => {
  await resetDbForTests();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("enqueueRegistration", () => {
  it("saves one pending operation with stable ids, a valid hash and a provisional number", async () => {
    const op = await enqueueRegistration(SCOPE, { patient, visit });
    expect(op.status).toBe("pending");
    expect(op.label).toMatch(/^[0-9A-F]{2}-1$/);
    expect(op.op?.patient?.id).toBe(op.patient_id);
    expect(op.op?.visit.patient_id).toBe(op.patient_id);
    expect(op.op?.visit.visit_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(op.payload_hash).toBe(await operationHash(op.op as never));
  });

  it("the operation survives closing and reopening the browser", async () => {
    const saved = await enqueueRegistration(SCOPE, { patient, visit });
    await closeDbForTests(); // as if the tab/browser was closed right after saving
    const after = await listOps(SCOPE);
    expect(after).toHaveLength(1);
    expect(after[0].op_id).toBe(saved.op_id);
    expect(await operationHash(after[0].op as never)).toBe(saved.payload_hash);
  });

  it("numbers consecutive records on the same device 1, 2, 3", async () => {
    const a = await enqueueRegistration(SCOPE, { patient, visit });
    const b = await enqueueRegistration(SCOPE, { patient, visit });
    const c = await enqueueRegistration(SCOPE, { patient, visit });
    const n = (l: string) => Number(l.split("-")[1]);
    expect([n(a.label), n(b.label), n(c.label)]).toEqual([1, 2, 3]);
    expect(a.label.split("-")[0]).toBe(c.label.split("-")[0]);
  });

  it("a storage failure is reported as a failure and stores nothing (not even a number)", async () => {
    await enqueueRegistration(SCOPE, { patient, visit });
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    await expect(enqueueRegistration(SCOPE, { patient, visit })).rejects.toMatchObject({
      name: "OfflineSaveError",
      kind: "storage_full",
    });
    vi.restoreAllMocks();
    expect(await listOps(SCOPE)).toHaveLength(1);
    const next = await enqueueRegistration(SCOPE, { patient, visit });
    expect(next.label.endsWith("-2")).toBe(true);
  });

  it("other storage errors also refuse to claim success", async () => {
    await getDb(); // let the database open first
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => {
      throw new DOMException("nope", "UnknownError");
    });
    await expect(enqueueRegistration(SCOPE, { patient, visit })).rejects.toBeInstanceOf(
      OfflineSaveError,
    );
  });

  it("READ-BACK: data that reaches disk altered is not reported as saved", async () => {
    await getDb();
    const original = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ) {
      const v = value as { op?: { patient?: { name: string } } };
      if (this.name === "ops" && v.op?.patient) {
        v.op = { ...v.op, patient: { ...v.op.patient, name: "Changed By Corruption" } };
      }
      return original.call(this, value, key);
    });
    await expect(enqueueRegistration(SCOPE, { patient, visit })).rejects.toMatchObject({
      kind: "verify_failed",
    });
  });

  it("refuses a new record when the queue is full", async () => {
    const db = await getDb();
    const base = await enqueueRegistration(SCOPE, { patient, visit });
    for (let i = 0; i < MAX_OPEN_OPS; i++) {
      await db.put("ops", { ...base, op_id: `fill-${i}`, status: "pending" });
    }
    await expect(enqueueRegistration(SCOPE, { patient, visit })).rejects.toMatchObject({
      kind: "queue_full",
    });
  });
});

describe("clock correction", () => {
  it("dates a record with the device clock corrected to the server's", async () => {
    // The device clock is 3 hours behind the server.
    const deviceNow = Date.now();
    await recordServerTime(deviceNow + 3 * 3_600_000, deviceNow, deviceNow);
    const op = await enqueueRegistration(SCOPE, { patient, visit });
    expect(Math.abs((op.op?.clock_offset_ms ?? 0) - 3 * 3_600_000)).toBeLessThan(5000);
    const created = new Date(op.op!.client_created_at).getTime();
    expect(Math.abs(created - (Date.now() + 3 * 3_600_000))).toBeLessThan(5000);
    expect(op.op?.visit.visit_date).toBe(istDate(created));
  });

  it("uses the raw device clock when nothing has been measured", async () => {
    const op = await enqueueRegistration(SCOPE, { patient, visit });
    expect(op.op?.clock_offset_ms).toBe(0);
  });
});

describe("double-entry guard and age of waiting records", () => {
  it("spots the same person already saved here, but not someone else", async () => {
    const withMobile = { ...patient, mobile: "9000000001" };
    await enqueueRegistration(SCOPE, { patient: withMobile, visit });
    expect(
      await findLookalike(SCOPE, { ...withMobile, name: "  synthetic   PATIENT " }),
    ).not.toBeNull();
    expect(await findLookalike(SCOPE, { ...withMobile, mobile: "9000000002" })).toBeNull();
    expect(await findLookalike(SCOPE, { ...withMobile, name: "Someone Else" })).toBeNull();
    expect(await findLookalike(OTHER_SCOPE, withMobile)).toBeNull();
  });

  it("reports how long the oldest unsynced record has been waiting", async () => {
    expect(await oldestUnsyncedAge(SCOPE)).toBeNull();
    const t = Date.now() - 5 * 3_600_000;
    await enqueueRegistration(SCOPE, { patient, visit }, t);
    const age = await oldestUnsyncedAge(SCOPE);
    expect(age).toBeGreaterThan(4.9 * 3_600_000);
  });
});

describe("scoping", () => {
  it("never shows another user's records", async () => {
    await enqueueRegistration(SCOPE, { patient, visit });
    expect(await listOps(OTHER_SCOPE)).toHaveLength(0);
  });

  it("clearing refuses while anything is unsynced, and only wipes its own scope when forced", async () => {
    await enqueueRegistration(SCOPE, { patient, visit });
    await enqueueRegistration(OTHER_SCOPE, { patient, visit });
    expect(await clearScope(SCOPE)).toBe(false);
    expect(await listOps(SCOPE)).toHaveLength(1);
    expect(await clearScope(SCOPE, { force: true })).toBe(true);
    expect(await listOps(SCOPE)).toHaveLength(0);
    expect(await listOps(OTHER_SCOPE)).toHaveLength(1);
  });

  it("clears freely once everything is synced", async () => {
    const op = await enqueueRegistration(SCOPE, { patient, visit });
    await updateOp(op.op_id, (o) => ({ ...o, status: "synced", op: null }));
    expect(await clearScope(SCOPE)).toBe(true);
  });
});

describe("settling a held record", () => {
  async function held() {
    const op = await enqueueRegistration(SCOPE, { patient, visit });
    await updateOp(op.op_id, (o) => ({
      ...o,
      status: "needs_review",
      review_reason: "possible_duplicate",
    }));
    return op;
  }

  it("register as new: a NEW op id and hash point back at the held one; the held one is kept", async () => {
    const op = await held();
    const next = await resolveAsNew(op.op_id);
    expect(next.op_id).not.toBe(op.op_id);
    expect(next.op?.confirm_new).toBe(true);
    expect(next.op?.resolves_op_id).toBe(op.op_id);
    expect(next.patient_id).toBe(op.patient_id);
    expect(next.payload_hash).not.toBe(op.payload_hash);
    expect(await operationHash(next.op as never)).toBe(next.payload_hash);
    const all = await listOps(SCOPE);
    expect(all.find((o) => o.op_id === op.op_id)?.status).toBe("resolved");
    expect(all.find((o) => o.op_id === next.op_id)?.status).toBe("pending");
  });

  it("use existing: the typed patient details are not sent, and the hash covers the new content", async () => {
    const op = await held();
    const existing = "22222222-2222-4222-8222-222222222222";
    const next = await resolveUseExisting(op.op_id, existing);
    expect(next.op?.op_type).toBe("create_visit");
    expect(next.op?.patient).toBeUndefined();
    expect(next.op?.visit.patient_id).toBe(existing);
    expect(JSON.stringify(next.op)).not.toContain("Synthetic Patient");
    expect(await operationHash(next.op as never)).toBe(next.payload_hash);
  });

  it("only a held record can be settled, and only once", async () => {
    const fresh = await enqueueRegistration(SCOPE, { patient, visit });
    await expect(resolveAsNew(fresh.op_id)).rejects.toThrow();
    const op = await held();
    await resolveAsNew(op.op_id);
    await expect(resolveAsNew(op.op_id)).rejects.toThrow();
    await expect(
      resolveUseExisting(op.op_id, "22222222-2222-4222-8222-222222222222"),
    ).rejects.toThrow();
    const settled = (await listOps(SCOPE)).filter((o) => o.op?.resolves_op_id === op.op_id);
    expect(settled).toHaveLength(1); // exactly one follow-up, however many attempts
  });
});

describe("discard and export", () => {
  it("discarding keeps the record, and an export lists unsynced records", async () => {
    const a = await enqueueRegistration(SCOPE, { patient, visit });
    const b = await enqueueRegistration(SCOPE, { patient, visit });
    await updateOp(a.op_id, (o) => ({ ...o, status: "needs_review" }));
    await discardOp(a.op_id);
    expect((await listOps(SCOPE)).find((o) => o.op_id === a.op_id)?.status).toBe("discarded");
    const exported = JSON.parse(await exportUnsynced(SCOPE));
    const ids = exported.operations.map((o: { op_id: string }) => o.op_id);
    expect(ids).toContain(b.op_id);
    expect(ids).toContain(a.op_id); // set aside but never deleted, so still recoverable
  });

  it("does not discard a record that is still pending", async () => {
    const op = await enqueueRegistration(SCOPE, { patient, visit });
    await discardOp(op.op_id);
    expect((await listOps(SCOPE))[0].status).toBe("pending");
  });
});
