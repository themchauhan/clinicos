import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { VisitTypeForm } from "@/components/settings/visit-type-form";
import { VisitTypeList } from "@/components/settings/visit-type-list";

export const metadata: Metadata = { title: "Visit types — ClinicOS" };

export default async function VisitTypesSettingsPage() {
  const supabase = await createClient();
  const { data: visitTypes } = await supabase.from("visit_types").select("*").order("name");

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <h2 className="text-lg font-semibold">Visit types</h2>
      <div className="mt-4">
        <VisitTypeForm />
      </div>
      <div className="mt-6">
        <VisitTypeList visitTypes={visitTypes ?? []} />
      </div>
    </div>
  );
}
