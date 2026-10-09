import { describe, expect, it } from "vitest";
import { parseChildren } from "./children";

const from = (values: Record<string, string>) => (name: string) => values[name] ?? "";

describe("parseChildren", () => {
  it("reads counts and ages, trimming them", () => {
    expect(
      parseChildren(
        from({
          livingSons: " 1 ",
          livingSonsAges: " 6 years ",
          livingDaughters: "2",
          livingDaughtersAges: "4 years, 8 months",
        }),
      ),
    ).toEqual({
      children: {
        livingSons: 1,
        livingSonsAges: "6 years",
        livingDaughters: 2,
        livingDaughtersAges: "4 years, 8 months",
      },
    });
  });

  it("treats everything blank as not recorded (null), and 0 as a real zero", () => {
    expect(parseChildren(from({}))).toEqual({
      children: {
        livingSons: null,
        livingSonsAges: null,
        livingDaughters: null,
        livingDaughtersAges: null,
      },
    });
    const zero = parseChildren(from({ livingSons: "0" }));
    expect("children" in zero && zero.children.livingSons).toBe(0);
  });

  it("rejects counts that are not whole numbers from 0 to 30", () => {
    for (const bad of ["-1", "1.5", "abc", "31", "1e3"]) {
      const r = parseChildren(from({ livingSons: bad }));
      expect("error" in r && r.error).toMatch(/Number of sons must be a whole number/);
    }
    const r = parseChildren(from({ livingDaughters: "99" }));
    expect("error" in r && r.error).toMatch(/Number of daughters/);
  });

  it("rejects ages that are too long", () => {
    const r = parseChildren(from({ livingDaughtersAges: "x".repeat(201) }));
    expect("error" in r && r.error).toMatch(/daughters' ages is too long/);
  });
});
