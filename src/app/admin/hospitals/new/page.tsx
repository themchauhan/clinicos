import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth/session";
import { requireRole } from "@/lib/auth/guards";
import { CreateHospitalForm } from "@/components/admin/create-hospital-form";
import { BackLink } from "@/components/back-link";

export const metadata: Metadata = { title: "Create centre — Hospital & USG Records" };

export default async function NewHospitalPage() {
  const profile = await getSessionProfile();
  if (!profile) {
    redirect("/login?next=/admin/hospitals/new");
  }
  if (!profile.isPlatformAdmin) {
    redirect("/dashboard");
  }
  requireRole(profile, ["SUPER_ADMIN"]);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-16 sm:px-6">
      <BackLink href="/admin" label="Super admin console" />
      <p className="mt-3 text-sm font-medium text-slate-500">Platform admin</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">Create centre</h1>

      <div className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <CreateHospitalForm />
      </div>
    </main>
  );
}
