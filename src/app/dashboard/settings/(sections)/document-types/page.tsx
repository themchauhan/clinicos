import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { DocumentTypeForm } from "@/components/settings/document-type-form";
import { DocumentTypeList } from "@/components/settings/document-type-list";
import { RequirementsMatrix } from "@/components/settings/requirements-matrix";

export const metadata: Metadata = { title: "Document types — ClinicOS" };

export default async function DocumentTypesSettingsPage() {
  const supabase = await createClient();
  const [{ data: visitTypes }, { data: documentTypes }, { data: requirements }] = await Promise.all(
    [
      supabase.from("visit_types").select("*").order("name"),
      supabase.from("document_types").select("*").order("name"),
      supabase
        .from("visit_type_document_requirements")
        .select("visit_type_id, document_type_id, required"),
    ],
  );

  return (
    <>
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
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

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
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
    </>
  );
}
