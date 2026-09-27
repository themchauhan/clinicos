import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Pending documents — ClinicOS" };

/**
 * Every visit missing a required document shows up here — the safety
 * net the brief calls out explicitly: "so nothing is silently lost,
 * this is the safety net that paper alone never had."
 */
export default async function PendingDocumentsPage() {
  const supabase = await createClient();

  const [{ data: requirements }, { data: documents }] = await Promise.all([
    supabase
      .from("visit_document_requirements")
      .select(
        "id, document_type_id, document_type_name, required, visits(id, visit_number, visit_date, patients(id, name, patient_code))",
      )
      .eq("required", true),
    supabase
      .from("documents")
      .select("patient_id, visit_id, document_type_id")
      .is("deleted_at", null),
  ]);

  const fulfilledByVisit = new Set(
    (documents ?? []).filter((d) => d.visit_id).map((d) => `${d.visit_id}:${d.document_type_id}`),
  );
  const fulfilledByPatient = new Set(
    (documents ?? []).map((d) => `${d.patient_id}:${d.document_type_id}`),
  );

  const pending = (requirements ?? []).filter((r) => {
    const visit = r.visits!;
    const patient = visit.patients!;
    const viaVisit = fulfilledByVisit.has(`${visit.id}:${r.document_type_id}`);
    const viaPatient = fulfilledByPatient.has(`${patient.id}:${r.document_type_id}`);
    return !viaVisit && !viaPatient;
  });

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-16 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight">Pending documents</h1>
      <p className="mt-2 max-w-xl text-sm text-zinc-600 dark:text-zinc-400">
        Visits missing a document their visit type requires. Nothing here means every required
        document has been captured.
      </p>

      {pending.length > 0 ? (
        <div className="-mx-4 mt-8 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <table className="w-full max-w-3xl min-w-[520px] text-left text-sm sm:min-w-0">
            <thead>
              <tr className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                <th className="py-2 font-medium">Patient</th>
                <th className="py-2 font-medium">Visit</th>
                <th className="py-2 font-medium">Date</th>
                <th className="py-2 font-medium">Missing document</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((r) => {
                const visit = r.visits!;
                const patient = visit.patients!;
                return (
                  <tr
                    key={r.id}
                    className="border-b border-zinc-100 last:border-0 dark:border-zinc-900"
                  >
                    <td className="py-2">
                      <Link href={`/dashboard/patients/${patient.id}`} className="hover:underline">
                        {patient.name} ({patient.patient_code})
                      </Link>
                    </td>
                    <td className="py-2">
                      <Link href={`/dashboard/visits/${visit.id}`} className="hover:underline">
                        #{visit.visit_number}
                      </Link>
                    </td>
                    <td className="py-2 text-zinc-600 dark:text-zinc-400">{visit.visit_date}</td>
                    <td className="py-2 text-amber-700 dark:text-amber-400">
                      {r.document_type_name}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-8 text-sm text-zinc-500 dark:text-zinc-400">
          Nothing pending — every required document has been captured.
        </p>
      )}
    </main>
  );
}
