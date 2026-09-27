import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth/session";
import { requireRole } from "@/lib/auth/guards";
import { getMfaStatus } from "@/lib/auth/mfa";
import { safeNextPath } from "@/lib/auth/safe-redirect";

/**
 * Shared by every /dashboard/* route: tenant-role gate + MFA gate, so
 * a new nested page under /dashboard can't accidentally ship without
 * either check (unlike per-page inline checks, which are easy to
 * forget to copy). /dashboard/staff still adds its own narrower
 * HOSPITAL_ADMIN-only check on top of this.
 */
export default async function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  // The actual requested path (e.g. /dashboard/patients/new), set by
  // middleware.ts — not just "/dashboard" — so completing the MFA gate
  // below returns the user to the page they asked for, not the
  // dashboard root every time.
  const requestedPath = safeNextPath((await headers()).get("x-pathname")) ?? "/dashboard";

  const profile = await getSessionProfile();

  if (!profile) {
    redirect(`/login?next=${encodeURIComponent(requestedPath)}`);
  }
  if (profile.isPlatformAdmin) {
    redirect("/admin");
  }
  requireRole(profile, ["HOSPITAL_ADMIN", "RECEPTIONIST"]);

  // enroll_required never applies here -- HOSPITAL_ADMIN/RECEPTIONIST
  // aren't in mfa.ts's mandatory-role list, only SUPER_ADMIN is.
  const mfaStatus = await getMfaStatus(profile.role);
  if (mfaStatus === "challenge_required") {
    redirect(`/mfa/verify?next=${encodeURIComponent(requestedPath)}`);
  }

  return children;
}
