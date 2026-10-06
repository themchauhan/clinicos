// No "server-only" marker, deliberately (same as file-validation.ts and
// form-flatten.ts): sharp is a native module that cannot be bundled for
// the browser anyway, and leaving the marker off keeps this unit-testable.
import sharp from "sharp";
import type { ApprovedFileType } from "./file-validation";

/**
 * Everything stored in the `documents` bucket goes through here first.
 * Storage (and the bandwidth to view it) is the main thing a small
 * deployment runs out of, and a raw 12-megapixel phone photo is 3-6 MB
 * for what is, to a reader, an ID card or a prescription -- so images
 * are bounded in size and recompressed, ~10x smaller with the text
 * still perfectly legible.
 *
 * Every path also drops EXIF/GPS metadata (phone photos routinely embed
 * the location) because sharp only carries metadata forward if asked,
 * and we never ask -- but it does that *after* reading the EXIF
 * orientation, so photos are auto-rotated first (without `.rotate()` the
 * orientation tag is discarded with the rest and the image can come out
 * sideways).
 */

export const DOCUMENT_MAX_EDGE_PX = 2000;
export const DOCUMENT_JPEG_QUALITY = 75;
export const STAMP_MAX_EDGE_PX = 800;

export interface StoredImage {
  buffer: Buffer;
  mime: ApprovedFileType;
  ext: "jpg" | "png" | "pdf";
}

/**
 * Patient documents, ID proofs and scanned pages: auto-rotate, fit
 * within 2000px, JPEG at quality 75. PNG photos/screenshots become JPEG
 * too (transparency is flattened onto white -- these are paper
 * documents). PDFs pass through untouched.
 */
export async function optimizeDocumentFile(
  buffer: Buffer,
  mime: ApprovedFileType,
): Promise<StoredImage> {
  if (mime === "application/pdf") {
    return { buffer, mime, ext: "pdf" };
  }
  const out = await sharp(buffer, { failOn: "none" })
    .rotate()
    .resize({
      width: DOCUMENT_MAX_EDGE_PX,
      height: DOCUMENT_MAX_EDGE_PX,
      fit: "inside",
      withoutEnlargement: true,
    })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: DOCUMENT_JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
  return { buffer: out, mime: "image/jpeg", ext: "jpg" };
}

/**
 * Small images stamped onto forms or stored as settings: a hospital
 * seal, a doctor's saved signature, a patient's drawn signature.
 * Keeps the format (PNG stays PNG so transparency survives, JPEG stays
 * JPEG), fits within 800px, and palette-quantizes PNGs -- a signature
 * is a handful of colours, and these get embedded into every filled
 * copy of a form, so their size multiplies.
 */
export async function optimizeStampImage(buffer: Buffer): Promise<StoredImage> {
  const meta = await sharp(buffer, { failOn: "none" }).metadata();
  const base = sharp(buffer, { failOn: "none" }).rotate().resize({
    width: STAMP_MAX_EDGE_PX,
    height: STAMP_MAX_EDGE_PX,
    fit: "inside",
    withoutEnlargement: true,
  });
  if (meta.format === "jpeg") {
    const out = await base.jpeg({ quality: 80, mozjpeg: true }).toBuffer();
    return { buffer: out, mime: "image/jpeg", ext: "jpg" };
  }
  const out = await base.png({ palette: true, quality: 80, compressionLevel: 9 }).toBuffer();
  return { buffer: out, mime: "image/png", ext: "png" };
}
