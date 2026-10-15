import { describe, expect, it } from "vitest";
import { parsePatientFields } from "./parse";

const form = (v: Record<string, string>) => (k: string) => v[k] ?? "";

describe("parsePatientFields", () => {
  it("accepts a minimal patient and trims", () => {
    const r = parsePatientFields(form({ name: "  Synthetic Person  " }));
    expect(r).toMatchObject({ name: "Synthetic Person", mobile: null, dob: null, gender: null });
  });

  it("normalises a mobile number and rejects a bad one", () => {
    expect(parsePatientFields(form({ name: "A", mobile: "98765 00099" }))).toMatchObject({
      mobile: "9876500099",
    });
    expect(parsePatientFields(form({ name: "A", mobile: "abcd" }))).toHaveProperty("error");
  });

  it("requires a name, and refuses DOB together with an approximate age", () => {
    expect(parsePatientFields(form({ name: " " }))).toHaveProperty("error");
    expect(
      parsePatientFields(form({ name: "A", dob: "1990-01-01", approximateAgeYears: "30" })),
    ).toHaveProperty("error");
  });

  it("requires a guardian name when a relationship is given", () => {
    expect(parsePatientFields(form({ name: "A", guardianRelation: "W/O" }))).toHaveProperty(
      "error",
    );
    expect(
      parsePatientFields(form({ name: "A", guardianRelation: "W/O", guardianName: "B" })),
    ).toMatchObject({ guardianRelation: "W/O", guardianName: "B" });
  });

  it("checks the children counts", () => {
    expect(parsePatientFields(form({ name: "A", livingSons: "-1" }))).toHaveProperty("error");
    expect(parsePatientFields(form({ name: "A", livingSons: "2" }))).toMatchObject({
      livingSons: 2,
    });
  });
});
