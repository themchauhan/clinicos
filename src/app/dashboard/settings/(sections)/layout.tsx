import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth/session";
import { BackLink } from "@/components/back-link";
import { SettingsNav } from "@/components/settings/settings-nav";

/**
 * Shared chrome for the settings "sections" (Overview, Visit types,
 * Doctors, Document types) -- a route group so it applies to exactly
 * these pages and not to ../forms/*, which already owns its own
 * multi-page chrome (list/new/edit) and would otherwise end up
 * double-wrapped.
 */
export default async function SettingsSectionsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // dashboard/layout.tsx already confirmed a signed-in, MFA-satisfied
  // tenant profile; this adds the narrower HOSPITAL_ADMIN-only check
  // on top, same as every settings page already did individually.
  const profile = await getSessionProfile();
  if (!profile) {
    redirect("/login?next=/dashboard/settings");
  }
  if (profile.role !== "HOSPITAL_ADMIN") {
    redirect("/dashboard");
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-16 sm:px-6">
      <BackLink href="/dashboard" label="Dashboard" />
      <p className="mt-3 text-sm font-medium text-zinc-500 dark:text-zinc-400">
        {profile.hospital?.name ?? "Your centre"}
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Settings</h1>
      <div className="mt-6">
        <SettingsNav />
      </div>
      <div className="mt-8 flex flex-col gap-10">{children}</div>
    </main>
  );
}
