/** Shape of what the database function dashboard_summary() returns. */

export interface SummaryTotals {
  visits: number;
  cancelled: number;
  patients_visited: number;
  new_patients: number;
  returning_patients: number;
  // Money: null unless the caller is the centre's Admin (enforced in SQL).
  billed: number | null;
  collected: number | null;
  outstanding_count: number | null;
  outstanding_amount: number | null;
}

export interface DashboardSummary {
  from: string;
  to: string;
  is_admin: boolean;
  totals: SummaryTotals;
  weekday: { dow: number; visits: number }[] | null;
  by_doctor: { name: string; visits: number; collected: number | null }[] | null;
  referrers:
    { name: string; hospital: string | null; visits: number; billed: number | null }[] | null;
  by_mode: { mode: string; amount: number }[] | null;
  by_staff: { name: string; amount: number }[] | null;
}

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

/** 1234567.5 -> "₹12,34,568" (Indian digit grouping, whole rupees). */
export function formatInr(amount: number): string {
  return inr.format(Math.round(amount));
}

const plain = new Intl.NumberFormat("en-IN");
export function formatCount(n: number): string {
  return plain.format(n);
}

/**
 * Percentage change from `previous` to `current`, rounded. null when
 * there is nothing to compare with (previous is 0) -- "up infinity %"
 * helps nobody; the UI shows "no data last period" instead.
 */
export function percentChange(current: number, previous: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/** Bar length as a percentage of the largest value, never below a visible sliver for a non-zero value. */
export function barPercent(value: number, max: number): number {
  if (max <= 0 || value <= 0) return 0;
  return Math.max(2, Math.round((value / max) * 100));
}

export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function utcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

/** "2026-10-07" -> "7 Oct". */
export function formatDay(iso: string): string {
  return utcDate(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** ("2026-10-01", "2026-10-06") -> "1 Oct – 6 Oct 2026"; adds the year to both ends when they differ. */
export function formatRange(from: string, to: string): string {
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  const withYear = (iso: string) =>
    utcDate(iso).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  return sameYear ? `${formatDay(from)} – ${withYear(to)}` : `${withYear(from)} – ${withYear(to)}`;
}

/** Most rows a ranked list shows before the rest are folded into "Other". */
export const TOP_ROWS = 8;

/**
 * Keeps the first `limit` rows (the caller passes them sorted, biggest
 * first) and folds everything after into one "Other (n more)" row with
 * the summed figures, so a long tail can't stretch the page.
 */
export function foldRest<T extends { name: string; visits: number; collected: number | null }>(
  rows: T[],
  limit: number = TOP_ROWS,
): { name: string; visits: number; collected: number | null; folded?: boolean }[] {
  if (rows.length <= limit) return rows;
  const head = rows.slice(0, limit);
  const rest = rows.slice(limit);
  const anyMoney = rest.some((r) => r.collected !== null);
  return [
    ...head,
    {
      name: `Other (${rest.length} more)`,
      visits: rest.reduce((sum, r) => sum + r.visits, 0),
      collected: anyMoney ? rest.reduce((sum, r) => sum + (r.collected ?? 0), 0) : null,
      folded: true,
    },
  ];
}
