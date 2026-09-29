import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth/session";
import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { ModuleToggle } from "@/components/settings/module-toggle";
import { VisitTypeList } from "@/components/settings/visit-type-list";
import { VisitTypeForm } from "@/components/settings/visit-type-form";
import { DoctorList } from "@/components/settings/doctor-list";
import { DoctorForm } from "@/components/settings/doctor-form";
import { DocumentTypeList } from "@/components/settings/document-type-list";
import { DocumentTypeForm } from "@/components/settings/document-type-form";
import { RequirementsMatrix } from "@/components/settings/requirements-matrix";
import { BackLink } from "@/components/back-link";
import type { ModuleType } from "@/types/database";

export const metadata: Metadata = { title: "Settings — ClinicOS" };

const ALL_MODULES: { module: ModuleType; label: string }[] = [
  { module: "GENERAL_OPD", label: "General OPD" },
  { module: "USG", label: "USG" },
];

export default async function SettingsPage() {
  // dashboard/layout.tsx already confirmed a signed-in, MFA-satisfied
  // tenant profile; this page adds the narrower HOSPITAL_ADMIN-only
  // check on top, same as staff/page.tsx.
  const profile = await getSessionProfile();
  if (!profile) {
    redirect("/login?next=/dashboard/settings");
  }
  if (profile.role !== "HOSPITAL_ADMIN") {
    redirect("/dashboard");
  }
  requireRole(profile, ["HOSPITAL_ADMIN"]);

  const supabase = await createClient();
  const [
    { data: enabledModules },
    { data: visitTypes },
    { data: doctors },
    { data: documentTypes },
    { data: requirements },
  ] = await Promise.all([
    supabase.from("hospital_modules").select("module"),
    supabase.from("visit_types").select("*").order("name"),
    supabase.from("doctors").select("*").order("name"),
    supabase.from("document_types").select("*").order("name"),
    supabase
      .from("visit_type_document_requirements")
      .select("visit_type_id, document_type_id, required"),
  ]);

  const enabledSet = new Set((enabledModules ?? []).map((m) => m.module));

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-16 sm:px-6">
      <BackLink href="/dashboard" label="Dashboard" />
      <p className="mt-3 text-sm font-medium text-zinc-500 dark:text-zinc-400">
        {profile.hospital?.name ?? "Your centre"}
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Settings</h1>

      <div className="mt-10 rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-lg font-semibold">Modules</h2>
        <div className="mt-4 flex flex-wrap gap-3">
          {ALL_MODULES.map(({ module, label }) => (
            <ModuleToggle
              key={module}
              module={module}
              label={label}
              enabled={enabledSet.has(module)}
            />
          ))}
        </div>
      </div>

      <div className="mt-10 rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-lg font-semibold">Visit types</h2>
        <div className="mt-4">
          <VisitTypeForm />
        </div>
        <div className="mt-6">
          <VisitTypeList visitTypes={visitTypes ?? []} />
        </div>
      </div>

      <div className="mt-10 rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-lg font-semibold">Doctors</h2>
        <div className="mt-4">
          <DoctorForm />
        </div>
        <div className="mt-6">
          <DoctorList doctors={doctors ?? []} />
        </div>
      </div>

      <div className="mt-10 rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-lg font-semibold">Document types</h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Adding a type with the same name as an existing one supersedes it as a new version — the
          old one is marked inactive automatically. Mark a type &ldquo;PC-PNDT declaration&rdquo;
          (for Pregnancy/Obstetric USG) so its current version and effective date show on the visit.
        </p>
        <div className="mt-4">
          <DocumentTypeForm />
        </div>
        <div className="mt-6">
          <DocumentTypeList documentTypes={documentTypes ?? []} />
        </div>
      </div>

      <div className="mt-10 rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-lg font-semibold">Document requirements</h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Which document types are required (or optional) for each visit type. New visits snapshot
          these rules at creation time, so a change here never rewrites the checklist of a visit
          already created.
        </p>
        <div className="mt-4 overflow-x-auto">
          <RequirementsMatrix
            visitTypes={visitTypes ?? []}
            documentTypes={documentTypes ?? []}
            requirements={requirements ?? []}
          />
        </div>
      </div>
    </main>
  );
}
