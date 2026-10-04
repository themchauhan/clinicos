// No "server-only" here deliberately, same reasoning as
// file-validation.ts: pure Buffer/PDF logic, no secrets, no
// Next-specific APIs, so it stays unit-testable directly. Only ever
// called from a server action regardless.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { detectFileType } from "@/lib/documents/file-validation";

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

/** Embeds and draws an image box -- shared by the mandatory patient
 * signature and the optional hospital seal, since both are just "an
 * image at a stored {page, x, y, width, height}". Detects PNG vs JPEG
 * by magic bytes (same detector the upload path already validates
 * with) rather than assuming PNG, since a seal image may be either. */
async function drawImagePlacement(
  pdfDoc: PDFDocument,
  page: PDFPage,
  box: { x: number; y: number; width: number; height: number },
  imageBytes: Buffer,
) {
  const detected = detectFileType(imageBytes);
  const image =
    detected?.mime === "image/jpeg"
      ? await pdfDoc.embedJpg(imageBytes)
      : await pdfDoc.embedPng(imageBytes);
  page.drawImage(image, { x: box.x, y: box.y, width: box.width, height: box.height });
}

function drawField(page: PDFPage, font: PDFFont, field: FormFieldPlacement) {
  if (!field.value.trim()) return;
  const lineHeight = field.fontSize * 1.25;
  // ~1.8 characters per point of font size is a rough Helvetica
  // average -- fine for wrapping a postal address, not for anything
  // that needs to fit an exact print column.
  const maxCharsPerLine = field.multiline
    ? Math.max(20, Math.floor(300 / field.fontSize))
    : Infinity;
  const lines = field.multiline ? wrapText(field.value, maxCharsPerLine) : [field.value];

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
}): Promise<Buffer> {
  const pdfDoc = await PDFDocument.load(input.blankPdf);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const pages = pdfDoc.getPages();

  for (const field of input.fields) {
    const page = pages[field.pageNumber - 1];
    if (page) drawField(page, font, field);
  }

  const signaturePage = pages[input.signature.pageNumber - 1];
  if (signaturePage) {
    await drawImagePlacement(pdfDoc, signaturePage, input.signature, input.signature.signaturePng);
  }

  for (const stamp of [input.seal, input.doctorSignature]) {
    if (!stamp) continue;
    const page = pages[stamp.pageNumber - 1];
    if (page) await drawImagePlacement(pdfDoc, page, stamp, stamp.image);
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
