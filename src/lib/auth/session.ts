import "server-only";

import { cache } from "react";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import type { HospitalStatus, ModuleType, StaffRole } from "@/types/database";

export interface SessionProfile {
  userId: string;
  email: string;
  name: string;
  role: StaffRole;
  /** null only for a verified platform admin (see isPlatformAdmin). */
  hospitalId: string | null;
  isPlatformAdmin: boolean;
  hospital: {
    id: string;
    name: string;
    status: HospitalStatus;
    trialEndsAt: string;
    subscriptionEndsAt: string | null;
  } | null;
  /** Modules enabled for the hospital (empty for a platform admin). */
  enabledModules: ModuleType[];
}

/**
 * The ONLY place `hospital_id` and `role` are read from for
 * authorization purposes, always derived from the authenticated
 * session — never from a client-supplied value. Cached per request so
 * repeated calls in one render pass don't re-query.
 *
 * Returns null if there is no signed-in, active user.
 */
export const getSessionProfile = cache(async (): Promise<SessionProfile | null> => {
  const supabase = await createClient();

  // The Auth server validates the session once per request, in
  // middleware.ts, which passes the verified user id on in a header it
  // alone sets (it deletes any client-sent copy first). Reuse it so
  // each request -- and each of a page's link prefetches -- isn't
  // charged a second Auth round trip. With no header (a path that
  // skipped middleware) fall back to validating here: getUser()
  // revalidates against the Auth server rather than trusting the local
  // cookie's JWT claims, which getSession() alone would.
  let userId = (await headers()).get("x-user-id");
  if (!userId) {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return null;
    }
    userId = user.id;
  }

  // Profile, hospital and enabled modules in one round trip.
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select(
      "id, hospital_id, name, email, role, status, hospitals(id, name, status, trial_ends_at, subscription_ends_at, hospital_modules(module))",
    )
    .eq("id", userId)
    .single();

  if (profileError || !profile || profile.status !== "ACTIVE") {
    return null;
  }

  let isPlatformAdmin = false;
  if (profile.role === "SUPER_ADMIN") {
    const { data: platformAdmin } = await supabase
      .from("platform_admins")
      .select("id")
      .eq("profile_id", userId)
      .maybeSingle();

    // A SUPER_ADMIN profile with no platform_admins row is a data
    // inconsistency, not a valid platform admin — deny rather than
    // silently downgrade to some other implicit access level.
    if (!platformAdmin) {
      return null;
    }
    isPlatformAdmin = true;
  }

  const hospitalRow = profile.hospitals;
  const hospital: SessionProfile["hospital"] = hospitalRow
    ? {
        id: hospitalRow.id,
        name: hospitalRow.name,
        status: hospitalRow.status,
        trialEndsAt: hospitalRow.trial_ends_at,
        subscriptionEndsAt: hospitalRow.subscription_ends_at,
      }
    : null;

  return {
    userId,
    email: profile.email,
    name: profile.name,
    role: profile.role,
    hospitalId: profile.hospital_id,
    isPlatformAdmin,
    hospital,
    enabledModules: (hospitalRow?.hospital_modules ?? []).map((m) => m.module),
  };
});
