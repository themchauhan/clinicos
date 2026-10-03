/** Today's calendar date in India (yyyy-mm-dd) -- the same day the
 * database stamps on a new visit (visits.visit_date defaults to the
 * Asia/Kolkata date), so "today's visits" and the daily token reset
 * both roll over at Indian midnight, not UTC midnight. */
export function todayInAppTimezone(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}
