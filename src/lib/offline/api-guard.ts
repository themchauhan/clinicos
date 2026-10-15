import "server-only";

import { getSessionProfile, type SessionProfile } from "@/lib/auth/session";
import { AuthError, requireActiveTenant, requireRole } from "@/lib/auth/guards";
import { getMfaStatus } from "@/lib/auth/mfa";

const noStore = { "cache-control": "no-store" };

/**
 * Who may call the offline API routes: a signed-in HOSPITAL_ADMIN or
 * RECEPTIONIST of an active centre -- and, like every dashboard page, only
 * after any second-factor challenge they have enrolled in is completed (a
 * session that has not passed it must not be able to reach patient data
 * through these routes either). For a POST, a cross-site request is refused.
 *
 * Returns the profile, or a ready-made error Response.
 */
export async function guardOfflineApi(
  request: Request,
  opts: { mutating?: boolean } = {},
): Promise<{ profile: SessionProfile } | { response: Response }> {
  if (opts.mutating) {
    const origin = request.headers.get("origin");
    const host = request.headers.get("host");
    if (origin) {
      let sameSite = false;
      try {
        sameSite = new URL(origin).host === host;
      } catch {
        sameSite = false;
      }
      if (!sameSite) {
        return {
          response: Response.json({ error: "forbidden" }, { status: 403, headers: noStore }),
        };
      }
    }
  }

  let profile: SessionProfile;
  try {
    profile = requireActiveTenant(
      requireRole(await getSessionProfile(), ["HOSPITAL_ADMIN", "RECEPTIONIST"]),
    );
  } catch (e) {
    return {
      response: Response.json(
        { error: "auth" },
        { status: e instanceof AuthError ? e.status : 401, headers: noStore },
      ),
    };
  }

  if ((await getMfaStatus(profile.role)) === "challenge_required") {
    return { response: Response.json({ error: "mfa" }, { status: 403, headers: noStore }) };
  }
  return { profile };
}
