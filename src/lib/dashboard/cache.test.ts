import { beforeEach, describe, expect, it } from "vitest";
import { cachedFor, clearDashboardCache } from "./cache";

describe("cachedFor", () => {
  beforeEach(clearDashboardCache);

  it("reuses a result within the TTL and reloads after it", async () => {
    let calls = 0;
    let clock = 1_000;
    const load = async () => ({ n: ++calls });
    const opts = { ttlMs: 60_000, now: () => clock };

    expect(await cachedFor("k", load, opts)).toEqual({ n: 1 });
    clock += 59_000;
    expect(await cachedFor("k", load, opts)).toEqual({ n: 1 });
    clock += 2_000;
    expect(await cachedFor("k", load, opts)).toEqual({ n: 2 });
  });

  it("keeps different keys (centre / role / period) apart", async () => {
    const a = await cachedFor("hospital-a:HOSPITAL_ADMIN:2026-10", async () => "A-admin");
    const b = await cachedFor("hospital-b:HOSPITAL_ADMIN:2026-10", async () => "B-admin");
    const r = await cachedFor("hospital-a:RECEPTIONIST:2026-10", async () => "A-reception");
    expect([a, b, r]).toEqual(["A-admin", "B-admin", "A-reception"]);
  });

  it("does not cache failures or empty results", async () => {
    let calls = 0;
    const load = async () => (++calls === 1 ? null : "ok");
    expect(await cachedFor("k", load)).toBeNull();
    expect(await cachedFor("k", load)).toBe("ok");
    expect(await cachedFor("k", load)).toBe("ok");
    expect(calls).toBe(2);
  });
});
