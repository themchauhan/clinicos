import { validateFile, type ApprovedFileType } from "./file-validation";
import { optimizeDocumentFile, optimizeIdSides, type StoredImage } from "./optimize-image";

export interface UploadTypeInfo {
  name: string;
  /** Capture asks for front and back and stores one merged image. */
  two_sided: boolean;
}

export type PreparedUpload = { stored: StoredImage; fileName: string } | { error: string };

function present(value: FormDataEntryValue | null): File | null {
  return value instanceof File && value.size > 0 ? value : null;
}

/**
 * A document type's name as part of a file name: a slash becomes a dash
 * ("Guardian / Relative ID Proof" -> "Guardian - Relative ID Proof") and
 * other characters that can't appear in file names are dropped.
 */
export function safeFileLabel(name: string): string {
  return name
    .replace(/\s*\/\s*/g, " - ")
    .replace(/[\\:*?"<>|]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Turns what the upload form sent into the one thing to store.
 *
 *  - Ordinary document types: a single `file` -- validated, bounded and
 *    recompressed (PDFs untouched).
 *  - Two-sided types (IDs): `front` and/or `back`. Both photos are merged
 *    into one image, front above back; one side alone is stored as that
 *    side. A PDF is allowed only on its own -- it can't be merged.
 *
 * Every file is checked by its magic bytes and size here, on the server,
 * whatever the browser claimed.
 */
export async function prepareUploadFromForm(
  formData: FormData,
  type: UploadTypeInfo,
): Promise<PreparedUpload> {
  if (!type.two_sided) {
    const file = present(formData.get("file"));
    if (!file) return { error: "Choose a file to upload." };

    const raw = Buffer.from(await file.arrayBuffer());
    const validated = validateFile(raw);
    if ("error" in validated) return { error: validated.error };

    const stored = await optimizeDocumentFile(raw, validated.mime);
    // An image is stored as JPEG whatever it arrived as, so its name's
    // extension has to follow.
    const fileName =
      stored.mime === validated.mime
        ? file.name
        : file.name.replace(/\.[^.]+$/, "") + "." + stored.ext;
    return { stored, fileName };
  }

  const front = present(formData.get("front"));
  const back = present(formData.get("back"));
  if (!front && !back) return { error: "Add the front, the back, or both." };

  const sides: { front?: Buffer; back?: Buffer } = {};
  const mimes: ApprovedFileType[] = [];
  for (const [side, file] of [
    ["front", front],
    ["back", back],
  ] as const) {
    if (!file) continue;
    const raw = Buffer.from(await file.arrayBuffer());
    const validated = validateFile(raw);
    if ("error" in validated)
      return { error: `${side === "front" ? "Front" : "Back"}: ${validated.error}` };
    mimes.push(validated.mime);
    sides[side] = raw;
  }

  if (mimes.includes("application/pdf")) {
    if (mimes.length > 1) {
      return {
        error:
          "A PDF can't be combined with another side. Upload the PDF on its own, or use photos for both sides.",
      };
    }
    const only = front ?? back!;
    const raw = (sides.front ?? sides.back)!;
    const stored = await optimizeDocumentFile(raw, "application/pdf");
    return { stored, fileName: only.name };
  }

  const merged = await optimizeIdSides(sides);
  if (!merged) return { error: "Add the front, the back, or both." };
  const { label, ...stored } = merged;
  return { stored, fileName: `${safeFileLabel(type.name)} (${label}).${stored.ext}` };
}
