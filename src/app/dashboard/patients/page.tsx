import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PatientRow } from "@/components/patients/patient-row";

export const metadata: Metadata = { title: "Patients — Hospital & USG Records" };

export default async function PatientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = q?.trim() ?? "";

  const supabase = await createClient();
  const { data: patients } = query
    ? await supabase.rpc("search_patients", { p_query: query })
    : await supabase
        .from("patients")
        .select("*")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(50);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-16 sm:px-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">Patients</h1>
        <Link
          href="/dashboard/patients/new"
          className="rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-700"
        >
          New patient
        </Link>
      </div>

      <form method="get" className="mt-6 flex max-w-md gap-2">
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Search by name, mobile, or patient code"
          aria-label="Search patients"
          className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600"
        />
        <button
          type="submit"
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          Search
        </button>
      </form>

      <div className="mt-8">
        {patients && patients.length > 0 ? (
          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <table className="w-full min-w-[480px] text-left text-sm sm:min-w-0">
              <thead>
                <tr className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                  <th className="py-2 font-medium">Code</th>
                  <th className="py-2 font-medium">Name</th>
                  <th className="py-2 font-medium">Mobile</th>
                  <th className="py-2 font-medium">Guardian</th>
                </tr>
              </thead>
              <tbody>
                {patients.map((patient) => (
                  <PatientRow key={patient.id} patient={patient} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {query ? `No patients match "${query}".` : "No patients registered yet."}
          </p>
        )}
      </div>
    </main>
  );
}
