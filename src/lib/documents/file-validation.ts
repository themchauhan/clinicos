// No "server-only" here deliberately: this is pure Buffer logic with
// no secrets and no Next-specific APIs (same reasoning as
// src/lib/auth/guards.ts), so it stays unit-testable directly. It's
// only ever called from the uploadDocument server action anyway.

export type ApprovedFileType = "image/jpeg" | "image/png" | "application/pdf";

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

/** A blank form template. Every filled, signed copy of a form repeats
 * the whole template, so its size multiplies by the number of patients. */
export const MAX_FORM_TEMPLATE_BYTES = 2 * 1024 * 1024; // 2 MB

const SIGNATURES: { bytes: number[]; mime: ApprovedFileType; ext: string }[] = [
  { bytes: [0xff, 0xd8, 0xff], mime: "image/jpeg", ext: "jpg" },
  { bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], mime: "image/png", ext: "png" },
  { bytes: [0x25, 0x50, 0x44, 0x46], mime: "application/pdf", ext: "pdf" },
];

/**
 * Detects the file's real type from its magic bytes, never trusting
 * the browser-supplied extension/MIME header alone (both are trivial
 * to spoof) — per the brief, "validate MIME type by magic bytes".
 * Returns null for anything outside our approved image/PDF set.
 */
export function detectFileType(buffer: Buffer): { mime: ApprovedFileType; ext: string } | null {
  for (const sig of SIGNATURES) {
    if (buffer.length >= sig.bytes.length && sig.bytes.every((b, i) => buffer[i] === b)) {
      return { mime: sig.mime, ext: sig.ext };
    }
  }
  return null;
}

export interface FileValidationError {
  error: string;
}

export function validateFile(
  buffer: Buffer,
): FileValidationError | { mime: ApprovedFileType; ext: string } {
  if (buffer.length === 0) {
    return { error: "The file is empty." };
  }
  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    return { error: `Files must be ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB or smaller.` };
  }
  const detected = detectFileType(buffer);
  if (!detected) {
    return { error: "Only JPEG, PNG, or PDF files are accepted." };
  }
  return detected;
}
