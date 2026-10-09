/** Longest plausible gap between the last menstrual period and a visit (~47 weeks). */
export const MAX_LMP_DAYS_BEFORE_VISIT = 330;

function utc(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function isRealDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/**
 * Checks a last-menstrual-period date entered for a visit on `visitDate`
 * (both yyyy-mm-dd). Blank means "not recorded" and is fine. Mirrors the
 * database's own constraint (visits_lmp_date_plausible) so the user gets a
 * readable message instead of a database error.
 */
export function validateLmp(
  raw: string | null | undefined,
  visitDate: string,
): { value: string | null } | { error: string } {
  const lmp = (raw ?? "").trim();
  if (!lmp) return { value: null };
  if (!isRealDate(lmp)) return { error: "Enter the LMP as a valid date." };
  if (utc(lmp) > utc(visitDate)) return { error: "The LMP can't be after the visit date." };
  const days = Math.round((utc(visitDate) - utc(lmp)) / 86_400_000);
  if (days > MAX_LMP_DAYS_BEFORE_VISIT) {
    return {
      error: `That LMP is ${days} days before the visit — more than ${MAX_LMP_DAYS_BEFORE_VISIT}. Check the date.`,
    };
  }
  return { value: lmp };
}
