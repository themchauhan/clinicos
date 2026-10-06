import { describe, expect, it } from "vitest";
import { parseRange, resolvePeriod } from "./periods";

describe("parseRange", () => {
  it("accepts known ranges and falls back to the current month", () => {
    expect(parseRange("fy")).toBe("fy");
    expect(parseRange("last-fy")).toBe("last-fy");
    expect(parseRange("nonsense")).toBe("month");
    expect(parseRange(undefined)).toBe("month");
  });
});

describe("resolvePeriod", () => {
  it("month: month-to-date vs the same days of last month", () => {
    const p = resolvePeriod("month", "2026-10-06");
    expect([p.from, p.to]).toEqual(["2026-10-01", "2026-10-06"]);
    expect([p.prevFrom, p.prevTo]).toEqual(["2026-09-01", "2026-09-06"]);
  });

  it("month: clamps the comparison day when last month is shorter", () => {
    const p = resolvePeriod("month", "2026-03-31");
    expect([p.prevFrom, p.prevTo]).toEqual(["2026-02-01", "2026-02-28"]);
    // ...and across a leap year.
    expect(resolvePeriod("month", "2028-03-31").prevTo).toBe("2028-02-29");
  });

  it("month: January compares with December of the year before", () => {
    const p = resolvePeriod("month", "2026-01-15");
    expect([p.prevFrom, p.prevTo]).toEqual(["2025-12-01", "2025-12-15"]);
  });

  it("last-month: the whole previous month vs the month before it", () => {
    const p = resolvePeriod("last-month", "2026-10-06");
    expect([p.from, p.to]).toEqual(["2026-09-01", "2026-09-30"]);
    expect([p.prevFrom, p.prevTo]).toEqual(["2026-08-01", "2026-08-31"]);
    const jan = resolvePeriod("last-month", "2026-01-10");
    expect([jan.from, jan.to]).toEqual(["2025-12-01", "2025-12-31"]);
  });

  it("fy: the Indian financial year starts on 1 April", () => {
    const afterApril = resolvePeriod("fy", "2026-10-06");
    expect([afterApril.from, afterApril.to]).toEqual(["2026-04-01", "2026-10-06"]);
    expect([afterApril.prevFrom, afterApril.prevTo]).toEqual(["2025-04-01", "2025-10-06"]);

    // Before April we are still in the financial year that began last April.
    const beforeApril = resolvePeriod("fy", "2026-02-10");
    expect([beforeApril.from, beforeApril.to]).toEqual(["2025-04-01", "2026-02-10"]);
    expect(beforeApril.prevFrom).toBe("2024-04-01");
    // 1 April itself is the first day of the new year.
    expect(resolvePeriod("fy", "2026-04-01").from).toBe("2026-04-01");
    expect(resolvePeriod("fy", "2026-03-31").from).toBe("2025-04-01");
  });

  it("last-fy: the whole previous financial year vs the one before", () => {
    const p = resolvePeriod("last-fy", "2026-10-06");
    expect([p.from, p.to]).toEqual(["2025-04-01", "2026-03-31"]);
    expect([p.prevFrom, p.prevTo]).toEqual(["2024-04-01", "2025-03-31"]);
    const early = resolvePeriod("last-fy", "2026-02-10");
    expect([early.from, early.to]).toEqual(["2024-04-01", "2025-03-31"]);
  });

  it("year: calendar year-to-date vs the same stretch of last year", () => {
    const p = resolvePeriod("year", "2026-10-06");
    expect([p.from, p.to]).toEqual(["2026-01-01", "2026-10-06"]);
    expect([p.prevFrom, p.prevTo]).toEqual(["2025-01-01", "2025-10-06"]);
    // 29 Feb has no equivalent the year before.
    expect(resolvePeriod("year", "2028-02-29").prevTo).toBe("2027-02-28");
  });
});
