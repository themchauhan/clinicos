// No "server-only" here deliberately, same reasoning as
// file-validation.ts: pure Buffer/PDF logic, no secrets, no
// Next-specific APIs, so it stays unit-testable directly. Only ever
// called from a server action regardless.

import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import { formatChecklistValue, getChecklist, selectedCodes } from "@/lib/documents/checklists";
import { detectFileType } from "@/lib/documents/file-validation";
import { optimizeStampImage } from "@/lib/documents/optimize-image";

/** Simple greedy word wrap -- good enough for an address-length field, not typeset-quality (same spirit as signature-composite.ts's wrapText). */
function wrapText(text: string, maxCharsPerLine: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = (current + " " + word).trim();
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export interface FormFieldPlacement {
  pageNumber: number; // 1-based
  x: number; // PDF points from the left
  y: number; // PDF points from the bottom
  fontSize: number;
  multiline: boolean;
  value: string;
  /** How to draw the value. Omitted = plain text (older callers). */
  inputType?: "text" | "date" | "textarea" | "tick" | "checklist";
  /** For a checklist field: which built-in list its codes belong to. */
  checklistKey?: string | null;
  /** For a checklist: a tick at each SELECTED item's own position (other pages too). */
  tickMarks?: { code: string; page: number; x: number; y: number }[];
}

export interface SignaturePlacement {
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
  signaturePng: Buffer;
}

/** Shared shape for any optional, pre-saved image stamped onto a form
 * -- the hospital seal and the doctor's saved signature are both
 * exactly this, just sourced from a different table. */
export interface StampPlacement {
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** A photographed/scanned image -- PNG or JPEG, unlike the
   * signature pad's always-PNG canvas export. */
  image: Buffer;
}

/** Embeds an image once per distinct source and reuses it for every
 * placement -- a doctor's signature stamped in three places must not be
 * stored three times in the PDF. Bounded and palette-compressed on the way
 * in, because it is embedded in every filled copy of the form. Detects
 * PNG vs JPEG by magic bytes. */
async function embedImage(
  pdfDoc: PDFDocument,
  rawImageBytes: Buffer,
  cache: Map<Buffer, PDFImage>,
): Promise<PDFImage> {
  const cached = cache.get(rawImageBytes);
  if (cached) return cached;
  const imageBytes = (await optimizeStampImage(rawImageBytes)).buffer;
  const detected = detectFileType(imageBytes);
  const image =
    detected?.mime === "image/jpeg"
      ? await pdfDoc.embedJpg(imageBytes)
      : await pdfDoc.embedPng(imageBytes);
  cache.set(rawImageBytes, image);
  return image;
}

async function drawImagePlacement(
  pdfDoc: PDFDocument,
  page: PDFPage,
  box: { x: number; y: number; width: number; height: number },
  rawImageBytes: Buffer,
  cache: Map<Buffer, PDFImage>,
) {
  const image = await embedImage(pdfDoc, rawImageBytes, cache);
  page.drawImage(image, { x: box.x, y: box.y, width: box.width, height: box.height });
}

/** yyyy-mm-dd -> dd/mm/yyyy (how Indian forms are filled in); anything else unchanged. */
function formatDateValue(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

/** A check mark whose bottom-left is (x, y), sized by `size` points. */
function drawTick(page: PDFPage, x: number, y: number, size: number) {
  const thickness = Math.max(1, size * 0.14);
  const colour = rgb(0, 0, 0);
  page.drawLine({
    start: { x, y: y + size * 0.55 },
    end: { x: x + size * 0.38, y: y + size * 0.05 },
    thickness,
    color: colour,
  });
  page.drawLine({
    start: { x: x + size * 0.38, y: y + size * 0.05 },
    end: { x: x + size * 1.05, y: y + size * 0.95 },
    thickness,
    color: colour,
  });
}

function isTicked(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v !== "" && v !== "0" && v !== "false" && v !== "no";
}

function drawField(page: PDFPage, font: PDFFont, field: FormFieldPlacement) {
  if (!field.value.trim()) return;

  if (field.inputType === "tick") {
    if (isTicked(field.value)) drawTick(page, field.x, field.y, field.fontSize);
    return;
  }

  let text = field.value;
  if (field.inputType === "checklist") {
    const list = getChecklist(field.checklistKey);
    // An unknown list can't be decoded; print what was stored rather than nothing.
    text = list ? formatChecklistValue(field.value, list) : field.value;
  } else if (field.inputType === "date") {
    text = formatDateValue(field.value);
  }
  if (!text.trim()) return;

  const lineHeight = field.fontSize * 1.25;
  // ~1.8 characters per point of font size is a rough Helvetica
  // average -- fine for wrapping a postal address, not for anything
  // that needs to fit an exact print column.
  const maxCharsPerLine = field.multiline
    ? Math.max(20, Math.floor(300 / field.fontSize))
    : Infinity;
  const lines = field.multiline ? wrapText(text, maxCharsPerLine) : [text];

  lines.forEach((line, i) => {
    page.drawText(line, {
      x: field.x,
      y: field.y - i * lineHeight,
      size: field.fontSize,
      font,
      color: rgb(0, 0, 0),
    });
  });
}

/**
 * Draws each field's entered value and the signature directly onto the
 * real uploaded form -- the flattened result is the permanent record
 * (no separate structured-value table), matching this app's existing
 * "the image is the source of truth" principle. Sibling to
 * signature-composite.ts, same idea, PDF instead of a generated PNG.
 */
export async function flattenFormTemplate(input: {
  blankPdf: Buffer;
  fields: FormFieldPlacement[];
  signature: SignaturePlacement;
  /** Omitted when the template has no seal box, or the hospital
   * hasn't uploaded a seal yet -- graceful skip, same as any other
   * unset auto-fill source in this feature. */
  seal?: StampPlacement;
  /** Omitted when the template has no doctor-signature box, the visit
   * has no doctor assigned, or that doctor hasn't saved a signature
   * yet -- same graceful skip as the seal. */
  doctorSignature?: StampPlacement;
  /** Every place the seal / doctor's signature is stamped, for forms that
   * want them several times (PC-PNDT Form F has three). Used together
   * with the singular props above. */
  seals?: StampPlacement[];
  doctorSignatures?: StampPlacement[];
}): Promise<Buffer> {
  const pdfDoc = await PDFDocument.load(input.blankPdf);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const pages = pdfDoc.getPages();

  for (const field of input.fields) {
    const page = pages[field.pageNumber - 1];
    if (page) drawField(page, font, field);

    // A checklist can also tick each selected item where it appears on the form
    // (Form F: the indications are listed on page 2 and ticked there).
    if (field.inputType === "checklist" && field.tickMarks?.length) {
      const list = getChecklist(field.checklistKey);
      if (list) {
        const chosen = new Set(selectedCodes(field.value, list));
        for (const mark of field.tickMarks) {
          const markPage = pages[mark.page - 1];
          if (markPage && chosen.has(mark.code)) drawTick(markPage, mark.x, mark.y, field.fontSize);
        }
      }
    }
  }

  const embedded = new Map<Buffer, PDFImage>();

  const signaturePage = pages[input.signature.pageNumber - 1];
  if (signaturePage) {
    await drawImagePlacement(
      pdfDoc,
      signaturePage,
      input.signature,
      input.signature.signaturePng,
      embedded,
    );
  }

  const stamps = [
    ...(input.seal ? [input.seal] : []),
    ...(input.seals ?? []),
    ...(input.doctorSignature ? [input.doctorSignature] : []),
    ...(input.doctorSignatures ?? []),
  ];
  for (const stamp of stamps) {
    const page = pages[stamp.pageNumber - 1];
    if (page) await drawImagePlacement(pdfDoc, page, stamp, stamp.image, embedded);
  }

  return Buffer.from(await pdfDoc.save());
}

/** Reads a PDF's first page size in points, for storing alongside a
 * newly-uploaded form_templates row (the designer and the flattening
 * step both need to agree on this one coordinate space). */
export async function readPdfPageSize(
  pdfBytes: Buffer,
): Promise<{ pageWidth: number; pageHeight: number }> {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const firstPage = pdfDoc.getPage(0);
  const { width, height } = firstPage.getSize();
  return { pageWidth: width, pageHeight: height };
}
