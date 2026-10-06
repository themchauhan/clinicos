import { describe, expect, it } from "vitest";
import { barPercent, foldRest, formatDay, formatInr, formatRange, percentChange } from "./summary";

describe("formatInr", () => {
  it("uses Indian digit grouping and whole rupees", () => {
    expect(formatInr(0)).toBe("₹0");
    expect(formatInr(22050)).toBe("₹22,050");
    expect(formatInr(1234567.5)).toBe("₹12,34,568");
    expect(formatInr(-500)).toBe("-₹500");
  });
});

describe("percentChange", () => {
  it("rounds the change versus the previous period", () => {
    expect(percentChange(150, 100)).toBe(50);
    expect(percentChange(75, 100)).toBe(-25);
    expect(percentChange(100, 100)).toBe(0);
  });

  it("is null when there is nothing to compare with", () => {
    expect(percentChange(10, 0)).toBeNull();
  });
});

describe("barPercent", () => {
  it("scales to the largest value with a visible minimum for non-zero values", () => {
    expect(barPercent(50, 100)).toBe(50);
    expect(barPercent(100, 100)).toBe(100);
    expect(barPercent(1, 1000)).toBe(2);
    expect(barPercent(0, 100)).toBe(0);
    expect(barPercent(5, 0)).toBe(0);
  });
});

describe("date formatting", () => {
  it("formats days and ranges without timezone drift", () => {
    expect(formatDay("2026-10-07")).toBe("7 Oct");
    expect(formatRange("2026-10-01", "2026-10-06")).toBe("1 Oct – 6 Oct 2026");
    expect(formatRange("2025-04-01", "2026-03-31")).toBe("1 Apr 2025 – 31 Mar 2026");
  });
});

describe("foldRest", () => {
  const rows = Array.from({ length: 11 }, (_, i) => ({
    name: `T${i}`,
    visits: 11 - i,
    collected: (11 - i) * 100,
  }));

  it("keeps the top rows and folds the tail into one summed row", () => {
    const out = foldRest(rows, 8);
    expect(out).toHaveLength(9);
    expect(out[7].name).toBe("T7");
    expect(out[8]).toMatchObject({
      name: "Other (3 more)",
      visits: 3 + 2 + 1,
      collected: 600,
      folded: true,
    });
  });

  it("leaves a short list alone, and keeps money null when there is none to sum", () => {
    expect(foldRest(rows.slice(0, 5), 8)).toHaveLength(5);
    const noMoney = rows.map((r) => ({ ...r, collected: null }));
    expect(foldRest(noMoney, 8)[8].collected).toBeNull();
  });
});
