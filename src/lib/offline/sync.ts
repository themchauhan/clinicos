import type { LocalOp } from "@/lib/offline/db";
import { hashMatches } from "@/lib/offline/canonical";
import { recordServerTime } from "@/lib/offline/clock";
import { listOps, updateOp } from "@/lib/offline/queue";
import { MAX_OPS_PER_BATCH, type OpOutcome, type SyncResponse } from "@/lib/offline/protocol";

/**
 * Sends queued operations to the server and records what came back.
 *
 * The rules that keep data accurate:
 *  - one sync at a time per computer (a Web Lock shared by every tab);
 *  - cloud reachability is verified with a real health check, not
 *    navigator.onLine (and the same call measures the clock difference);
 *  - before sending, each stored copy is re-hashed; a copy that no longer
 *    matches the hash made when it was saved is held for a person, never sent;
 *  - an operation is marked synced ONLY when the server answers "applied" for
 *    exactly that op_id, echoes the SAME hash, and names the same patient and
 *    visit -- anything else leaves it queued or in review;
 *  - every retry re-sends the SAME op_id and bytes, so a retry can never create
 *    a second record (the server is idempotent);
 *  - nothing is ever deleted here; once acknowledged, the stored patient
 *    details are dropped (the cloud has them) to keep local PII small.
 */

const LOCK_NAME = "clinicos-offline-sync";
const HEALTH_TIMEOUT_MS = 4000;
const SYNC_TIMEOUT_MS = 20_000;
const MAX_BACKOFF_MS = 5 * 60_000;
/** After this many bytes-altered-in-transit answers in a row, a person looks at it. */
const MAX_TRANSIT_CORRUPTIONS = 5;

export interface SyncDeps {
  fetchFn: typeof fetch;
  now: () => number;
  random: () => number;
}

const defaultDeps: SyncDeps = {
  fetchFn: (...args) => fetch(...args),
  now: () => Date.now(),
  random: () => Math.random(),
};

export interface SyncReport {
  ran: boolean;
  reason?: "already_running" | "cloud_unreachable" | "nothing_to_send" | "auth_required" | "paused";
  sent: number;
  applied: number;
  needsReview: number;
  retrying: number;
}

const idle = (reason: SyncReport["reason"]): SyncReport => ({
  ran: false,
  reason,
  sent: 0,
  applied: 0,
  needsReview: 0,
  retrying: 0,
});

/** Exponential backoff with full jitter, 1 s .. 5 min. */
export function backoffMs(attempts: number, random: number): number {
  const ceiling = Math.min(MAX_BACKOFF_MS, 2000 * 2 ** Math.max(0, attempts));
  return Math.max(1000, Math.floor(random * ceiling));
}

