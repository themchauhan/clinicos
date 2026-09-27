import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth/session";
import { requireRole } from "@/lib/auth/guards";
import { getMfaStatus } from "@/lib/auth/mfa";
import { createClient } from "@/lib/supabase/server";
import { DisableMfaButton } from "@/components/mfa/disable-mfa-button";

export const metadata: Metadata = { title: "Account security — ClinicOS" };

/**
 * Self-service opt-in MFA toggle -- reachable by both HOSPITAL_ADMIN
 * and SUPER_ADMIN, who never share a layout today, so this lives
 * outside /dashboard and /admin (same as /mfa/setup, /mfa/verify).
 */
export default async function AccountSecurityPage() {
  const profile = await getSessionProfile();
  if (!profile) {
    redirect("/login?next=/account/security");
  }
  if (!profile.isPlatformAdmin && profile.role !== "HOSPITAL_ADMIN") {
    redirect("/dashboard");
  }
  requireRole(profile, ["SUPER_ADMIN", "HOSPITAL_ADMIN"]);

  // SUPER_ADMIN has no factor yet -- send straight into the mandatory
  // setup flow rather than showing a "not enabled" state that looks
  // optional. If a verified factor already exists, this session must
  // complete the challenge before it can view/manage it -- otherwise
  // disabling it below would fail (Supabase requires aal2 to unenroll
  // a verified factor), and reaching aal2 is meant to be required
  // before anyone can act on this account's own security settings
  // anyway.
  const mfaStatus = await getMfaStatus(profile.role);
  if (mfaStatus === "enroll_required") {
    redirect(`/mfa/setup?next=${encodeURIComponent("/account/security")}`);
  }
  if (mfaStatus === "challenge_required") {
    redirect(`/mfa/verify?next=${encodeURIComponent("/account/security")}`);
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.mfa.listFactors();
  const enabled = (data?.all ?? []).some(
    (factor) => factor.factor_type === "totp" && factor.status === "verified",
  );

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 py-16 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Account security</h1>
      <p className="mt-1 text-sm text-slate-600">
        {profile.role === "SUPER_ADMIN"
          ? "Two-factor authentication for your own account, using an authenticator app."
          : "Optional two-factor authentication for your own account, using an authenticator app."}
      </p>

      <div className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-lg font-semibold text-slate-900">Two-factor authentication</h2>
        {enabled ? (
          <>
            <p className="mt-2 text-sm text-emerald-700">
              Enabled — you&apos;ll be asked for a code from your authenticator app each time you
              sign in.
            </p>
            {profile.role === "SUPER_ADMIN" ? (
              <p className="mt-2 text-sm text-slate-500">
                Required for platform admin accounts and can&apos;t be turned off here.
              </p>
            ) : (
              <div className="mt-4">
                <DisableMfaButton />
              </div>
            )}
          </>
        ) : (
          <>
            <p className="mt-2 text-sm text-slate-600">
              Not enabled. Turn this on to require a code from an authenticator app (like Google
              Authenticator or Authy) each time you sign in.
            </p>
            <Link
              href="/mfa/setup?next=/account/security"
              className="mt-4 inline-block w-fit rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-700"
            >
              Enable two-factor authentication
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
