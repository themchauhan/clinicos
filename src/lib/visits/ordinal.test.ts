import { describe, expect, it } from "vitest";
import { ordinal } from "./ordinal";

describe("ordinal", () => {
  it("handles the usual suffixes", () => {
    expect([1, 2, 3, 4, 10].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "10th"]);
  });

  it("uses 'th' for the teens, not st/nd/rd", () => {
    expect([11, 12, 13, 111, 112].map(ordinal)).toEqual(["11th", "12th", "13th", "111th", "112th"]);
  });

  it("goes back to st/nd/rd after the teens", () => {
    expect([21, 22, 23, 101, 102].map(ordinal)).toEqual(["21st", "22nd", "23rd", "101st", "102nd"]);
  });
});