export async function isCloudReachable(
  deps: Pick<SyncDeps, "fetchFn"> = defaultDeps,
): Promise<boolean> {
  const t0 = Date.now();
  try {
    const res = await deps.fetchFn("/api/health", {
      cache: "no-store",
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { ok?: boolean; now?: string };
    if (body.ok !== true) return false;
    if (typeof body.now === "string") {
      await recordServerTime(new Date(body.now).getTime(), t0, Date.now());
    }
    return true;
  } catch {
    return false;
  }
}

let inProcessFlight = false;

/** Runs `fn` only if no other tab/process on this computer is syncing. */
async function singleFlight<T>(fn: () => Promise<T>): Promise<T | null> {
  if (typeof navigator !== "undefined" && navigator.locks?.request) {
    return navigator.locks.request(LOCK_NAME, { ifAvailable: true }, async (lock) =>
      lock ? fn() : null,
    );
  }
  if (inProcessFlight) return null;
  inProcessFlight = true;
  try {
    return await fn();
  } finally {
    inProcessFlight = false;
  }
}

/**
 * After a crash or a closed tab mid-request, an operation can be left
 * "syncing". It is safe to send again (idempotent), so put it back in line.
 */
export async function recoverStuckSyncing(scope: string, now: number = Date.now()): Promise<void> {
  for (const op of await listOps(scope)) {
    if (op.status === "syncing") {
      await updateOp(op.op_id, (o) =>
        o.status === "syncing" ? { ...o, status: "retryable_error", next_attempt_at: now } : o,
      );
    }
  }
}

function isDue(op: LocalOp, now: number, force = false): boolean {
  return (
    (op.status === "pending" || op.status === "retryable_error") &&
    (force || op.next_attempt_at <= now) &&
    op.op !== null
  );
}

/**
 * `force` is for a person pressing "Sync now": it ignores the backoff wait
 * (retrying is always safe -- the server is idempotent) but nothing else.
 */
export async function syncNow(
  scope: string,
  deps: SyncDeps = defaultDeps,
  opts: { force?: boolean } = {},
): Promise<SyncReport> {
  const out = await singleFlight(() => runSync(scope, deps, opts.force === true));
  return out ?? idle("already_running");
}

async function runSync(scope: string, deps: SyncDeps, force: boolean): Promise<SyncReport> {
  const now = deps.now();
  const all = await listOps(scope);

  // Oldest first.
  const due = all.filter((o) => isDue(o, now, force)).slice(0, MAX_OPS_PER_BATCH);
  if (due.length === 0) return idle("nothing_to_send");

  if (!(await isCloudReachable(deps))) return idle("cloud_unreachable");

  // Integrity check of the stored copies BEFORE anything leaves the computer.
  const sendable: LocalOp[] = [];
  const report: SyncReport = { ran: true, sent: 0, applied: 0, needsReview: 0, retrying: 0 };
  for (const op of due) {
    if (await hashMatches(op.op as unknown as Record<string, unknown>)) {
      sendable.push(op);
    } else {
      await updateOp(op.op_id, (o) => ({
        ...o,
        status: "needs_review",
        review_reason: "local_corruption",
      }));
      report.needsReview++;
    }
  }
  if (sendable.length === 0) return report;

  // Persist "syncing" BEFORE sending, so a crash is recoverable.
  const claimed: LocalOp[] = [];
  for (const op of sendable) {
    const updated = await updateOp(op.op_id, (o) =>
      isDue(o, now, force) ? { ...o, status: "syncing" } : o,
    );
    if (updated?.status === "syncing" && updated.op) claimed.push(updated);
  }
  if (claimed.length === 0) return report;
  report.sent = claimed.length;

  const retryLater = async (op: LocalOp, error: string, countAttempt: boolean) =>
    updateOp(op.op_id, (o) => {
      const attempts = o.attempts + (countAttempt ? 1 : 0);
      return {
        ...o,
        status: "retryable_error",
        attempts,
        last_error: error,
        next_attempt_at: deps.now() + backoffMs(attempts, deps.random()),
      };
    });

  let response: Response;
  try {
    response = await deps.fetchFn("/api/offline/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ops: claimed.map((o) => o.op) }),
      cache: "no-store",
      signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
    });
  } catch {
    // The request may or may not have reached the server. Retrying the same
    // op_id is safe either way.
    for (const op of claimed) await retryLater(op, "network", false);
    report.retrying = claimed.length;
    return report;
  }

  if (response.status === 401 || response.status === 403) {
    for (const op of claimed) await updateOp(op.op_id, (o) => ({ ...o, status: "pending" }));
    return { ...report, reason: "auth_required" };
  }

  let body: SyncResponse | null = null;
  try {
    body = response.ok ? ((await response.json()) as SyncResponse) : null;
  } catch {
    body = null;
  }
  if (!body || !Array.isArray(body.outcomes)) {
    for (const op of claimed) await retryLater(op, `http_${response.status}`, true);
    report.retrying = claimed.length;
    return report;
  }

  const outcomeById = new Map<string, OpOutcome>(body.outcomes.map((o) => [o.op_id, o]));

  for (const op of claimed) {
    const outcome = outcomeById.get(op.op_id);

    if (!outcome || outcome.status === "retry") {
      await retryLater(op, outcome?.status === "retry" ? outcome.reason : "no_answer", true);
      report.retrying++;
      continue;
    }
    if (outcome.status === "skipped") {
      await updateOp(op.op_id, (o) => ({ ...o, status: "pending" }));
      continue;
    }
    if (outcome.status === "paused") {
      // Sync is switched off for the centre (or the subscription lapsed): keep
      // everything exactly as it is and look again later.
      await updateOp(op.op_id, (o) => ({
        ...o,
        status: "pending",
        last_error: outcome.reason ?? "paused",
        next_attempt_at: deps.now() + 60_000,
      }));
      report.reason = "paused";
      continue;
    }
    if (outcome.status === "malformed") {
      // The stored copy was verified against its hash just before sending, so a
      // hash mismatch reported by the server means the bytes were altered IN
      // TRANSIT. That is transient: the same bytes are sent again (an earlier
      // attempt may even have been committed already). Only if it keeps
      // happening is it held for a person.
      if (outcome.reason === "hash_mismatch" && op.attempts + 1 < MAX_TRANSIT_CORRUPTIONS) {
        await retryLater(op, "hash_mismatch", true);
        report.retrying++;
        continue;
      }
      await updateOp(op.op_id, (o) => ({
        ...o,
        status: "needs_review",
        review_reason: outcome.reason,
      }));
      report.needsReview++;
      continue;
    }

    // Every verdict must be about exactly what was sent.
    if (outcome.payload_hash !== op.payload_hash) {
      await updateOp(op.op_id, (o) => ({
        ...o,
        status: "needs_review",
        review_reason: "ack_mismatch",
      }));
      report.needsReview++;
      continue;
    }
    if (outcome.status === "needs_review" || outcome.status === "rejected") {
      await updateOp(op.op_id, (o) => ({
        ...o,
        status: "needs_review",
        review_reason: outcome.error_code ?? outcome.status,
        result: outcome.result,
      }));
      report.needsReview++;
      continue;
    }

    // "applied": also check it names this very patient and visit.
    const result = outcome.result;
    const matches =
      result.visit_id === op.visit_id &&
      (op.op_type === "create_visit" || result.patient_id === op.patient_id);
    if (!matches) {
      await updateOp(op.op_id, (o) => ({
        ...o,
        status: "needs_review",
        review_reason: "ack_mismatch",
      }));
      report.needsReview++;
      continue;
    }
    await updateOp(op.op_id, (o) => ({
      ...o,
      status: "synced",
      synced_at: deps.now(),
      result,
      // The cloud has the details now; keep only what a slip needs.
      op: null,
      display_name: null,
      last_error: null,
      review_reason: null,
    }));
    report.applied++;
  }

  return report;
}
