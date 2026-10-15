import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { OfflineOperation, OfflineOpType } from "@/lib/offline/protocol";

/**
 * The device's own durable store (IndexedDB). Everything is scoped to one
 * signed-in user at one centre (`scope`), so another account on the same
 * computer never sees or sends it.
 *
 * IndexedDB is NOT encrypted at rest. What lives here is kept to the minimum
 * (see docs/offline.md): once the server acknowledges a record, the patient's
 * details are dropped from this copy. Disk encryption on the computer is the
 * real protection for what has not synced yet.
 */

export type LocalOpStatus =
  | "pending"
  | "syncing"
  | "synced"
  | "retryable_error"
  | "needs_review"
  /** Settled by a newer operation (kept for history). */
  | "resolved"
  /** Set aside by a person on purpose (kept; never deleted). */
  | "discarded";

export interface LocalOp {
  op_id: string;
  scope: string;
  status: LocalOpStatus;
  op_type: OfflineOpType;
  created_at: number;
  /** The full operation. Dropped (null) once the server acknowledged it. */
  op: OfflineOperation | null;
  /** The hash recorded at save time; survives `op` being dropped. */
  payload_hash: string;
  patient_id: string | null;
  visit_id: string | null;
  /** Provisional number shown on the slip until the real token is assigned. */
  label: string;
  /** For the saved-records list only; cleared on acknowledgement. */
  display_name: string | null;
  attempts: number;
  next_attempt_at: number;
  last_error: string | null;
  /** Why a person has to look at it (possible_duplicate, a server code, ...). */
  review_reason: string | null;
  /** The server's answer: real patient code / token, or possible-match ids. */
  result: Record<string, unknown> | null;
  synced_at: number | null;
}

interface OfflineSchema extends DBSchema {
  ops: {
    key: string;
    value: LocalOp;
    indexes: { by_scope: string };
  };
  meta: {
    key: string;
    value: { key: string; value: unknown };
  };
}

export const DB_NAME = "clinicos-offline";
export type OfflineDb = IDBPDatabase<OfflineSchema>;

let dbPromise: Promise<OfflineDb> | null = null;

export function getDb(): Promise<OfflineDb> {
  if (!dbPromise) {
    dbPromise = openDB<OfflineSchema>(DB_NAME, 1, {
      upgrade(db) {
        const ops = db.createObjectStore("ops", { keyPath: "op_id" });
        ops.createIndex("by_scope", "scope");
        db.createObjectStore("meta", { keyPath: "key" });
      },
      terminated() {
        // The browser dropped the connection (e.g. storage cleared): reopen next time.
        dbPromise = null;
      },
    }).catch((e) => {
      dbPromise = null;
      throw e;
    });
  }
  return dbPromise;
}

/** For tests: closes the connection (data stays), as a closed browser tab would. */
export async function closeDbForTests(): Promise<void> {
  if (dbPromise) {
    (await dbPromise.catch(() => null))?.close();
    dbPromise = null;
  }
}

/** For tests: closes and deletes the database. */
export async function resetDbForTests(): Promise<void> {
  await closeDbForTests();
  await deleteDB(DB_NAME);
}

export function scopeOf(userId: string, hospitalId: string): string {
  return `${userId}:${hospitalId}`;
}

// --- tell other tabs something changed (counts, lists) ----------------------

const CHANNEL = "clinicos-offline";

export function announceChange(): void {
  try {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage("changed");
    channel.close();
  } catch {
    // best effort
  }
}

export function onChange(handler: () => void): () => void {
  if (typeof BroadcastChannel === "undefined") return () => undefined;
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = handler;
  return () => channel.close();
}

// --- storage health ---------------------------------------------------------

export interface StorageReport {
  /** The browser promised not to evict this data under storage pressure. */
  persisted: boolean;
  usageBytes: number | null;
  quotaBytes: number | null;
  /** Less than ~25 MB left (a registration is a few KB, so this is generous). */
  low: boolean;
}

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function storageReport(): Promise<StorageReport> {
  let persisted = false;
  let usage: number | null = null;
  let quota: number | null = null;
  try {
    persisted = (await navigator.storage?.persisted?.()) ?? false;
    const est = await navigator.storage?.estimate?.();
    usage = est?.usage ?? null;
    quota = est?.quota ?? null;
  } catch {
    // unsupported: report what we know
  }
  const low = usage !== null && quota !== null && quota - usage < 25 * 1024 * 1024;
  return { persisted, usageBytes: usage, quotaBytes: quota, low };
}
