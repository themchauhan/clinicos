import { describe, expect, it } from "vitest";
import { ageInYears } from "./age";

// Truncating "N years ago" to a date-only string loses its time-of-day,
// so comparing it against the exact current instant can floor() down
// to N-1 depending what time of day the test happens to run -- a few
// extra days of margin keeps the elapsed time comfortably inside year
// N regardless (365.25 days/year makes a handful of days negligible).
function yearsAgoDateOnly(years: number): string {
  const date = new Date();
  date.setFullYear(date.getFullYear() - years);
  date.setDate(date.getDate() - 5);
  return date.toISOString().slice(0, 10);
}

describe("ageInYears", () => {
  it("computes an exact age from dob", () => {
    expect(ageInYears(yearsAgoDateOnly(10), null)).toBe("10");
  });

  it("falls back to the recorded approximate age when dob is unknown", () => {
    expect(ageInYears(null, 45)).toBe("~45");
  });

  it("prefers dob over approximate age when both are present", () => {
    expect(ageInYears(yearsAgoDateOnly(2), 99)).toBe("2");
  });

  it("returns an em dash when neither is known", () => {
    expect(ageInYears(null, null)).toBe("—");
  });
});
