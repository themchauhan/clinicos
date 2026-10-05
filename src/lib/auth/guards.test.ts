import { describe, expect, it } from "vitest";
import { requireRole, requireActiveTenant, AuthError } from "./guards";
import type { SessionProfile } from "./session";

function makeProfile(overrides: Partial<SessionProfile> = {}): SessionProfile {
  return {
    userId: "user-1",
    email: "admin@sunrise.test",
    name: "Demo Admin",
    role: "HOSPITAL_ADMIN",
    hospitalId: "hospital-1",
    isPlatformAdmin: false,
    hospital: {
      id: "hospital-1",
      name: "Sunrise General Hospital",
      status: "ACTIVE",
      trialEndsAt: new Date().toISOString(),
      subscriptionEndsAt: null,
    },
    enabledModules: ["GENERAL_OPD"],
    ...overrides,
  };
}

describe("requireRole", () => {
  it("returns the profile when the role is allowed", () => {
    const profile = makeProfile({ role: "RECEPTIONIST" });
    expect(requireRole(profile, ["RECEPTIONIST", "HOSPITAL_ADMIN"])).toBe(profile);
  });

  it("throws a 401 AuthError when there is no profile", () => {
    expect(() => requireRole(null, ["HOSPITAL_ADMIN"])).toThrow(AuthError);
    try {
      requireRole(null, ["HOSPITAL_ADMIN"]);
    } catch (error) {
      expect(error).toBeInstanceOf(AuthError);
      expect((error as AuthError).status).toBe(401);
    }
  });

  it("throws a 403 AuthError when the role isn't allowed", () => {
    const profile = makeProfile({ role: "RECEPTIONIST" });
    try {
      requireRole(profile, ["HOSPITAL_ADMIN"]);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AuthError);
      expect((error as AuthError).status).toBe(403);
    }
  });
});

describe("requireActiveTenant", () => {
  it("passes for an ACTIVE hospital", () => {
    const profile = makeProfile();
    expect(requireActiveTenant(profile)).toBe(profile);
  });

  it("passes for a TRIAL hospital", () => {
    const profile = makeProfile({
      hospital: {
        id: "hospital-1",
        name: "Sunrise",
        status: "TRIAL",
        trialEndsAt: new Date().toISOString(),
        subscriptionEndsAt: null,
      },
    });
    expect(requireActiveTenant(profile)).toBe(profile);
  });

  it("throws for a SUSPENDED hospital", () => {
    const profile = makeProfile({
      hospital: {
        id: "hospital-1",
        name: "Sunrise",
        status: "SUSPENDED",
        trialEndsAt: new Date().toISOString(),
        subscriptionEndsAt: null,
      },
    });
    expect(() => requireActiveTenant(profile)).toThrow(AuthError);
  });

  it("throws for an EXPIRED hospital", () => {
    const profile = makeProfile({
      hospital: {
        id: "hospital-1",
        name: "Sunrise",
        status: "EXPIRED",
        trialEndsAt: new Date().toISOString(),
        subscriptionEndsAt: null,
      },
    });
    expect(() => requireActiveTenant(profile)).toThrow(AuthError);
  });

  it("is exempt for a platform admin with no hospital", () => {
    const profile = makeProfile({
      role: "SUPER_ADMIN",
      hospitalId: null,
      isPlatformAdmin: true,
      hospital: null,
    });
    expect(requireActiveTenant(profile)).toBe(profile);
  });
});
