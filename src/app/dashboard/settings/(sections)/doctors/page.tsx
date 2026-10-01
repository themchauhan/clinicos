import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { DoctorForm } from "@/components/settings/doctor-form";
import { DoctorList } from "@/components/settings/doctor-list";

export const metadata: Metadata = { title: "Doctors — ClinicOS" };

export default async function DoctorsSettingsPage() {
  const supabase = await createClient();
  const { data: doctors } = await supabase.from("doctors").select("*").order("name");

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <h2 className="text-lg font-semibold">Doctors</h2>
      <div className="mt-4">
        <DoctorForm />
      </div>
      <div className="mt-6">
        <DoctorList
          doctors={(doctors ?? []).map((d) => ({
            id: d.id,
            name: d.name,
            registrationNo: d.registration_no,
            hasSignature: Boolean(d.signature_storage_path),
            active: d.active,
          }))}
        />
      </div>
    </div>
  );
}
