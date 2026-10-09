export interface GestationalAge {
  weeks: number;
  days: number;
}

function utc(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/**
 * Weeks and days of pregnancy on `onDate`, counted from the last menstrual
 * period (LMP). null when there is no LMP or it is after the date. Pure
 * calendar-date arithmetic on yyyy-mm-dd strings, so no timezone drift.
 */
export function gestationalAge(lmpDate: string | null, onDate: string): GestationalAge | null {
  if (!lmpDate) return null;
  const days = Math.round((utc(onDate) - utc(lmpDate)) / 86_400_000);
  if (days < 0) return null;
  return { weeks: Math.floor(days / 7), days: days % 7 };
}

/** "18 weeks 2 days", "18 weeks", "1 week 1 day"; "" when unknown. */
export function formatGestationalAge(lmpDate: string | null, onDate: string): string {
  const age = gestationalAge(lmpDate, onDate);
  if (!age) return "";
  const weeks = `${age.weeks} week${age.weeks === 1 ? "" : "s"}`;
  return age.days === 0 ? weeks : `${weeks} ${age.days} day${age.days === 1 ? "" : "s"}`;
}
