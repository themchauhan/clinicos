/**
 * Date ranges for the dashboard's business overview, all in plain
 * yyyy-mm-dd strings (India dates -- the caller passes "today" in that
 * timezone, see todayInAppTimezone) so no timezone maths happens here.
 *
 * Every range also knows the range to compare it with ("previous"):
 * a month-to-date is compared with the same number of days of last
 * month, a year-to-date with the same stretch of last year, and a full
 * past month / financial year with the one before it -- so the
 * percentage change always compares like with like.
 */

export type RangeKey = "month" | "last-month" | "fy" | "last-fy" | "year";

export const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: "month", label: "This month" },
  { key: "last-month", label: "Last month" },
  { key: "fy", label: "This financial year" },
  { key: "last-fy", label: "Last financial year" },
  { key: "year", label: "This calendar year" },
];

export interface Period {
  key: RangeKey;
  label: string;
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
}

export function parseRange(value: string | undefined): RangeKey {
  return RANGE_OPTIONS.some((o) => o.key === value) ? (value as RangeKey) : "month";
}

interface Ymd {
  y: number;
  m: number; // 1-12
  d: number;
}

function parse(date: string): Ymd {
  const [y, m, d] = date.split("-").map(Number);
  return { y, m, d };
}

function fmt({ y, m, d }: Ymd): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** The same day-of-month `months` earlier, clamped (31 Mar - 1 month = 28/29 Feb). */
function shiftMonths(date: Ymd, months: number): Ymd {
  const index = date.y * 12 + (date.m - 1) + months;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return { y, m, d: Math.min(date.d, daysInMonth(y, m)) };
}

function firstOfMonth(date: Ymd): Ymd {
  return { y: date.y, m: date.m, d: 1 };
}

function lastOfMonth(date: Ymd): Ymd {
  return { y: date.y, m: date.m, d: daysInMonth(date.y, date.m) };
}

/** First day of the Indian financial year (1 April) that contains `date`. */
function financialYearStart(date: Ymd): Ymd {
  return { y: date.m >= 4 ? date.y : date.y - 1, m: 4, d: 1 };
}

export function resolvePeriod(key: RangeKey, today: string): Period {
  const t = parse(today);

  switch (key) {
    case "month": {
      const from = firstOfMonth(t);
      const prevFrom = shiftMonths(from, -1);
      return {
        key,
        label: "This month",
        from: fmt(from),
        to: today,
        prevFrom: fmt(prevFrom),
        prevTo: fmt(shiftMonths(t, -1)),
      };
    }
    case "last-month": {
      const lastMonth = shiftMonths(firstOfMonth(t), -1);
      const before = shiftMonths(lastMonth, -1);
      return {
        key,
        label: "Last month",
        from: fmt(lastMonth),
        to: fmt(lastOfMonth(lastMonth)),
        prevFrom: fmt(before),
        prevTo: fmt(lastOfMonth(before)),
      };
    }
    case "fy": {
      const from = financialYearStart(t);
      return {
        key,
        label: "This financial year",
        from: fmt(from),
        to: today,
        prevFrom: fmt(shiftMonths(from, -12)),
        prevTo: fmt(shiftMonths(t, -12)),
      };
    }
    case "last-fy": {
      const thisStart = financialYearStart(t);
      const from = shiftMonths(thisStart, -12);
      const prevFrom = shiftMonths(from, -12);
      return {
        key,
        label: "Last financial year",
        from: fmt(from),
        to: fmt({ y: thisStart.y, m: 3, d: 31 }),
        prevFrom: fmt(prevFrom),
        prevTo: fmt({ y: from.y, m: 3, d: 31 }),
      };
    }
    case "year": {
      const from: Ymd = { y: t.y, m: 1, d: 1 };
      return {
        key,
        label: "This calendar year",
        from: fmt(from),
        to: today,
        prevFrom: fmt({ y: t.y - 1, m: 1, d: 1 }),
        prevTo: fmt(shiftMonths(t, -12)),
      };
    }
  }
}
