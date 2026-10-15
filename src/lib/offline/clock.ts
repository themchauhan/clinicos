import { getDb } from "@/lib/offline/db";

/**
 * A computer's clock can be minutes, hours or a day wrong, and an offline
 * record's date (and so its place in the day's queue) comes from that clock.
 * Every time the server answers a health check, the difference between its
 * clock and this computer's is measured and remembered; offline, the record is
 * dated with the device clock CORRECTED by that difference. The size of the
 * correction is stored with the record for the audit trail.
 */

const KEY = "clock";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface ClockMeta {
  offset_ms: number;
  measured_at: number;
}

/** `serverNowMs` was read by the server between the device times `t0` and `t1`. */
export async function recordServerTime(serverNowMs: number, t0: number, t1: number): Promise<void> {
  if (!Number.isFinite(serverNowMs)) return;
  const offset = Math.round(serverNowMs - (t0 + t1) / 2);
  try {
    const db = await getDb();
    await db.put("meta", {
      key: KEY,
      value: { offset_ms: offset, measured_at: t1 } satisfies ClockMeta,
    });
  } catch {
    // best effort: dating falls back to the raw device clock
  }
}

export async function getClockOffset(now: number = Date.now()): Promise<number> {
  try {
    const db = await getDb();
    const meta = (await db.get("meta", KEY))?.value as ClockMeta | undefined;
    if (!meta || now - meta.measured_at > MAX_AGE_MS) return 0;
    return meta.offset_ms;
  } catch {
    return 0;
  }
}

export async function correctedNow(
  now: number = Date.now(),
): Promise<{ now: number; offset: number }> {
  const offset = await getClockOffset(now);
  return { now: now + offset, offset };
}
