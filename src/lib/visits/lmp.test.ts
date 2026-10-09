import { describe, expect, it } from "vitest";
import { validateLmp } from "./lmp";

describe("validateLmp", () => {
  const visit = "2026-10-09";

  it("treats blank as not recorded", () => {
    expect(validateLmp("", visit)).toEqual({ value: null });
    expect(validateLmp("  ", visit)).toEqual({ value: null });
    expect(validateLmp(null, visit)).toEqual({ value: null });
  });

  it("accepts a normal LMP, including the visit date itself and the 330-day edge", () => {
    expect(validateLmp("2026-06-01", visit)).toEqual({ value: "2026-06-01" });
    expect(validateLmp("2026-10-09", visit)).toEqual({ value: "2026-10-09" });
    expect(validateLmp("2025-11-13", visit)).toEqual({ value: "2025-11-13" }); // exactly 330 days
  });

  it("rejects a future date, an implausibly old one, and junk", () => {
    expect("error" in validateLmp("2026-10-10", visit)).toBe(true);
    expect(validateLmp("2025-11-12", visit)).toMatchObject({
      error: expect.stringMatching(/331 days/),
    });
    expect("error" in validateLmp("2026-02-30", visit)).toBe(true); // not a real date
    expect("error" in validateLmp("09/10/2026", visit)).toBe(true);
    expect("error" in validateLmp("tomorrow", visit)).toBe(true);
  });
});
