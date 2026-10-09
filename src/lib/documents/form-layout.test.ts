import { describe, expect, it } from "vitest";
import { parseFormLayout } from "./form-layout";

const field = (over: Record<string, unknown> = {}) => ({
  fieldKey: "patient.name",
  label: "Patient name",
  inputType: "text",
  pageNumber: 1,
  x: 100,
  y: 700,
  fontSize: 11,
  displayOrder: 0,
  ...over,
});
const box = { pageNumber: 4, x: 300, y: 120, width: 150, height: 50 };
const layout = (over: Record<string, unknown> = {}) => ({
  fields: [field()],
  signature: box,
  ...over,
});

function ok(raw: unknown) {
  const r = parseFormLayout(raw);
  if ("error" in r) throw new Error(r.error);
  return r.layout;
}
const err = (raw: unknown) => {
  const r = parseFormLayout(raw);
  return "error" in r ? r.error : null;
};

describe("parseFormLayout", () => {
  it("accepts a normal layout, with optional seal, doctor signature and extra stamps", () => {
    const l = ok(
      layout({
        seal: { ...box, pageNumber: 3 },
        doctorSignature: { ...box, pageNumber: 3 },
        extraStamps: [
          { kind: "DOCTOR_SIGNATURE", ...box },
          { kind: "SEAL", ...box },
        ],
      }),
    );
    expect(l.fields).toHaveLength(1);
    expect(l.seal?.pageNumber).toBe(3);
    expect(l.extraStamps).toEqual([
      { kind: "DOCTOR_SIGNATURE", page: 4, x: 300, y: 120, width: 150, height: 50 },
      { kind: "SEAL", page: 4, x: 300, y: 120, width: 150, height: 50 },
    ]);
  });

  it("accepts tick and checklist fields (a checklist needs a known list)", () => {
    const l = ok(
      layout({
        fields: [
          field({ fieldKey: "visit.is_usg", inputType: "tick", label: "Ultrasound" }),
          field({
            fieldKey: "indications",
            inputType: "checklist",
            checklistKey: "pcpndt_indications",
            label: "Indications",
          }),
        ],
      }),
    );
    expect(l.fields.map((f) => f.inputType)).toEqual(["tick", "checklist"]);
    expect(l.fields[1].checklistKey).toBe("pcpndt_indications");
    expect(l.fields[0].checklistKey).toBeNull();
  });

  it("accepts tick positions only on a checklist, with real codes and sane coordinates", () => {
    const checklist = (tickMarks: unknown) =>
      layout({
        fields: [
          field({
            fieldKey: "ind",
            label: "Indications",
            inputType: "checklist",
            checklistKey: "pcpndt_indications",
            tickMarks,
          }),
        ],
      });
    const good = ok(checklist([{ code: "ii", page: 2, x: 40, y: 600 }]));
    expect(good.fields[0].tickMarks).toEqual([{ code: "ii", page: 2, x: 40, y: 600 }]);

    expect(err(checklist([{ code: "zz", page: 2, x: 40, y: 600 }]))).toMatch(/tick positions/);
    expect(err(checklist([{ code: "ii", page: 0, x: 40, y: 600 }]))).toMatch(/tick positions/);
    expect(err(checklist([{ code: "ii", page: 2, x: -1, y: 600 }]))).toMatch(/tick positions/);
    expect(err(checklist("nope"))).toMatch(/tick positions/);
    expect(
      err(layout({ fields: [field({ tickMarks: [{ code: "ii", page: 2, x: 1, y: 1 }] })] })),
    ).toMatch(/tick positions/); // a plain text field can't have ticks
  });

  it("rejects a checklist with no / unknown list, and a list on a non-checklist", () => {
    expect(err(layout({ fields: [field({ inputType: "checklist" })] }))).toMatch(/Choose a list/);
    expect(
      err(layout({ fields: [field({ inputType: "checklist", checklistKey: "nope" })] })),
    ).toMatch(/Choose a list/);
    expect(err(layout({ fields: [field({ checklistKey: "pcpndt_indications" })] }))).toMatch(
      /not a checklist/,
    );
  });

  it("requires at least one field, a signature box, and unique keys", () => {
    expect(err(layout({ fields: [] }))).toMatch(/at least one field/);
    expect(err({ fields: [field()] })).toMatch(/signature box/);
    expect(err(layout({ fields: [field(), field({ label: "Again" })] }))).toMatch(/unique/);
  });

  it("rejects unknown types, bad numbers and out-of-range positions", () => {
    expect(err(layout({ fields: [field({ inputType: "script" })] }))).toMatch(/unknown field type/);
    expect(err(layout({ fields: [field({ x: "100" })] }))).toMatch(/invalid position/);
    expect(err(layout({ fields: [field({ x: -5 })] }))).toMatch(/invalid position/);
    expect(err(layout({ fields: [field({ y: Number.NaN })] }))).toMatch(/invalid position/);
    expect(err(layout({ fields: [field({ pageNumber: 0 })] }))).toMatch(/invalid position/);
    expect(err(layout({ fields: [field({ fontSize: 500 })] }))).toMatch(/invalid position/);
    expect(err(layout({ fields: [field({ fieldKey: "  " })] }))).toMatch(/key and a label/);
  });

  it("rejects malformed boxes and extra stamps, and more than 12 extras", () => {
    expect(err(layout({ signature: { ...box, width: 0 } }))).toMatch(/signature box/);
    expect(err(layout({ seal: { ...box, x: "a" } }))).toMatch(/seal position/);
    expect(err(layout({ extraStamps: [{ kind: "STAMP", ...box }] }))).toMatch(/extra seal/);
    expect(err(layout({ extraStamps: "nope" }))).toMatch(/At most 12/);
    const many = Array.from({ length: 13 }, () => ({ kind: "SEAL", ...box }));
    expect(err(layout({ extraStamps: many }))).toMatch(/At most 12/);
  });

  it("accepts extra stamps in the shape the designer stores (page, not pageNumber)", () => {
    const l = ok(
      layout({
        extraStamps: [{ kind: "SEAL", page: 4, x: 36, y: 70, width: 110, height: 45 }],
      }),
    );
    expect(l.extraStamps).toEqual([
      { kind: "SEAL", page: 4, x: 36, y: 70, width: 110, height: 45 },
    ]);
  });

  it("is not fooled by non-objects", () => {
    expect(err(null)).toMatch(/Could not read/);
    expect(err("layout")).toMatch(/Could not read/);
    expect(err([])).toMatch(/Could not read/);
  });
});
