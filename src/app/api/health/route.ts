import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const TIMEOUT_MS = 4000;
/** The endpoint is public, so cap what anyone can make it ask the database. */
const MEMO_MS = 2000;

let memo: { at: number; ok: boolean; dbNowMs: number | null } | null = null;

/**
 * "Are the app AND its database really reachable?" -- what the offline queue
 * asks before it tries to sync (navigator.onLine only says a network card is
 * connected). Public and data-free: one light round trip to the database,
 * answered with yes/no and the database clock (so a device can measure how far
 * its own clock is off). The answer is reused for two seconds, so hammering this
 * URL cannot turn into hammering the database.
 */
export async function GET() {
  const headers = { "cache-control": "no-store" };
  const now = Date.now();

  if (!memo || now - memo.at > MEMO_MS) {
    try {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      const { data, error } = await supabase
        .rpc("health_ping")
        .abortSignal(AbortSignal.timeout(TIMEOUT_MS));
      memo =
        error || typeof data !== "string"
          ? { at: now, ok: false, dbNowMs: null }
          : { at: now, ok: true, dbNowMs: new Date(data).getTime() };
    } catch {
      memo = { at: now, ok: false, dbNowMs: null };
    }
  }

  if (!memo.ok || memo.dbNowMs === null) {
    return Response.json({ ok: false }, { status: 503, headers });
  }
  // The database clock as of now (the reading may be a moment old).
  return Response.json(
    { ok: true, now: new Date(memo.dbNowMs + (Date.now() - memo.at)).toISOString() },
    { headers },
  );
}
