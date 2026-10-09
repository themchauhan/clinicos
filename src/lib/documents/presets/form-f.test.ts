import { describe, expect, it } from "vitest";
import { resolveKnownFieldValue } from "../form-field-sources";
import { PCPNDT_INDICATIONS } from "../checklists";
import { FORM_F_PAGE_COUNT, FORM_F_PRESET } from "./form-f";
import { parseFormLayout } from "../form-layout";

describe("Form F preset", () => {
  it("passes the same validation as a hand-built layout", () => {
    const parsed = parseFormLayout(JSON.parse(JSON.stringify(FORM_F_PRESET)));
    expect("error" in parsed ? parsed.error : null).toBeNull();
  });

  it("has unique field keys and every one on a real page", () => {
    const keys = FORM_F_PRESET.fields.map((f) => f.fieldKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const f of FORM_F_PRESET.fields) {
      expect(f.pageNumber).toBeGreaterThanOrEqual(1);
      expect(f.pageNumber).toBeLessThanOrEqual(FORM_F_PAGE_COUNT);
    }
  });

  it("ticks every indication in the checklist, none left over", () => {
    const checklist = FORM_F_PRESET.fields.find((f) => f.inputType === "checklist");
    expect(checklist?.checklistKey).toBe(PCPNDT_INDICATIONS.key);
    expect((checklist?.tickMarks ?? []).map((t) => t.code)).toEqual(
      PCPNDT_INDICATIONS.items.map((i) => i.code),
    );
  });

  it("never auto-fills the sensitive results or leaves Section C (page 3 below item 16) filled", () => {
    const typedAtFillTime = [
      "result",
      "result_conveyed_to",
      "result_conveyed_on",
      "mtp_indication",
    ];
    for (const key of typedAtFillTime) {
      const field = FORM_F_PRESET.fields.find((f) => f.fieldKey === key);
      expect(field).toBeDefined();
      expect(
        resolveKnownFieldValue(key, {} as Parameters<typeof resolveKnownFieldValue>[1]),
      ).toBeUndefined();
    }
    // Section C starts below the doctor's block at the top of page 3.
    expect(FORM_F_PRESET.fields.filter((f) => f.pageNumber === 3 && f.y < 750)).toEqual([]);
  });

  it("stamps the doctor's seal and signature on pages 3 and 4", () => {
    expect(FORM_F_PRESET.seal.pageNumber).toBe(3);
    expect(FORM_F_PRESET.doctorSignature.pageNumber).toBe(3);
    expect(FORM_F_PRESET.extraStamps.map((s) => `${s.kind}:${s.page}`).sort()).toEqual([
      "DOCTOR_SIGNATURE:4",
      "SEAL:4",
    ]);
  });
});
