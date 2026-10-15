import { announceChange, getDb, type LocalOp, type OfflineDb } from "@/lib/offline/db";
import { correctedNow } from "@/lib/offline/clock";
import { operationHash, withHash } from "@/lib/offline/canonical";
import {
  OFFLINE_SCHEMA_VERSION,
  type OfflineOperation,
  type OfflinePatientPayload,
  type OfflineVisitPayload,
} from "@/lib/offline/protocol";
import type { PatientFields } from "@/lib/patients/parse";

/**
 * Saving to, reading from and settling operations in the device queue.
 * Nothing in this file talks to the network (see sync.ts), and nothing here
 * ever deletes an operation: operations only move between states.
 *
 * IndexedDB rule that shapes this file: a transaction closes itself as soon as
 * the code awaits anything that is not an IndexedDB request (like hashing).
 * So every hash is computed BEFORE a write transaction opens, and a write that
 * depends on what was read re-checks it inside the write transaction.
 */

/** A hard stop so a forgotten queue cannot fill the disk. */
export const MAX_OPEN_OPS = 500;

export class OfflineSaveError extends Error {
  constructor(
    message: string,
    public readonly kind: "storage_full" | "storage_unavailable" | "queue_full" | "verify_failed",
  ) {
    super(message);
    this.name = "OfflineSaveError";
  }
}

/** India date (yyyy-mm-dd) for a timestamp -- the same day boundary as the visits queue. */
export function istDate(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(ms));
}

export function toPatientPayload(id: string, f: PatientFields): OfflinePatientPayload {
  return {
    id,
    name: f.name,
    mobile: f.mobile,
    dob: f.dob,
    approximate_age_years: f.approximateAgeYears,
    guardian_name: f.guardianName,
    guardian_relation: f.guardianRelation,
    gender: f.gender,
    address: f.address,
    living_sons: f.livingSons,
    living_sons_ages: f.livingSonsAges,
    living_daughters: f.livingDaughters,
    living_daughters_ages: f.livingDaughtersAges,
  };
}

export interface VisitInput {
  visitTypeId: string;
  doctorId: string | null;
  notes: string | null;
  referredByName: string | null;
  referredByHospital: string | null;
  feeAmount: number;
  followUpDate: string | null;
  lmpDate: string | null;
}

function toVisitPayload(
  id: string,
  patientId: string,
  v: VisitInput,
  visitDate: string,
): OfflineVisitPayload {
  return {
    id,
    patient_id: patientId,
    visit_type_id: v.visitTypeId,
    doctor_id: v.doctorId,
    visit_date: visitDate,
    notes: v.notes,
    referred_by_name: v.referredByName,
    referred_by_hospital: v.referredByHospital,
    fee_amount: v.feeAmount,
    follow_up_date: v.followUpDate,
    lmp_date: v.lmpDate,
  };
}

function wrapStorageError(e: unknown): OfflineSaveError {
  if (e instanceof OfflineSaveError) return e;
  const name = (e as { name?: string } | null)?.name ?? "";
  if (name === "QuotaExceededError") {
    return new OfflineSaveError(
      "This computer has no room left to save offline records. Nothing was saved.",
      "storage_full",
    );
  }
  return new OfflineSaveError(
    "Could not save on this computer. Nothing was saved — write it on paper and try again later.",
    "storage_unavailable",
  );
}

// --- the device's identity ---------------------------------------------------

interface DeviceInfo {
  id: string;
  /** Two characters, enough to tell computers apart on a provisional slip number. */
  code: string;
}

async function getDevice(db: OfflineDb): Promise<DeviceInfo> {
  const existing = (await db.get("meta", "device"))?.value as DeviceInfo | undefined;
  if (existing) return existing;
  const id = crypto.randomUUID();
  const device = { id, code: id.replace(/-/g, "").slice(0, 2).toUpperCase() };
  // Written on its own, durably, before any record uses it.
  await db.put("meta", { key: "device", value: device });
  return device;
}

const isOpenStatus = (s: LocalOp["status"]) =>
  s === "pending" || s === "syncing" || s === "retryable_error" || s === "needs_review";

/** Things a person still has to act on or wait for. */
export function isOpen(op: LocalOp): boolean {
  return isOpenStatus(op.status);
}

// --- reading -------------------------------------------------------------------

export async function listOps(scope: string): Promise<LocalOp[]> {
  const db = await getDb();
  const all = await db.getAllFromIndex("ops", "by_scope", scope);
  return all.sort((a, b) => a.created_at - b.created_at);
}

export async function getOp(opId: string): Promise<LocalOp | undefined> {
  return (await getDb()).get("ops", opId);
}

export async function countOpen(scope: string): Promise<{ waiting: number; needsReview: number }> {
  const ops = await listOps(scope);
  return {
    waiting: ops.filter((o) => ["pending", "syncing", "retryable_error"].includes(o.status)).length,
    needsReview: ops.filter((o) => o.status === "needs_review").length,
  };
}

