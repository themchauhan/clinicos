import { describe, expect, it } from "vitest";
import {
  PCPNDT_INDICATIONS,
  formatChecklistValue,
  getChecklist,
  selectedCodes,
} from "./checklists";

describe("PCPNDT_INDICATIONS", () => {
  it("is the form's 23 indications, i to xxiii, with unique codes", () => {
    expect(PCPNDT_INDICATIONS.items).toHaveLength(23);
    expect(PCPNDT_INDICATIONS.items[0].code).toBe("i");
    expect(PCPNDT_INDICATIONS.items[22].code).toBe("xxiii");
    expect(new Set(PCPNDT_INDICATIONS.items.map((i) => i.code)).size).toBe(23);
  });
});

describe("checklist values", () => {
  it("prints the selected codes in the list's own order, ignoring junk", () => {
    expect(formatChecklistValue("xvii,ii", PCPNDT_INDICATIONS)).toBe("ii, xvii");
    expect(formatChecklistValue(" xxiii , nonsense , i", PCPNDT_INDICATIONS)).toBe("i, xxiii");
    expect(formatChecklistValue("", PCPNDT_INDICATIONS)).toBe("");
    expect(selectedCodes("iv", PCPNDT_INDICATIONS)).toEqual(["iv"]);
  });

  it("looks a list up by key, and returns null for an unknown one", () => {
    expect(getChecklist("pcpndt_indications")).toBe(PCPNDT_INDICATIONS);
    expect(getChecklist("nope")).toBeNull();
    expect(getChecklist(null)).toBeNull();
  });
});
