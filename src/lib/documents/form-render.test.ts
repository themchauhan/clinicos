import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { buildFlattenParts, stampBoxes } from "./form-render";

type Template = Parameters<typeof buildFlattenParts>[1];

const baseTemplate = (over: Partial<Template> = {}): Template =>
  ({
    id: "t1",
    hospital_id: "h1",
    name: "Form F",
    seal_page: null,
    seal_x: null,
    seal_y: null,
    seal_width: null,
    seal_height: null,
    doctor_signature_page: null,
    doctor_signature_x: null,
    doctor_signature_y: null,
    doctor_signature_width: null,
    doctor_signature_height: null,
    extra_stamps: [],
    form_template_fields: [],
    ...over,
  }) as Template;

describe("stampBoxes", () => {
  it("returns the template's own box first, then the extra placements of that kind", () => {
    const t = baseTemplate({
      doctor_signature_page: 3,
      doctor_signature_x: 300,
      doctor_signature_y: 100,
      doctor_signature_width: 120,
      doctor_signature_height: 40,
      extra_stamps: [
        { kind: "DOCTOR_SIGNATURE", page: 4, x: 300, y: 150, width: 120, height: 40 },
        { kind: "SEAL", page: 4, x: 50, y: 60, width: 70, height: 70 },
      ],
    });
    expect(stampBoxes(t, "DOCTOR_SIGNATURE").map((b) => b.page)).toEqual([3, 4]);
    expect(stampBoxes(t, "SEAL").map((b) => b.page)).toEqual([4]); // no first seal box; one extra
  });

  it("is empty when nothing is placed", () => {
    expect(stampBoxes(baseTemplate(), "SEAL")).toEqual([]);
    expect(stampBoxes(baseTemplate(), "DOCTOR_SIGNATURE")).toEqual([]);
  });
});

describe("buildFlattenParts", () => {
  // With no stamp boxes placed it must not touch the database at all.
  const noDb = {} as SupabaseClient<Database>;

  it("maps fields with their input type, checklist and entered values (blank when missing)", async () => {
    const t = baseTemplate({
      form_template_fields: [
        {
          field_key: "a",
          page_number: 1,
          x: 10,
          y: 20,
          font_size: 11,
          input_type: "text",
          checklist_key: null,
        },
        {
          field_key: "b",
          page_number: 2,
          x: 30,
          y: 40,
          font_size: 9,
          input_type: "textarea",
          checklist_key: null,
        },
        {
          field_key: "c",
          page_number: 2,
          x: 50,
          y: 60,
          font_size: 11,
          input_type: "checklist",
          checklist_key: "pcpndt_indications",
        },
        {
          field_key: "d",
          page_number: 2,
          x: 70,
          y: 80,
          font_size: 11,
          input_type: "tick",
          checklist_key: null,
        },
      ] as Template["form_template_fields"],
    });
    const parts = await buildFlattenParts(
      noDb,
      t,
      { a: "hello", c: "ii,xvii" },
      { hospitalId: "h1" },
    );

    expect(parts.seals).toEqual([]);
    expect(parts.doctorSignatures).toEqual([]);
    expect(parts.fields).toEqual([
      {
        pageNumber: 1,
        x: 10,
        y: 20,
        fontSize: 11,
        multiline: false,
        value: "hello",
        inputType: "text",
        checklistKey: null,
        tickMarks: [],
      },
      {
        pageNumber: 2,
        x: 30,
        y: 40,
        fontSize: 9,
        multiline: true,
        value: "",
        inputType: "textarea",
        checklistKey: null,
        tickMarks: [],
      },
      {
        pageNumber: 2,
        x: 50,
        y: 60,
        fontSize: 11,
        multiline: false,
        value: "ii,xvii",
        inputType: "checklist",
        checklistKey: "pcpndt_indications",
        tickMarks: [],
      },
      {
        pageNumber: 2,
        x: 70,
        y: 80,
        fontSize: 11,
        multiline: false,
        value: "",
        inputType: "tick",
        checklistKey: null,
        tickMarks: [],
      },
    ]);
  });
});
