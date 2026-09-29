import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NewVisitForm } from "@/components/visits/new-visit-form";
import { BackLink } from "@/components/back-link";

export const metadata: Metadata = { title: "New visit — ClinicOS" };

export default async function NewVisitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: patientId } = await params;
  const supabase = await createClient();

  const [{ data: patient }, { data: visitTypes }, { data: doctors }] = await Promise.all([
    supabase
      .from("patients")
      .select("id, name")
      .eq("id", patientId)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase.from("visit_types").select("id, name, default_fee").eq("active", true).order("name"),
    supabase.from("doctors").select("id, name").eq("active", true).order("name"),
  ]);

  if (!patient) {
    notFound();
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-16 sm:px-6">
      <BackLink href={`/dashboard/patients/${patient.id}`} label={patient.name} />
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">New visit</h1>
      <div className="mt-8">
        <NewVisitForm
          patientId={patient.id}
          visitTypes={(visitTypes ?? []).map((vt) => ({
            id: vt.id,
            name: vt.name,
            defaultFee: vt.default_fee,
          }))}
          doctors={doctors ?? []}
        />
      </div>
    </main>
  );
}
