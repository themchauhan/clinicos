import { afterEach, describe, expect, it, vi } from "vitest";
import { todayInAppTimezone } from "./today";

describe("todayInAppTimezone", () => {
  afterEach(() => vi.useRealTimers());

  it("is still the previous Indian day just before 00:00 IST (18:29 UTC)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-02T18:29:00Z"));
    expect(todayInAppTimezone()).toBe("2026-10-02");
  });

  it("rolls over at Indian midnight (18:30 UTC), not UTC midnight", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-02T18:30:00Z"));
    expect(todayInAppTimezone()).toBe("2026-10-03");
  });
});
