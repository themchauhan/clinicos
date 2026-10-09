import { describe, expect, it } from "vitest";
import { formatGestationalAge, gestationalAge } from "./gestational-age";

describe("gestationalAge", () => {
  it("counts weeks and days from the LMP", () => {
    expect(gestationalAge("2026-06-01", "2026-10-09")).toEqual({ weeks: 18, days: 4 });
    expect(gestationalAge("2026-10-02", "2026-10-09")).toEqual({ weeks: 1, days: 0 });
    expect(gestationalAge("2026-10-09", "2026-10-09")).toEqual({ weeks: 0, days: 0 });
  });

  it("is null without an LMP or when the LMP is after the date", () => {
    expect(gestationalAge(null, "2026-10-09")).toBeNull();
    expect(gestationalAge("2026-10-10", "2026-10-09")).toBeNull();
  });

  it("is not thrown off by month lengths or a leap day", () => {
    expect(gestationalAge("2028-02-20", "2028-03-05")).toEqual({ weeks: 2, days: 0 }); // 14 days incl. 29 Feb
    expect(gestationalAge("2027-12-25", "2028-01-08")).toEqual({ weeks: 2, days: 0 });
  });
});

describe("formatGestationalAge", () => {
  it("reads naturally", () => {
    expect(formatGestationalAge("2026-06-01", "2026-10-09")).toBe("18 weeks 4 days");
    expect(formatGestationalAge("2026-06-04", "2026-10-09")).toBe("18 weeks 1 day");
    expect(formatGestationalAge("2026-06-11", "2026-10-09")).toBe("17 weeks 1 day");
    expect(formatGestationalAge("2026-10-02", "2026-10-09")).toBe("1 week");
    expect(formatGestationalAge(null, "2026-10-09")).toBe("");
  });
});
