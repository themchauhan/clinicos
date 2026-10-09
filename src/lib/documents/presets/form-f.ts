import type { ExtraStamp, FormFieldInputType, TickMark } from "@/types/database";
import type { FormTemplateFieldInput } from "@/lib/documents/form-layout";

/**
 * A ready-made layout for the standard PC-PNDT Form F (5 pages, A4, no
 * fillable fields), measured off the official PDF. Sections A and B and the
 * declarations in Section D are placed; Section C (invasive procedures, items
 * 17-27) is deliberately left blank -- the centres this serves do not perform
 * them.
 *
 * What is NOT pre-filled, on purpose: the result of the procedure, who it
 * was conveyed to, any MTP indication, and the findings. Those are typed at
 * fill time and never stored (PC-PNDT sensitivity).
 */

export const FORM_F_PAGE_COUNT = 5;

interface PresetBox {
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FormLayoutPreset {
  fields: FormTemplateFieldInput[];
  signature: PresetBox;
  seal: PresetBox;
  doctorSignature: PresetBox;
  extraStamps: ExtraStamp[];
}

type FieldRow = [
  fieldKey: string,
  label: string,
  inputType: FormFieldInputType,
  page: number,
  x: number,
  y: number,
  fontSize: number,
];

const FIELD_ROWS: FieldRow[] = [
  ["hospital.centre_name", "Centre name", "text", 1, 438.3, 670.2, 8],
  ["hospital.centre_address", "Centre address", "text", 1, 75, 651.5, 9],
  ["hospital.registration_no", "Registration no.", "text", 1, 282.4, 632.2, 10],
  ["patient.name", "Patient name", "text", 1, 142.5, 613.3, 10],
  ["patient.age", "Patient age", "text", 1, 402.8, 613.3, 10],
  ["patient.children_total", "Total living children", "text", 1, 215.2, 594.3, 10],
  ["patient.sons_count", "Living sons — number", "text", 1, 431.9, 575.2, 10],
  ["patient.sons_ages", "Living sons — age of each", "text", 1, 111, 556.5, 10],
  ["patient.daughters_count", "Living daughters — number", "text", 1, 482.9, 537.3, 10],
  ["patient.daughters_ages", "Living daughters — age of each", "text", 1, 111, 518.5, 10],
  [
    "patient.guardian_name",
    "Husband's / wife's / father's / mother's name",
    "text",
    1,
    266.1,
    487.4,
    10,
  ],
  ["patient.contact", "Patient address and contact number", "text", 1, 57, 437.5, 9],
  ["visit.referred_by", "Referred by (name and address)", "text", 1, 57, 368.5, 9],
  ["self_referral", "Self-referral (if applicable)", "text", 1, 111.4, 261.6, 10],
  ["visit.lmp_with_weeks", "LMP / weeks of pregnancy", "text", 1, 278.4, 180.5, 10],
  ["doctor.name", "Doctor performing the procedure", "text", 1, 286.9, 131.4, 10],
  ["indications", "Indications for the procedure", "checklist", 1, 233.1, 106.9, 10],
  ["visit.is_usg", "Ultrasound (tick)", "tick", 2, 158, 283, 10],
  ["procedure_other", "Any other procedure (specify)", "text", 2, 193.4, 232.6, 10],
  ["system.today", "Date declaration obtained", "date", 2, 362.1, 213.6, 10],
  ["visit.date", "Date procedure carried out", "date", 2, 245.2, 194.6, 10],
  ["result", "Result of the procedure (not saved anywhere else)", "text", 2, 74, 156.5, 10],
  ["result_conveyed_to", "Result conveyed to", "text", 2, 335.7, 137.7, 10],
  ["result_conveyed_on", "Result conveyed on (date)", "date", 2, 446.1, 137.7, 10],
  ["mtp_indication", "Indication for MTP, if any", "text", 2, 473.4, 118.8, 10],
  ["doctor.name#3", "Doctor name (page 3 block)", "text", 3, 252, 805, 9],
  ["doctor.registration_no", "Doctor registration number (page 3 block)", "text", 3, 252, 791, 9],
  ["system.today#2", "Date (doctor's block, page 3)", "date", 3, 75, 784.4, 10],
  ["place", "Place (page 3)", "text", 3, 75, 755.4, 10],
  ["patient.name#2", "Patient name (declaration)", "text", 4, 110, 662.6, 10],
  ["visit.type_name", "Procedure being undergone", "text", 4, 39, 648.1, 10],
  ["patient.name#3", "Patient name (declaration, Khasi line)", "text", 4, 88.5, 608.9, 10],
  ["system.today#3", "Date (patient declaration)", "date", 4, 70, 545, 10],
  ["doctor.name#2", "Doctor name (declaration)", "text", 4, 47.3, 227.2, 10],
  ["patient.name#4", "Patient name (doctor's declaration)", "text", 4, 334.4, 212.6, 10],
  ["system.today#4", "Date (doctor's declaration)", "date", 4, 64, 125, 10],
  ["doctor.name#4", "Doctor name in capitals", "text", 4, 256, 110.7, 9],
  [
    "doctor.registration_no#2",
    "Doctor registration number (declaration)",
    "text",
    4,
    400,
    110.7,
    9,
  ],
];

/** Where each Form F indication (i to xxiii, page 2) gets its tick. */
const INDICATION_TICKS: TickMark[] = [
  { code: "i", page: 2, x: 36, y: 747.4 },
  { code: "ii", page: 2, x: 36, y: 732.8 },
  { code: "iii", page: 2, x: 36, y: 718.2 },
  { code: "iv", page: 2, x: 36, y: 703.7 },
  { code: "v", page: 2, x: 36, y: 674.6 },
  { code: "vi", page: 2, x: 36, y: 660 },
  { code: "vii", page: 2, x: 36, y: 645.5 },
  { code: "viii", page: 2, x: 36, y: 631 },
  { code: "ix", page: 2, x: 36, y: 616.5 },
  { code: "x", page: 2, x: 36, y: 601.8 },
  { code: "xi", page: 2, x: 36, y: 572.8 },
  { code: "xii", page: 2, x: 36, y: 558.3 },
  { code: "xiii", page: 2, x: 36, y: 543.7 },
  { code: "xiv", page: 2, x: 36, y: 529.1 },
  { code: "xv", page: 2, x: 36, y: 500.1 },
  { code: "xvi", page: 2, x: 36, y: 470.9 },
  { code: "xvii", page: 2, x: 36, y: 456.4 },
  { code: "xviii", page: 2, x: 36, y: 441.8 },
  { code: "xix", page: 2, x: 36, y: 427.3 },
  { code: "xx", page: 2, x: 36, y: 398.2 },
  { code: "xxi", page: 2, x: 36, y: 354.6 },
  { code: "xxii", page: 2, x: 36, y: 340 },
  { code: "xxiii", page: 2, x: 36, y: 325.4 },
];

export const FORM_F_PRESET: FormLayoutPreset = {
  fields: FIELD_ROWS.map(
    ([fieldKey, label, inputType, pageNumber, x, y, fontSize], displayOrder) => ({
      fieldKey,
      label,
      inputType,
      pageNumber,
      x,
      y,
      fontSize,
      displayOrder,
      ...(inputType === "checklist"
        ? { checklistKey: "pcpndt_indications", tickMarks: INDICATION_TICKS }
        : {}),
    }),
  ),
  // The pregnant woman's signature / thumb impression (Section D).
  signature: { pageNumber: 4, x: 288, y: 553, width: 160, height: 31 },
  // The doctor's seal and signature: the block closing Section B (page 3)
  // and the doctor's declaration (page 4).
  seal: { pageNumber: 3, x: 60, y: 798, width: 110, height: 40 },
  doctorSignature: { pageNumber: 3, x: 425, y: 792, width: 110, height: 40 },
  extraStamps: [
    { kind: "SEAL", page: 4, x: 36, y: 70, width: 110, height: 45 },
    { kind: "DOCTOR_SIGNATURE", page: 4, x: 340, y: 124, width: 150, height: 30 },
  ],
};
