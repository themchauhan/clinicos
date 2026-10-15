import { hashMatches } from "@/lib/offline/canonical";
import { classifyRpcFailure, type LedgerStatus, type OpOutcome } from "@/lib/offline/protocol";

/**
 * The server half of a sync round, with the database call injected so the very
 * same code runs in the route handler (real Supabase) and in tests (including
 * fault-injection tests against a real database).
 *
 * Operations are applied one at a time, in order. Rules:
 *  - an operation whose hash does not match its content is refused before it
 *    reaches the database (corrupt in storage or transit);
 *  - an operation is reported "applied" only after the database function has
 *    returned, i.e. its transaction committed;
 *  - anything that cannot be judged (timeouts, deadlocks, connection trouble,
 *    an answer we do not understand) is "retry", and the rest of the batch is
 *    left untouched -- safe because replaying an operation is idempotent;
 *  - patient data is never logged.
 */

export type RpcCall = (
  op: Record<string, unknown>,
) => Promise<{ data: unknown; error: { code?: string | null } | null }>;

export interface BatchResult {
  outcomes: OpOutcome[];
  /** True when the caller is not (or no longer) allowed to sync. */
  authFailed: boolean;
}

const KNOWN: readonly string[] = ["applied", "needs_review", "rejected", "paused"];

export async function processSyncBatch(
  rpc: RpcCall,
  ops: Record<string, unknown>[],
  log: (message: string, detail: Record<string, unknown>) => void = () => undefined,
): Promise<BatchResult> {
  const outcomes: OpOutcome[] = [];
  let stopped = false;

  for (const op of ops) {
    const opId = op.op_id as string;
    if (stopped) {
      outcomes.push({ op_id: opId, status: "skipped" });
      continue;
    }

    if (!(await hashMatches(op))) {
      outcomes.push({ op_id: opId, status: "malformed", reason: "hash_mismatch" });
      continue;
    }

    let response: Awaited<ReturnType<RpcCall>>;
    try {
      response = await rpc(op);
    } catch {
      outcomes.push({ op_id: opId, status: "retry", reason: "rpc_exception" });
      stopped = true;
      continue;
    }
    const { data, error } = response;

    if (error) {
      const kind = classifyRpcFailure(error);
      if (kind === "auth") return { outcomes, authFailed: true };
      if (kind === "malformed") {
        outcomes.push({ op_id: opId, status: "malformed", reason: error.code ?? "malformed" });
        continue;
      }
      log("offline sync: retryable failure", { opId, code: error.code ?? null });
      outcomes.push({ op_id: opId, status: "retry", reason: error.code ?? "unknown" });
      stopped = true;
      continue;
    }

    const out = (data ?? {}) as Record<string, unknown>;
    const status = out.status as string | undefined;
    if (!status || !KNOWN.includes(status)) {
      // An answer we do not understand is not an acknowledgement.
      outcomes.push({ op_id: opId, status: "retry", reason: "unexpected_response" });
      stopped = true;
      continue;
    }
    outcomes.push({
      op_id: opId,
      status: status as LedgerStatus | "paused",
      error_code: (out.error_code as string | null) ?? null,
      result: (out.result as Record<string, unknown>) ?? {},
      replayed: out.replayed === true,
      ...(typeof out.payload_hash === "string" ? { payload_hash: out.payload_hash } : {}),
      ...(typeof out.reason === "string" ? { reason: out.reason } : {}),
    });
    // A paused centre will pause every remaining operation too.
    if (status === "paused") stopped = true;
  }

  return { outcomes, authFailed: false };
}
