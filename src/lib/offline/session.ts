import { getDb, scopeOf } from "@/lib/offline/db";

/**
 * What the offline screens need to know, saved on the device while signed in
 * online: who is signed in, and the small reference lists a registration uses
 * (visit types, doctors). Refreshed on every online visit.
 *
 * Offline authorization policy (deliberately conservative): the offline screens
 * work only for the person who last signed in ONLINE on this computer, and only
 * for OFFLINE_WINDOW_MS after that sign-in was last confirmed. After that, new
 * records are refused until they sign in online again; records already saved
 * stay on the device and sync then. A disconnected computer cannot learn that
 * someone's access was revoked -- the server re-checks every record when it
 * syncs, and refuses what it must.
 */

export const OFFLINE_WINDOW_MS = 12 * 60 * 60 * 1000;

export interface OfflineSession {
  scope: string;
  user_id: string;
  hospital_id: string;
  hospital_name: string;
  user_name: string;
  role: "HOSPITAL_ADMIN" | "RECEPTIONIST";
  visit_types: {
    id: string;
    name: string;
    default_fee: number | null;
    module: "GENERAL_OPD" | "USG";
  }[];
  doctors: { id: string; name: string }[];
  /** When the server last confirmed this sign-in (ms since epoch). */
  verified_at: number;
}

export async function saveSession(s: Omit<OfflineSession, "scope">): Promise<OfflineSession> {
  const session: OfflineSession = { ...s, scope: scopeOf(s.user_id, s.hospital_id) };
  const db = await getDb();
  await db.put("meta", { key: "session", value: session });
  return session;
}

export async function loadSession(): Promise<OfflineSession | null> {
  const db = await getDb();
  const row = await db.get("meta", "session");
  return (row?.value as OfflineSession | undefined) ?? null;
}

export async function clearSession(): Promise<void> {
  const db = await getDb();
  await db.delete("meta", "session");
}

export function sessionTimeLeftMs(s: OfflineSession, now: number = Date.now()): number {
  return Math.max(0, s.verified_at + OFFLINE_WINDOW_MS - now);
}

export const isSessionFresh = (s: OfflineSession, now: number = Date.now()) =>
  sessionTimeLeftMs(s, now) > 0;