/** Age in ms of the oldest record that has still not reached the cloud (null if none). */
export async function oldestUnsyncedAge(
  scope: string,
  now: number = Date.now(),
): Promise<number | null> {
  const open = (await listOps(scope)).filter((o) => isOpen(o) && o.op);
  return open.length ? now - Math.min(...open.map((o) => o.created_at)) : null;
}

const normalizeName = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * A record already saved here (and not yet in the cloud) that looks like the
 * same person -- the same name and the same mobile or date of birth. Used to
 * stop an accidental double entry BEFORE it is queued; the server's own
 * duplicate check remains the real safeguard.
 */
export async function findLookalike(scope: string, f: PatientFields): Promise<LocalOp | null> {
  const name = normalizeName(f.name);
  for (const op of await listOps(scope)) {
    const p = op.op?.patient;
    if (!p || !isOpen(op)) continue;
    if (normalizeName(p.name) !== name) continue;
    if ((f.mobile && p.mobile === f.mobile) || (f.dob && p.dob === f.dob)) return op;
  }
  return null;
}

// --- writing --------------------------------------------------------------------

/**
 * Saves a new patient + visit as ONE queued operation, in ONE transaction, and
 * reads it back to prove it was stored intact. Resolves only after that; any
 * failure throws OfflineSaveError and nothing remains -- the caller must then
 * NOT tell the user it was saved.
 */
export async function enqueueRegistration(
  scope: string,
  input: { patient: PatientFields; visit: VisitInput },
  nowOverride?: number,
): Promise<LocalOp> {
  const patientId = crypto.randomUUID();
  const visitId = crypto.randomUUID();
  const opId = crypto.randomUUID();

  let db: OfflineDb;
  let device: DeviceInfo;
  let created: number;
  let offset = 0;
  try {
    db = await getDb();
    const open = await countOpen(scope);
    if (open.waiting + open.needsReview >= MAX_OPEN_OPS) {
      throw new OfflineSaveError(
        "Too many records are waiting on this computer. Connect to the internet so they can sync before adding more.",
        "queue_full",
      );
    }
    device = await getDevice(db);
    if (nowOverride === undefined) {
      const c = await correctedNow();
      created = c.now;
      offset = c.offset;
    } else {
      created = nowOverride;
    }
  } catch (e) {
    throw wrapStorageError(e);
  }

  const visitDate = istDate(created);
  const op = (await withHash({
    op_id: opId,
    op_type: "register_patient_and_visit",
    schema_version: OFFLINE_SCHEMA_VERSION,
    device_id: device.id,
    client_created_at: new Date(created).toISOString(),
    clock_offset_ms: offset,
    patient: toPatientPayload(patientId, input.patient),
    visit: toVisitPayload(visitId, patientId, input.visit, visitDate),
  })) as OfflineOperation;

  let tx: ReturnType<typeof beginWriteTx> | undefined;
  try {
    tx = beginWriteTx(db);
    const meta = tx.objectStore("meta");
    const seqKey = `seq:${visitDate}`;
    const seq = (((await meta.get(seqKey))?.value as number | undefined) ?? 0) + 1;
    await meta.put({ key: seqKey, value: seq });
    const local: LocalOp = {
      op_id: opId,
      scope,
      status: "pending",
      op_type: op.op_type,
      created_at: created,
      op,
      payload_hash: op.payload_hash,
      patient_id: patientId,
      visit_id: visitId,
      label: `${device.code}-${seq}`,
      display_name: input.patient.name,
      attempts: 0,
      next_attempt_at: 0,
      last_error: null,
      review_reason: null,
      result: null,
      synced_at: null,
    };
    await tx.objectStore("ops").put(local);
    await tx.done;
  } catch (e) {
    // Undo the provisional-number bump too: a failed save leaves no trace.
    try {
      tx?.done.catch(() => undefined); // aborting rejects `done`; expected here
      tx?.abort();
    } catch {
      // already finished or aborted
    }
    throw wrapStorageError(e);
  }

  // Read it back: the record is "saved" only if what is on disk hashes to what
  // was meant to be written.
  try {
    const stored = await db.get("ops", opId);
    if (
      !stored?.op ||
      (await operationHash(stored.op as unknown as Record<string, unknown>)) !== op.payload_hash
    ) {
      throw new OfflineSaveError(
        "The record could not be verified after saving. Nothing was saved — write it on paper and try again.",
        "verify_failed",
      );
    }
    announceChange();
    return stored;
  } catch (e) {
    throw wrapStorageError(e);
  }
}

function beginWriteTx(db: OfflineDb) {
  // "strict": the browser must flush to disk before reporting completion, so
  // "saved" survives an immediate power loss or browser close.
  return db.transaction(["ops", "meta"], "readwrite", { durability: "strict" });
}

