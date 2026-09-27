import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth/session";
import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { InviteStaffForm } from "@/components/staff/invite-staff-form";
import { StaffList } from "@/components/staff/staff-list";
import { BackLink } from "@/components/back-link";

export const metadata: Metadata = { title: "Staff — ClinicOS" };

export default async function StaffPage() {
  // dashboard/layout.tsx already confirmed a signed-in, MFA-satisfied
  // tenant profile; this page adds the narrower HOSPITAL_ADMIN-only
  // check on top.
  const profile = await getSessionProfile();
  if (!profile) {
    redirect("/login?next=/dashboard/staff");
  }
  if (profile.role !== "HOSPITAL_ADMIN") {
    redirect("/dashboard");
  }
  requireRole(profile, ["HOSPITAL_ADMIN"]);

  const supabase = await createClient();
  const { data: staff } = await supabase
    .from("profiles")
    .select("id, name, email, role, status")
    .order("name");

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-16 sm:px-6">
      <BackLink href="/dashboard" label="Dashboard" />
      <p className="mt-3 text-sm font-medium text-zinc-500 dark:text-zinc-400">
        {profile.hospital?.name ?? "Your centre"}
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Staff</h1>

      <div className="mt-8">
        <InviteStaffForm />
      </div>

      <div className="mt-10">
        <StaffList staff={staff ?? []} currentUserId={profile.userId} />
      </div>
    </main>
  );
}
