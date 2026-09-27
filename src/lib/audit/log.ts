import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getSessionProfile } from "@/lib/auth/session";
import { AuthError } from "@/lib/auth/guards";

interface LogAuditInput {
  action: string;
  targetType: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Writes an audit_logs row for the CURRENT session. hospital_id and
 * user_id always come from getSessionProfile() — never accept them as
 * parameters, so a caller can't audit-log an action against a
 * hospital other than its own. Inserts via the user's own session
 * client, so the audit_logs RLS policy's WITH CHECK is a second,
 * independent enforcement of the same rule.
 */
export async function logAudit({ action, targetType, targetId, metadata }: LogAuditInput) {
  const profile = await getSessionProfile();
  if (!profile) {
    throw new AuthError("Sign-in required.", 401);
  }

  const supabase = await createClient();
  const { error } = await supabase.from("audit_logs").insert({
    hospital_id: profile.hospitalId,
    user_id: profile.userId,
    action,
    target_type: targetType,
    target_id: targetId ?? null,
    metadata: metadata ?? {},
  });

  if (error) {
    throw error;
  }
}

interface LogPlatformAdminAuditInput extends LogAuditInput {
  targetHospitalId: string;
}

/**
 * Same as logAudit(), for the one caller with a real session but
 * whose own hospital_id is null (a platform admin) and who needs to
 * log against a DIFFERENT hospital's id (Phase 8: creating/
 * suspending/reactivating a centre isn't an action against the
 * platform admin's own tenant, since they don't have one). Verifies
 * isPlatformAdmin itself rather than trusting the caller, and still
 * inserts via the caller's own session client — the loosened
 * audit_logs INSERT policy (Phase 8 migration) is what actually makes
 * a non-null, non-own hospital_id insert possible here, so this
 * function has no more power than that policy already grants.
 */
export async function logPlatformAdminAudit({
  targetHospitalId,
  action,
  targetType,
  targetId,
  metadata,
}: LogPlatformAdminAuditInput) {
  const profile = await getSessionProfile();
  if (!profile?.isPlatformAdmin) {
    throw new AuthError("Platform admin required.", 403);
  }

  const supabase = await createClient();
  const { error } = await supabase.from("audit_logs").insert({
    hospital_id: targetHospitalId,
    user_id: profile.userId,
    action,
    target_type: targetType,
    target_id: targetId ?? null,
    metadata: metadata ?? {},
  });

  if (error) {
    throw error;
  }
}

interface LogAuditAsInput extends LogAuditInput {
  // Nullable so a SUPER_ADMIN purge event (permanentlyDeleteHospital)
  // can log hospital_id: null — audit_logs.hospital_id is ON DELETE
  // RESTRICT (not cascade), so a real hospital_id here would either
  // block that hospital's own deletion or get destroyed along with
  // it, losing the only record the purge happened. null is exactly
  // what this column's own nullability already exists for (see the
  // audit_logs migration's "platform-admin action not tied to one
  // hospital" comment).
  hospitalId: string | null;
  userId: string;
}

/**
 * Same as logAudit(), for callers that have no session to pull
 * hospital_id/user_id from: the Phase 5 phone-camera scan upload
 * (src/app/scan/actions.ts), which authenticates via a validated
 * scan_sessions token instead, and the SUPER_ADMIN hospital/patient
 * purge actions (src/app/admin/actions.ts), which run under the
 * service-role client deliberately (crossing tenant RLS on purpose).
 * hospitalId/userId are always caller-supplied from an
 * already-validated source, never from anything untrusted. Inserts
 * via the service-role client (RLS's WITH CHECK can't apply — there's
 * no auth.uid() to check it against), so this is deliberately a
 * narrower exception, not a general-purpose replacement for
 * logAudit().
 */
export async function logAuditFromServiceRole({
  hospitalId,
  userId,
  action,
  targetType,
  targetId,
  metadata,
}: LogAuditAsInput) {
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("audit_logs").insert({
    hospital_id: hospitalId,
    user_id: userId,
    action,
    target_type: targetType,
    target_id: targetId ?? null,
    metadata: metadata ?? {},
  });

  if (error) {
    throw error;
  }
}
