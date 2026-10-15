/**
 * The wire format between the offline queue (browser) and the sync endpoint,
 * and the one place that decides how a failure is classified. Pure and shared
 * by both sides so they can never disagree.
 *
 * Nothing here is trusted by the server beyond its shape: the database
 * function validates and authorizes every operation again, and the centre
 * always comes from the session, never from an operation.
 */

export const OFFLINE_SCHEMA_VERSION = 1;
export const MAX_OPS_PER_BATCH = 20;
/** Reject absurd request bodies before parsing them. */
export const MAX_SYNC_BODY_BYTES = 256 * 1024;

export type OfflineOpType = "register_patient_and_visit" | "create_visit";

/** Database column names (snake_case): sent as-is to the sync function. */
export interface OfflinePatientPayload {
  id: string;
  name: string;
  mobile: string | null;
  dob: string | null;
  approximate_age_years: number | null;
  guardian_name: string | null;
  guardian_relation: string | null;
  gender: string | null;
  address: string | null;
  living_sons: number | null;
  living_sons_ages: string | null;
  living_daughters: number | null;
  living_daughters_ages: string | null;
}

export interface OfflineVisitPayload {
  id: string;
  patient_id: string;
  visit_type_id: string;
  doctor_id: string | null;
  /** yyyy-mm-dd, the India date the visit happened. */
  visit_date: string;
  notes: string | null;
  referred_by_name: string | null;
  referred_by_hospital: string | null;
  fee_amount: number;
  follow_up_date: string | null;
  lmp_date: string | null;
}

export interface OfflineOperation {
  op_id: string;
  op_type: OfflineOpType;
  schema_version: number;
  device_id: string;
  /** ISO time the record was created, by the device's clock corrected to the server's. */
  client_created_at: string;
  /** How far the device clock was from the server's when this was saved (audit only). */
  clock_offset_ms: number;
  patient?: OfflinePatientPayload;
  visit: OfflineVisitPayload;
  /** "Register as new" after a possible-duplicate hold. */
  confirm_new?: boolean;
  /** The held operation this one settles. */
  resolves_op_id?: string;
  /** SHA-256 of the canonical operation (see canonical.ts). */
  payload_hash: string;
}

export type LedgerStatus = "applied" | "needs_review" | "rejected";

export type OpOutcome =
  | {
      op_id: string;
      status: LedgerStatus | "paused";
      error_code: string | null;
      result: Record<string, unknown>;
      replayed: boolean;
      /** The hash the server recorded for this operation (must equal the device's). */
      payload_hash?: string;
      /** For "paused": why (tenant_inactive | offline_sync_disabled). */
      reason?: string;
    }
  /** Could not be judged right now: keep the operation and try again later. */
  | { op_id: string; status: "retry"; reason: string }
  /** Cannot be accepted as sent (corrupt / malformed): hold it for a person. */
  | { op_id: string; status: "malformed"; reason: string }
  /** Not attempted because an earlier operation in the batch hit trouble. */
  | { op_id: string; status: "skipped" };

export interface SyncResponse {
  outcomes: OpOutcome[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Checks only the envelope; the database checks the content. */
export function parseSyncRequest(
  body: unknown,
): { ops: Record<string, unknown>[] } | { error: string } {
  if (!isObject(body) || !Array.isArray(body.ops)) {
    return { error: "Expected { ops: [...] }." };
  }
  if (body.ops.length === 0 || body.ops.length > MAX_OPS_PER_BATCH) {
    return { error: `Send between 1 and ${MAX_OPS_PER_BATCH} operations at a time.` };
  }
  const seen = new Set<string>();
  for (const op of body.ops) {
    if (!isObject(op) || !isUuid(op.op_id)) {
      return { error: "Every operation needs a valid op_id." };
    }
    if (seen.has(op.op_id.toLowerCase())) {
      return { error: "An op_id appears twice in one request." };
    }
    seen.add(op.op_id.toLowerCase());
  }
  return { ops: body.ops as Record<string, unknown>[] };
}

export type RpcFailureKind = "auth" | "retry" | "malformed";

/**
 * Maps a failed database call to what the queue should do with the operation.
 * Anything not positively "malformed" or "auth" is treated as retryable:
 * retrying is always safe because the operation is idempotent, whereas
 * dropping or rejecting on a guess could lose data.
 */
export function classifyRpcFailure(
  error: { code?: string | null } | null | undefined,
): RpcFailureKind {
  const code = error?.code ?? "";
  if (code === "42501" || code === "PGRST301" || code === "PGRST302") return "auth";
  // 22xxx data exception (an unparseable uuid, ...), 22023 invalid_op.
  if (/^22/.test(code)) return "malformed";
  return "retry";
}
