import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth/session";
import { getMfaStatus } from "@/lib/auth/mfa";
import { safeNextPath } from "@/lib/auth/safe-redirect";
import { MfaSetupForm } from "@/components/mfa/mfa-setup-form";

export const metadata: Metadata = { title: "Set up two-factor authentication" };

export default async function MfaSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const profile = await getSessionProfile();
  if (!profile) {
    redirect("/login");
  }

  const next = safeNextPath((await searchParams).next) ?? "/dashboard";
  const status = await getMfaStatus(profile.role);

  if (status === "satisfied") {
    redirect(next);
  }
  if (status === "challenge_required") {
    // Already has a verified factor -- verify this session rather than
    // enroll a second one.
    redirect(`/mfa/verify?next=${encodeURIComponent(next)}`);
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center px-4 py-16 sm:px-6">
      <div className="flex w-full max-w-sm flex-col gap-6 rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Set up two-factor authentication
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            {status === "enroll_required"
              ? "Required for platform admin accounts."
              : "Optional, for extra account security."}{" "}
            You&apos;ll need an authenticator app (Google Authenticator, Authy, 1Password, etc.).
          </p>
        </div>
        <MfaSetupForm next={next} />
      </div>
    </main>
  );
}
