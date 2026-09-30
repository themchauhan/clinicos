import { describe, expect, it } from "vitest";
import { ageInYears } from "./age";

describe("ageInYears", () => {
  it("computes an exact age from dob", () => {
    const tenYearsAgo = new Date();
    tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);
    expect(ageInYears(tenYearsAgo.toISOString().slice(0, 10), null)).toBe("10");
  });

  it("falls back to the recorded approximate age when dob is unknown", () => {
    expect(ageInYears(null, 45)).toBe("~45");
  });

  it("prefers dob over approximate age when both are present", () => {
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    expect(ageInYears(twoYearsAgo.toISOString().slice(0, 10), 99)).toBe("2");
  });

  it("returns an em dash when neither is known", () => {
    expect(ageInYears(null, null)).toBe("—");
  });
});
