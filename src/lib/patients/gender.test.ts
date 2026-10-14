import { describe, expect, it } from "vitest";
import { asksPregnancyDetails } from "./gender";

describe("asksPregnancyDetails", () => {
  it("is false only for a male patient", () => {
    expect(asksPregnancyDetails("MALE")).toBe(false);
    expect(asksPregnancyDetails("FEMALE")).toBe(true);
    expect(asksPregnancyDetails("OTHER")).toBe(true);
    expect(asksPregnancyDetails(null)).toBe(true);
    expect(asksPregnancyDetails(undefined)).toBe(true);
  });
});
