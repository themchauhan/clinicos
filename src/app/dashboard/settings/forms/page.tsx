import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { BackLink } from "@/components/back-link";
import { SettingsNav } from "@/components/settings/settings-nav";
import { FormTemplateList } from "@/components/settings/forms/form-template-list";
import { RequirementsMatrix } from "@/components/settings/requirements-matrix";
import { HospitalFormProfileForm } from "@/components/settings/hospital-form-profile-form";

export const metadata: Metadata = { title: "Forms — ClinicOS" };

export default async function FormTemplatesPage() {
  const supabase = await createClient();
  const [
    { data: templates },
    { data: hospitalRow },
    { data: hospitalFormProfile },
    { data: visitTypes },
    { data: formRequirements },
  ] = await Promise.all([
    supabase
      .from("form_templates")
      .select("id, name, description, version, effective_from, active")
      .order("name"),
    supabase.from("hospitals").select("name, address").maybeSingle(),
    supabase
      .from("hospital_form_profile")
      .select("centre_name, centre_address, registration_no, seal_storage_path")
      .maybeSingle(),
    supabase.from("visit_types").select("id, name, active").order("name"),
    supabase
      .from("visit_type_form_requirements")
      .select("visit_type_id, form_template_id, required"),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-16 sm:px-6">
      <BackLink href="/dashboard/settings" label="Settings" />
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">Settings</h1>
      <div className="mt-6">
        <SettingsNav />
      </div>

      <div className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-lg font-semibold">Hospital details for forms</h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Saved once, then filled in automatically wherever a form field is sourced from
          &ldquo;Hospital&rdquo; in the forms designer — no more retyping the registration number on
          every visit.
        </p>
        <div className="mt-4">
          <HospitalFormProfileForm
            hospitalName={hospitalRow?.name ?? "your centre"}
            hospitalAddress={hospitalRow?.address ?? ""}
            centreName={hospitalFormProfile?.centre_name ?? null}
            centreAddress={hospitalFormProfile?.centre_address ?? null}
            registrationNo={hospitalFormProfile?.registration_no ?? null}
            hasSeal={Boolean(hospitalFormProfile?.seal_storage_path)}
          />
        </div>
      </div>

      <div className="mt-10 rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold">Forms</h2>
          <Link
            href="/dashboard/settings/forms/new"
            className="shrink-0 rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-700"
          >
            New form
          </Link>
        </div>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Fillable, signable forms (e.g. PC-PNDT declarations) — staff fill these on a visit and the
          patient signs, producing a filled copy of the real uploaded form. Adding a form with the
          same name as an existing one supersedes it as a new version.
        </p>
        <div className="mt-6">
          <FormTemplateList templates={templates ?? []} />
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-lg font-semibold">Required forms per visit type</h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Mark a form Required for a visit type (e.g. Form G for a General USG) and every new visit
          of that type lists it on its checklist, flags it as pending until it is signed, and counts
          it on the dashboard. Existing visits keep the checklist they were created with.
        </p>
        <div className="mt-4 overflow-x-auto">
          <RequirementsMatrix
            kind="form"
            visitTypes={visitTypes ?? []}
            documentTypes={(templates ?? []).map((t) => ({
              id: t.id,
              name: t.name,
              active: t.active,
            }))}
            requirements={(formRequirements ?? []).map((r) => ({
              visit_type_id: r.visit_type_id,
              document_type_id: r.form_template_id,
              required: r.required,
            }))}
          />
        </div>
      </div>
    </main>
  );
}
