import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth/session";
import { requireRole } from "@/lib/auth/guards";
import { getMfaStatus } from "@/lib/auth/mfa";

/**
 * Shared by every /admin/* route: platform-admin gate + MFA gate, so a
 * new nested page under /admin can't accidentally ship without either
 * check (unlike per-page inline checks, which are easy to forget to
 * copy) -- mirrors src/app/dashboard/layout.tsx. Sub-pages keep their
 * own requireRole call on top of this as defensive redundancy, same
 * convention dashboard/staff uses on top of dashboard/layout.tsx.
 */
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const profile = await getSessionProfile();

  if (!profile) {
    redirect("/login?next=/admin");
  }
  if (!profile.isPlatformAdmin) {
    redirect("/dashboard");
  }
  requireRole(profile, ["SUPER_ADMIN"]);

  const mfaStatus = await getMfaStatus(profile.role);
  if (mfaStatus === "enroll_required") {
    redirect("/mfa/setup?next=/admin");
  }
  if (mfaStatus === "challenge_required") {
    redirect("/mfa/verify?next=/admin");
  }

  return children;
}
