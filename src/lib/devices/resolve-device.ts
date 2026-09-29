// No "server-only" here deliberately, same reasoning as
// src/lib/scan/resolve-session.ts: takes an injected client rather
// than constructing one itself, so it stays directly testable.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
// generateScanToken/hashScanToken are generic (random 256-bit token,
// SHA-256 hash) despite the name -- reused here rather than
// duplicated, aliased for clarity at this call site.
import { hashScanToken as hashDeviceToken } from "@/lib/scan/token";

export type PairedDeviceRow = Database["public"]["Tables"]["paired_devices"]["Row"];

/**
 * The device's only credential, mirroring resolveScanSession() but for
 * a long-lived pairing token instead of a 12-minute one — no expiry
 * filter here since pairing a replacement device is the cleanup
 * mechanism (see the paired_devices migration comment).
 */
export async function resolvePairedDevice(
  supabase: SupabaseClient<Database>,
  rawToken: string,
): Promise<PairedDeviceRow | null> {
  const tokenHash = hashDeviceToken(rawToken);

  const { data } = await supabase
    .from("paired_devices")
    .select("*")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  return data ?? null;
}