/** Applies `fn` to one operation inside one transaction (never deletes). */
export async function updateOp(
  opId: string,
  fn: (op: LocalOp) => LocalOp | null,
): Promise<LocalOp | undefined> {
  const db = await getDb();
  const tx = db.transaction("ops", "readwrite", { durability: "strict" });
  const current = await tx.store.get(opId);
  if (!current) {
    await tx.done;
    return undefined;
  }
  const next = fn(current);
  if (next) await tx.store.put(next);
  await tx.done;
  announceChange();
  return next ?? current;
}

async function settleHold(
  opId: string,
  build: (held: LocalOp, newOpId: string) => Promise<LocalOp>,
  now: number,
): Promise<LocalOp> {
  const db = await getDb();
  const held = await db.get("ops", opId);
  if (!held || held.status !== "needs_review" || !held.op) {
    throw new Error("That record is not waiting for review.");
  }
  const newOpId = crypto.randomUUID();
  const next = await build(held, newOpId); // hashing happens here, outside any transaction
  next.created_at = now;

  // Compare-and-set: only if the held record is still exactly as it was read.
  const tx = db.transaction("ops", "readwrite", { durability: "strict" });
  const again = await tx.store.get(opId);
  if (!again || again.status !== "needs_review" || again.payload_hash !== held.payload_hash) {
    await tx.done;
    throw new Error("That record changed while you were working on it. Open the list again.");
  }
  await tx.store.put(next);
  await tx.store.put({ ...again, status: "resolved" });
  await tx.done;
  announceChange();
  return next;
}

/**
 * "Register as new" after a possible-duplicate hold: a NEW operation (new
 * op_id, same patient/visit ids) that points back at the held one. The held
 * one is kept, marked resolved.
 */
export async function resolveAsNew(opId: string, now: number = Date.now()): Promise<LocalOp> {
  return settleHold(
    opId,
    async (held, newOpId) => {
      const op = (await withHash({
        ...(held.op as OfflineOperation),
        op_id: newOpId,
        confirm_new: true,
        resolves_op_id: held.op_id,
      })) as OfflineOperation;
      return {
        ...held,
        op_id: newOpId,
        status: "pending",
        op,
        payload_hash: op.payload_hash,
        attempts: 0,
        next_attempt_at: 0,
        last_error: null,
        review_reason: null,
        result: null,
      };
    },
    now,
  );
}

/**
 * "Use the existing patient": the visit is attached to a patient already in
 * the cloud; the locally typed patient details are NOT sent and nothing on the
 * existing patient changes.
 */
export async function resolveUseExisting(
  opId: string,
  existingPatientId: string,
  now: number = Date.now(),
): Promise<LocalOp> {
  return settleHold(
    opId,
    async (held, newOpId) => {
      const { patient, ...rest } = held.op as OfflineOperation;
      void patient;
      const op = (await withHash({
        ...rest,
        op_id: newOpId,
        op_type: "create_visit",
        resolves_op_id: held.op_id,
        visit: { ...(held.op as OfflineOperation).visit, patient_id: existingPatientId },
      })) as OfflineOperation;
      return {
        ...held,
        op_id: newOpId,
        op_type: "create_visit",
        status: "pending",
        op,
        payload_hash: op.payload_hash,
        patient_id: existingPatientId,
        attempts: 0,
        next_attempt_at: 0,
        last_error: null,
        review_reason: null,
        result: null,
      };
    },
    now,
  );
}

/** Sets an operation aside on purpose. It is kept, never deleted. */
export async function discardOp(opId: string): Promise<void> {
  await updateOp(opId, (op) =>
    op.status === "needs_review" || op.status === "retryable_error"
      ? { ...op, status: "discarded" }
      : op,
  );
}

/** Everything not yet acknowledged, as JSON text a person can save as a file. */
export async function exportUnsynced(scope: string): Promise<string> {
  const ops = (await listOps(scope)).filter(
    (o) => o.status !== "synced" && o.status !== "resolved" && o.op,
  );
  return JSON.stringify(
    {
      exported_at: new Date().toISOString(),
      schema_version: OFFLINE_SCHEMA_VERSION,
      operations: ops,
    },
    null,
    2,
  );
}

/**
 * Wipes one scope's local data (logout, account switch, offline time limit).
 * Refuses while anything is still unsynced, unless `force` -- losing an unsent
 * registration must be an explicit decision, never a side effect. Returns
 * whether it wiped.
 */
export async function clearScope(scope: string, opts: { force?: boolean } = {}): Promise<boolean> {
  const db = await getDb();
  const tx = db.transaction("ops", "readwrite");
  const all = await tx.store.index("by_scope").getAll(scope);
  if (all.some((o) => isOpen(o) && o.op) && !opts.force) {
    await tx.done;
    return false;
  }
  let cursor = await tx.store.index("by_scope").openCursor(scope);
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
  announceChange();
  return true;
}
