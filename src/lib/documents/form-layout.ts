import { CHECKLISTS } from "@/lib/documents/checklists";
import type { ExtraStamp, FormFieldInputType, TickMark } from "@/types/database";

/**
 * The shape a form template's layout takes between the designer (browser)
 * and the save actions, plus the one place that checks it. The layout
 * arrives as JSON from the client, so it is never trusted as typed: every
 * field is validated here before anything reaches the database.
 */

export interface FormTemplateFieldInput {
  fieldKey: string;
  label: string;
  inputType: FormFieldInputType;
  /** For inputType "checklist": which built-in list (see lib/documents/checklists). */
  checklistKey?: string | null;
  /** For a checklist: a tick drawn at each SELECTED item's own position. */
  tickMarks?: TickMark[];
  pageNumber: number;
  x: number;
  y: number;
  fontSize: number;
  displayOrder: number;
}

export interface BoxInput {
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type SignatureBoxInput = BoxInput;
export type SealBoxInput = BoxInput;
export type DoctorSignatureBoxInput = BoxInput;

export interface ParsedFormLayout {
  fields: FormTemplateFieldInput[];
  signature: SignatureBoxInput;
  seal: SealBoxInput | null;
  doctorSignature: DoctorSignatureBoxInput | null;
  extraStamps: ExtraStamp[];
}

export const MAX_FORM_FIELDS = 200;
export const MAX_EXTRA_STAMPS = 12;
const MAX_PAGES = 50;
const MAX_COORD = 5000;
const INPUT_TYPES: readonly FormFieldInputType[] = [
  "text",
  "date",
  "textarea",
  "tick",
  "checklist",
];

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function parseBox(raw: unknown): BoxInput | null {
  if (!isObject(raw)) return null;
  const { pageNumber, x, y, width, height } = raw;
  if (
    !isNum(pageNumber) ||
    !Number.isInteger(pageNumber) ||
    pageNumber < 1 ||
    pageNumber > MAX_PAGES ||
    !isNum(x) ||
    !isNum(y) ||
    !isNum(width) ||
    !isNum(height) ||
    x < 0 ||
    y < 0 ||
    x > MAX_COORD ||
    y > MAX_COORD ||
    width <= 0 ||
    height <= 0 ||
    width > MAX_COORD ||
    height > MAX_COORD
  ) {
    return null;
  }
  return { pageNumber, x, y, width, height };
}

export function parseFormLayout(raw: unknown): { layout: ParsedFormLayout } | { error: string } {
  if (!isObject(raw)) return { error: "Could not read the field layout. Try again." };

  if (!Array.isArray(raw.fields) || raw.fields.length === 0) {
    return { error: "Place at least one field on the form." };
  }
  if (raw.fields.length > MAX_FORM_FIELDS) {
    return { error: `A form can have at most ${MAX_FORM_FIELDS} fields.` };
  }

  const fields: FormTemplateFieldInput[] = [];
  const seen = new Set<string>();
  for (const [i, f] of raw.fields.entries()) {
    if (!isObject(f)) return { error: "Could not read the field layout. Try again." };
    const fieldKey = typeof f.fieldKey === "string" ? f.fieldKey.trim() : "";
    const label = typeof f.label === "string" ? f.label.trim() : "";
    if (!fieldKey || fieldKey.length > 100 || !label || label.length > 200) {
      return { error: "Every field needs a key and a label." };
    }
    if (seen.has(fieldKey)) {
      return { error: `Two fields share the key "${fieldKey}". Keys must be unique.` };
    }
    seen.add(fieldKey);

    const inputType = f.inputType as FormFieldInputType;
    if (!INPUT_TYPES.includes(inputType)) {
      return { error: `"${label}" has an unknown field type.` };
    }
    const checklistKey =
      typeof f.checklistKey === "string" && f.checklistKey ? f.checklistKey : null;
    if (inputType === "checklist") {
      if (!checklistKey || !CHECKLISTS[checklistKey]) {
        return { error: `Choose a list for the checklist field "${label}".` };
      }
    } else if (checklistKey) {
      return { error: `"${label}" is not a checklist, so it can't have a list.` };
    }

    const tickMarks: TickMark[] = [];
    if (f.tickMarks != null) {
      if (inputType !== "checklist" || !Array.isArray(f.tickMarks) || f.tickMarks.length > 60) {
        return { error: `"${label}" has invalid tick positions.` };
      }
      const codes = new Set(CHECKLISTS[checklistKey!]?.items.map((i) => i.code));
      for (const t of f.tickMarks) {
        if (
          !isObject(t) ||
          typeof t.code !== "string" ||
          !codes.has(t.code) ||
          !isNum(t.page) ||
          !Number.isInteger(t.page) ||
          t.page < 1 ||
          t.page > MAX_PAGES ||
          !isNum(t.x) ||
          !isNum(t.y) ||
          t.x < 0 ||
          t.y < 0 ||
          t.x > MAX_COORD ||
          t.y > MAX_COORD
        ) {
          return { error: `"${label}" has invalid tick positions.` };
        }
        tickMarks.push({ code: t.code, page: t.page, x: t.x, y: t.y });
      }
    }

    const { pageNumber, x, y, fontSize } = f;
    if (
      !isNum(pageNumber) ||
      !Number.isInteger(pageNumber) ||
      pageNumber < 1 ||
      pageNumber > MAX_PAGES ||
      !isNum(x) ||
      !isNum(y) ||
      x < 0 ||
      y < 0 ||
      x > MAX_COORD ||
      y > MAX_COORD ||
      !isNum(fontSize) ||
      fontSize < 4 ||
      fontSize > 48
    ) {
      return { error: `"${label}" has an invalid position or size.` };
    }
    fields.push({
      fieldKey,
      label,
      inputType,
      checklistKey: inputType === "checklist" ? checklistKey : null,
      tickMarks,
      pageNumber,
      x,
      y,
      fontSize,
      displayOrder: isNum(f.displayOrder) ? Math.trunc(f.displayOrder) : i,
    });
  }

  const signature = parseBox(raw.signature);
  if (!signature) return { error: "Place the signature box on the form." };

  let seal: BoxInput | null = null;
  if (raw.seal != null) {
    seal = parseBox(raw.seal);
    if (!seal) return { error: "The seal position is invalid." };
  }
  let doctorSignature: BoxInput | null = null;
  if (raw.doctorSignature != null) {
    doctorSignature = parseBox(raw.doctorSignature);
    if (!doctorSignature) return { error: "The doctor's signature position is invalid." };
  }

  const extraStamps: ExtraStamp[] = [];
  if (raw.extraStamps != null) {
    if (!Array.isArray(raw.extraStamps) || raw.extraStamps.length > MAX_EXTRA_STAMPS) {
      return { error: `At most ${MAX_EXTRA_STAMPS} extra seals / signatures.` };
    }
    for (const s of raw.extraStamps) {
      // The designer stores an extra stamp's page as `page` (ExtraStamp);
      // `pageNumber` (the primary boxes' spelling) is accepted too.
      const box = parseBox(isObject(s) && s.pageNumber == null ? { ...s, pageNumber: s.page } : s);
      const kind = isObject(s) ? s.kind : null;
      if (!box || (kind !== "SEAL" && kind !== "DOCTOR_SIGNATURE")) {
        return { error: "An extra seal or signature position is invalid." };
      }
      extraStamps.push({
        kind,
        page: box.pageNumber,
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      });
    }
  }

  return { layout: { fields, signature, seal, doctorSignature, extraStamps } };
}
