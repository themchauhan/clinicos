import { guardOfflineApi } from "@/lib/offline/api-guard";
import { createClient } from "@/lib/supabase/server";
import { MAX_SYNC_BODY_BYTES, parseSyncRequest } from "@/lib/offline/protocol";
import { processSyncBatch } from "@/lib/offline/server";

export const dynamic = "force-dynamic";

const noStore = { "cache-control": "no-store" };

/**
 * Applies a batch of offline operations through the database function
 * apply_offline_operation (atomic, idempotent, tamper-evident). All the
 * decisions live in processSyncBatch / the database; this route only:
 *  - authenticates and authorizes (HOSPITAL_ADMIN / RECEPTIONIST of an active
 *    centre), and runs as the signed-in user -- never the service-role key;
 *  - bounds the request size and checks its envelope;
 *  - never logs patient data.
 * The centre always comes from the session; an operation cannot name one.
 */
export async function POST(request: Request) {
  // Who is asking, before anything is read from them.
  const guard = await guardOfflineApi(request, { mutating: true });
  if ("response" in guard) return guard.response;

  const raw = await request.text();
  if (raw.length > MAX_SYNC_BODY_BYTES) {
    return Response.json({ error: "Request too large." }, { status: 413, headers: noStore });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400, headers: noStore });
  }
  const parsed = parseSyncRequest(body);
  if ("error" in parsed) {
    return Response.json({ error: parsed.error }, { status: 400, headers: noStore });
  }

  const supabase = await createClient();
  const result = await processSyncBatch(
    async (op) => {
      const { data, error } = await supabase.rpc("apply_offline_operation", { p_op: op });
      return { data, error };
    },
    parsed.ops,
    (message, detail) => console.error(message, detail),
  );

  if (result.authFailed) {
    return Response.json(
      { error: "auth", outcomes: result.outcomes },
      { status: 403, headers: noStore },
    );
  }
  return Response.json({ outcomes: result.outcomes }, { headers: noStore });
}
