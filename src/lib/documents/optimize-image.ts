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

/** Width the two sides of an ID are normalised to before stacking. */
export const ID_MERGE_MAX_WIDTH_PX = 1600;
const ID_MERGE_GAP_PX = 32;
/** Slightly higher than ordinary photos: the sides arrive already compressed once. */
const ID_MERGE_JPEG_QUALITY = 80;

export type IdSide = "front" | "back";

/**
 * Stacks the front and the back of an ID into ONE image, front on top: a
 * single document to open instead of two, and (compressed like any other
 * photo) about the size one raw photo used to be.
 *
 * Both sides are auto-rotated, brought to the same width (never enlarged:
 * the narrower photo sets it, capped at 1600px so a 12MP photo doesn't
 * make a 4000px tall image), and separated by a small white gap. EXIF
 * (including GPS) is dropped like everywhere else.
 */
export async function mergeIdSides(front: Buffer, back: Buffer): Promise<StoredImage> {
  const [fm, bm] = await Promise.all([
    sharp(front, { failOn: "none" }).rotate().toBuffer({ resolveWithObject: true }),
    sharp(back, { failOn: "none" }).rotate().toBuffer({ resolveWithObject: true }),
  ]);
  const width = Math.min(ID_MERGE_MAX_WIDTH_PX, fm.info.width, bm.info.width);

  const fit = (data: Buffer) =>
    sharp(data, { failOn: "none" })
      .resize({ width, withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .toBuffer({ resolveWithObject: true });
  const [f, b] = await Promise.all([fit(fm.data), fit(bm.data)]);

  const merged = await sharp({
    create: {
      width,
      height: f.info.height + ID_MERGE_GAP_PX + b.info.height,
      channels: 3,
      background: "#ffffff",
    },
  })
    .composite([
      { input: f.data, left: 0, top: 0 },
      { input: b.data, left: 0, top: f.info.height + ID_MERGE_GAP_PX },
    ])
    .jpeg({ quality: ID_MERGE_JPEG_QUALITY, mozjpeg: true })
    .toBuffer();

  return { buffer: merged, mime: "image/jpeg", ext: "jpg" };
}

/**
 * One or both sides of an ID, stored as a single image: both -> merged,
 * either alone -> that side on its own (optimised like any document photo).
 */
export async function optimizeIdSides(sides: {
  front?: Buffer;
  back?: Buffer;
}): Promise<(StoredImage & { label: "front + back" | "front" | "back" }) | null> {
  if (sides.front && sides.back) {
    return { ...(await mergeIdSides(sides.front, sides.back)), label: "front + back" };
  }
  const only = sides.front ?? sides.back;
  if (!only) return null;
  return {
    ...(await optimizeDocumentFile(only, "image/jpeg")),
    label: sides.front ? "front" : "back",
  };
}
