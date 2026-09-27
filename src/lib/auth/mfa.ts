import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { StaffRole } from "@/types/database";

const MFA_MANDATORY_ROLES: readonly StaffRole[] = ["SUPER_ADMIN"];

export type MfaStatus = "not_required" | "enroll_required" | "challenge_required" | "satisfied";

/**
 * MFA is mandatory for SUPER_ADMIN (platform admin) by default -- a
 * fresh SUPER_ADMIN login with no verified factor is forced through
 * enrollment. For every other role it's opt-in: a HOSPITAL_ADMIN can
 * turn it on for their own account from /account/security, and once a
 * verified factor exists (for ANY role) it's enforced every session
 * from then on, since that part purely reflects Supabase's own AAL
 * state rather than a role check.
 */
export async function getMfaStatus(role: StaffRole): Promise<MfaStatus> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || !data) {
    return "not_required";
  }

  if (data.currentLevel === "aal2") {
    return "satisfied";
  }
  if (data.nextLevel === "aal2") {
    // A verified factor exists; this session just hasn't completed
    // the challenge yet.
    return "challenge_required";
  }
  // No verified factor exists yet.
  return MFA_MANDATORY_ROLES.includes(role) ? "enroll_required" : "not_required";
}
