/**
 * Canonical JSON and SHA-256, shared by the device and the server.
 *
 * An operation is hashed on the device when it is saved; the server hashes
 * what it received and compares. Equal hashes prove the operation arrived
 * exactly as it was saved -- not altered, truncated or corrupted by the
 * browser's storage, the network or a proxy. Both sides MUST use these
 * functions, so there is exactly one definition of "the same operation".
 *
 * Canonical form: object keys sorted, no whitespace, `undefined` treated as
 * absent (as JSON does), and only JSON-representable values allowed.
 */

export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) throw new TypeError("Cannot hash a non-finite number.");
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((v) => (v === undefined ? "null" : canonicalJson(v))).join(",")}]`;
      }
      const record = value as Record<string, unknown>;
      const parts: string[] = [];
      for (const key of Object.keys(record).sort()) {
        const v = record[key];
        if (v === undefined) continue;
        parts.push(`${JSON.stringify(key)}:${canonicalJson(v)}`);
      }
      return `{${parts.join(",")}}`;
    }
    default:
      throw new TypeError(`Cannot hash a value of type ${typeof value}.`);
  }
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Hash of an operation, ignoring its own `payload_hash` field. */
export async function operationHash(op: Record<string, unknown>): Promise<string> {
  const rest: Record<string, unknown> = { ...op };
  delete rest.payload_hash;
  return sha256Hex(canonicalJson(rest));
}

/** Returns the operation with its `payload_hash` filled in. */
export async function withHash<T extends Record<string, unknown>>(
  op: T,
): Promise<T & { payload_hash: string }> {
  return { ...op, payload_hash: await operationHash(op) };
}

export async function hashMatches(op: Record<string, unknown>): Promise<boolean> {
  return typeof op.payload_hash === "string" && op.payload_hash === (await operationHash(op));
}
