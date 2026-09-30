import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { BackLink } from "@/components/back-link";
import { SettingsNav } from "@/components/settings/settings-nav";
import { FormTemplateList } from "@/components/settings/forms/form-template-list";
import { HospitalFormProfileForm } from "@/components/settings/hospital-form-profile-form";

export const metadata: Metadata = { title: "Forms — ClinicOS" };

export default async function FormTemplatesPage() {
  const supabase = await createClient();
  const [{ data: templates }, { data: hospitalRow }, { data: hospitalFormProfile }] =
    await Promise.all([
      supabase
        .from("form_templates")
        .select("id, name, description, version, effective_from, active")
        .order("name"),
      supabase.from("hospitals").select("name, address").maybeSingle(),
      supabase
        .from("hospital_form_profile")
        .select("centre_name, centre_address, registration_no, seal_storage_path")
        .maybeSingle(),
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
    </main>
  );
}
