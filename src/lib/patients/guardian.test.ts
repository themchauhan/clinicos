import { describe, expect, it } from "vitest";
import { formatGuardian, isGuardianRelation } from "./guardian";

describe("formatGuardian", () => {
  it("prefixes the relationship", () => {
    expect(formatGuardian("W/O", "Anand")).toBe("W/O Anand");
  });

  it("falls back to the bare name for patients saved before relationships existed", () => {
    expect(formatGuardian(null, "Anand")).toBe("Anand");
  });

  it("shows a dash when there is no guardian, even if a relationship is somehow set", () => {
    expect(formatGuardian(null, null)).toBe("—");
    expect(formatGuardian("S/O", null)).toBe("—");
  });
});

describe("isGuardianRelation", () => {
  it("accepts the five known relationships only", () => {
    expect(["S/O", "D/O", "W/O", "H/O", "C/O"].every(isGuardianRelation)).toBe(true);
    expect(isGuardianRelation("M/O")).toBe(false);
    expect(isGuardianRelation("")).toBe(false);
  });
});
