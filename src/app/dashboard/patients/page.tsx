import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PatientRow, PatientCard, type PatientRowData } from "@/components/patients/patient-row";
import { BackLink } from "@/components/back-link";
import { Pagination } from "@/components/pagination";

export const metadata: Metadata = { title: "Patients — ClinicOS" };

const PAGE_SIZE = 50;

export default async function PatientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { q, page: pageParam } = await searchParams;
  const query = q?.trim() ?? "";
  const page = Math.max(1, Number(pageParam) || 1);

  const supabase = await createClient();
  // Search results aren't paginated -- search_patients already caps
  // itself at 50 best matches server-side (see its own migration), so
  // a search narrow enough to matter never needs a second page.
  let patients: PatientRowData[] | null;
  let totalCount: number | null = null;
  if (query) {
    ({ data: patients } = await supabase.rpc("search_patients", { p_query: query }));
  } else {
    const result = await supabase
      .from("patients")
      .select("*", { count: "exact" })
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
    patients = result.data;
    totalCount = result.count;
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-16 sm:px-6">
      <BackLink href="/dashboard" label="Dashboard" />
      <div className="mt-3 flex items-center justify-between gap-4 border-l-4 border-teal-500 pl-4">
        <h1 className="text-3xl font-semibold tracking-tight text-teal-800 dark:text-teal-400">
          Patients
        </h1>
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
          <>
            <div className="flex flex-col gap-3 sm:hidden">
              {patients.map((patient) => (
                <PatientCard key={patient.id} patient={patient} />
              ))}
            </div>

            <table className="hidden w-full text-left text-sm sm:table">
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

            {!query && totalCount !== null ? (
              <Pagination
                page={page}
                pageSize={PAGE_SIZE}
                totalCount={totalCount}
                basePath="/dashboard/patients"
              />
            ) : null}
          </>
        ) : (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {query ? `No patients match "${query}".` : "No patients registered yet."}
          </p>
        )}
      </div>
    </main>
  );
}
