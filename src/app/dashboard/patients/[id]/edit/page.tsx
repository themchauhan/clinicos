import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { updatePatient } from "@/app/dashboard/patients/actions";
import { PatientForm } from "@/components/patients/patient-form";
import { BackLink } from "@/components/back-link";

export const metadata: Metadata = { title: "Edit patient — ClinicOS" };

export default async function EditPatientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: patient } = await supabase
    .from("patients")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!patient) {
    notFound();
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-8 sm:px-6">
      <BackLink href={`/dashboard/patients/${patient.id}`} label={patient.name} />
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">Edit {patient.name}</h1>
      <div className="mt-5">
        <PatientForm
          action={updatePatient.bind(null, patient.id)}
          submitLabel="Save changes"
          cancelHref={`/dashboard/patients/${patient.id}`}
          defaults={{
            name: patient.name,
            mobile: patient.mobile,
            dob: patient.dob,
            approximateAgeYears: patient.approximate_age_years,
            guardianName: patient.guardian_name,
            guardianRelation: patient.guardian_relation,
            gender: patient.gender,
            address: patient.address,
            livingSons: patient.living_sons,
            livingSonsAges: patient.living_sons_ages,
            livingDaughters: patient.living_daughters,
            livingDaughtersAges: patient.living_daughters_ages,
          }}
        />
      </div>
    </main>
  );
}
