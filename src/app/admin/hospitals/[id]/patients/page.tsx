import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth/session";
import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { BackLink } from "@/components/back-link";
import { DeletePatientButton } from "@/components/admin/delete-patient-button";

export const metadata: Metadata = { title: "Centre patients — ClinicOS" };

/**
 * Deliberately minimal and separate from the tenant-facing
 * /dashboard/patients list -- this exists solely so a SUPER_ADMIN can
 * find and permanently purge test data from a real deployment (see
 * CLAUDE.md hard rule #6's carve-out), not as a general patient-
 * management surface. Guards identically to the hospital detail page;
 * doesn't touch dashboard/layout.tsx's platform-admin redirect.
 */
export default async function HospitalPatientsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await getSessionProfile();
  if (!profile) {
    redirect(`/login?next=/admin/hospitals/${id}/patients`);
  }
  if (!profile.isPlatformAdmin) {
    redirect("/dashboard");
  }
  requireRole(profile, ["SUPER_ADMIN"]);

  const supabase = await createClient();
  // patients has no platform-admin SELECT policy (unlike hospitals,
  // which got one in Phase 8) -- this admin-only list is exactly the
  // kind of cross-tenant read the service-role client exists for.
  const serviceRole = createServiceRoleClient();
  const [{ data: hospital }, { data: patients }] = await Promise.all([
    supabase.from("hospitals").select("id, name").eq("id", id).maybeSingle(),
    serviceRole
      .from("patients")
      .select("id, name, patient_code, created_at")
      .eq("hospital_id", id)
      .order("created_at", { ascending: false }),
  ]);

  if (!hospital) {
    notFound();
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-16 sm:px-6">
      <BackLink href={`/admin/hospitals/${hospital.id}`} label={hospital.name} />
      <p className="mt-3 text-sm font-medium text-slate-500">Platform admin</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
        {hospital.name} — Patients
      </h1>
      <p className="mt-1 max-w-xl text-sm text-slate-600">
        For clearing test data from a real deployment only — permanently deletes a patient and all
        their visits/documents. This cannot be undone.
      </p>

      <div className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        {patients && patients.length > 0 ? (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2 font-medium">Code</th>
                <th className="py-2 font-medium">Name</th>
                <th className="py-2 font-medium">Created</th>
                <th className="py-2 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {patients.map((p) => (
                <tr key={p.id} className="border-b border-slate-100 last:border-0">
                  <td className="py-2 font-mono text-slate-600">{p.patient_code}</td>
                  <td className="py-2">{p.name}</td>
                  <td className="py-2 text-slate-600">
                    {new Date(p.created_at).toLocaleDateString()}
                  </td>
                  <td className="py-2 text-right">
                    <DeletePatientButton patientId={p.id} patientName={p.name} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-slate-500">No patients yet.</p>
        )}
      </div>
    </main>
  );
}
