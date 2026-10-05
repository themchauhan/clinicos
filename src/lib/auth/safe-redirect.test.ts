import { describe, expect, it } from "vitest";
import { safeNextPath } from "./safe-redirect";

describe("safeNextPath", () => {
  it("allows same-origin relative paths, including a query string", () => {
    expect(safeNextPath("/dashboard")).toBe("/dashboard");
    expect(safeNextPath("/dashboard/visits?when=all")).toBe("/dashboard/visits?when=all");
  });

  it("rejects empty values and anything not starting with a single slash", () => {
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath("")).toBeNull();
    expect(safeNextPath("https://evil.com")).toBeNull();
    expect(safeNextPath("dashboard")).toBeNull();
  });

  it("rejects protocol-relative and backslash/control-character tricks", () => {
    expect(safeNextPath("//evil.com")).toBeNull();
    expect(safeNextPath("/\\evil.com")).toBeNull();
    expect(safeNextPath("/\t/evil.com")).toBeNull();
    expect(safeNextPath("/\n/evil.com")).toBeNull();
  });
});
