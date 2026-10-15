// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const session = vi.hoisted(() => ({ profile: null as unknown, mfa: "satisfied" as string }));
vi.mock("@/lib/auth/session", () => ({ getSessionProfile: async () => session.profile }));
vi.mock("@/lib/auth/mfa", () => ({ getMfaStatus: async () => session.mfa }));

import { guardOfflineApi } from "./api-guard";

const profile = (over: Record<string, unknown> = {}) => ({
  userId: "u1",
  role: "RECEPTIONIST",
  hospitalId: "h1",
  isPlatformAdmin: false,
  hospital: { status: "ACTIVE" },
  ...over,
});
const req = (headers: Record<string, string> = {}) =>
  new Request("https://clinic.example/api/offline/sync", { method: "POST", headers });

const statusOf = async (r: Awaited<ReturnType<typeof guardOfflineApi>>) =>
  "response" in r ? { status: r.response.status, body: await r.response.json() } : null;

beforeEach(() => {
  session.profile = profile();
  session.mfa = "satisfied";
});

describe("guardOfflineApi", () => {
  it("lets a receptionist or admin of an active centre through", async () => {
    expect("profile" in (await guardOfflineApi(req(), { mutating: true }))).toBe(true);
    session.profile = profile({ role: "HOSPITAL_ADMIN" });
    expect("profile" in (await guardOfflineApi(req(), { mutating: true }))).toBe(true);
  });

  it("refuses a signed-out caller (401), a platform admin, and a suspended centre (403)", async () => {
    session.profile = null;
    expect(await statusOf(await guardOfflineApi(req()))).toMatchObject({ status: 401 });
    session.profile = profile({ role: "SUPER_ADMIN", isPlatformAdmin: true, hospitalId: null });
    expect(await statusOf(await guardOfflineApi(req()))).toMatchObject({ status: 403 });
    session.profile = profile({ hospital: { status: "SUSPENDED" } });
    expect(await statusOf(await guardOfflineApi(req()))).toMatchObject({ status: 403 });
  });

  it("refuses a session that has not completed its second-factor challenge", async () => {
    session.mfa = "challenge_required";
    expect(await statusOf(await guardOfflineApi(req()))).toMatchObject({
      status: 403,
      body: { error: "mfa" },
    });
  });

  it("refuses a cross-site POST but allows the app's own origin (and requests with no Origin)", async () => {
    const cross = await guardOfflineApi(
      req({ origin: "https://evil.example", host: "clinic.example" }),
      { mutating: true },
    );
    expect(await statusOf(cross)).toMatchObject({ status: 403, body: { error: "forbidden" } });
    const bad = await guardOfflineApi(req({ origin: "not a url", host: "clinic.example" }), {
      mutating: true,
    });
    expect(await statusOf(bad)).toMatchObject({ status: 403 });
    const same = await guardOfflineApi(
      req({ origin: "https://clinic.example", host: "clinic.example" }),
      { mutating: true },
    );
    expect("profile" in same).toBe(true);
    expect(
      "profile" in (await guardOfflineApi(req({ host: "clinic.example" }), { mutating: true })),
    ).toBe(true);
  });

  it("does not apply the origin rule to reads", async () => {
    const read = await guardOfflineApi(
      req({ origin: "https://evil.example", host: "clinic.example" }),
    );
    expect("profile" in read).toBe(true);
  });
});
