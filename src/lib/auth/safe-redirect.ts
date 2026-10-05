/**
 * Only ever redirect to a same-origin, relative path supplied via a
 * `next` query/form param — never follow it to an external host
 * (open-redirect guard).
 *
 * Browsers treat a backslash like a slash and strip tabs/newlines, so
 * "/\\evil.com" and "/\t/evil.com" both resolve to "//evil.com"; those
 * are rejected along with the plain "//" form.
 */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//")) {
    return null;
  }
  if (/[\\\u0000-\u001f\u007f]/.test(next)) {
    return null;
  }
  return next;
}
