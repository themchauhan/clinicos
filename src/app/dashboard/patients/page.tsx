import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PatientRow, PatientCard, type PatientRowData } from "@/components/patients/patient-row";
import { todayInAppTimezone } from "@/lib/visits/today";
import { BackLink } from "@/components/back-link";
import { Pagination } from "@/components/pagination";
import { SimplePager } from "@/components/simple-pager";

export const metadata: Metadata = { title: "Patients — ClinicOS" };

const PAGE_SIZE = 50;

export default async function PatientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; when?: string }>;
}) {
  const { q, page: pageParam, when: whenParam } = await searchParams;
  const when: "today" | "all" = whenParam === "all" ? "all" : "today";
  const query = q?.trim() ?? "";
  const page = Math.max(1, Number(pageParam) || 1);

  const supabase = await createClient();

  // "Today" = patients registered today or with a visit today (India
  // time, same day boundary as the visits queue). "All" is the whole
  // register, newest first, shown on demand. Search ignores the tabs
  // and always looks across everyone.
  const todayDate = todayInAppTimezone();
  const todayStart = new Date(`${todayDate}T00:00:00+05:30`).toISOString();
  const dayArgs = { p_date: todayDate, p_day_start: todayStart };

  // Search results aren't paginated -- search_patients already caps
  // itself at 50 best matches server-side (see its own migration), so
  // a search narrow enough to matter never needs a second page.
  // Today's list is small and bounded, so it gets an exact count and
  // numbered pages. "All patients" is the whole register: an exact
  // count(*) there is a full scan on every view, so it fetches one extra
  // row instead and only learns whether a next page exists.
  const listQuery = async (): Promise<{
    data: PatientRowData[] | null;
    count: number | null;
    hasNext: boolean;
  }> => {
    if (query) {
      const { data } = await supabase.rpc("search_patients", { p_query: query });
      return { data, count: null, hasNext: false };
    }
    const from = (page - 1) * PAGE_SIZE;
    if (when === "today") {
      const result = await supabase
        .rpc("patients_for_day", dayArgs, { count: "exact" })
        .order("created_at", { ascending: false })
        .range(from, from + PAGE_SIZE - 1);
      return { data: result.data, count: result.count, hasNext: false };
    }
    const result = await supabase
      .from("patients")
      .select("*")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE);
    const rows = result.data ?? [];
    return { data: rows.slice(0, PAGE_SIZE), count: null, hasNext: rows.length > PAGE_SIZE };
  };

  // Independent queries, so run them together rather than one after
  // another (each is a database round trip).
  const [{ data: allCount }, { count: todayCount }, list] = await Promise.all([
    // O(1): read from the per-hospital code counter, not count(*).
    supabase.rpc("patient_total"),
    supabase.rpc("patients_for_day", dayArgs, { count: "exact", head: true }),
    listQuery(),
  ]);
  const patients = list.data;
  const totalCount = list.count;

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

      <nav aria-label="Patient list" className="mt-6 flex gap-2">
        {(
          [
            { key: "today", label: "Today", count: todayCount ?? 0 },
            { key: "all", label: "All patients", count: Number(allCount ?? 0) },
          ] as const
        ).map((tab) => {
          const active = !query && when === tab.key;
          return (
            <Link
              key={tab.key}
              href={`/dashboard/patients?when=${tab.key}`}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "rounded-md bg-teal-600 px-4 py-1.5 text-sm font-medium text-white"
                  : "rounded-md border border-zinc-300 px-4 py-1.5 text-sm transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
              }
            >
              {tab.label}{" "}
              <span className={active ? "text-teal-100" : "text-zinc-400"}>{tab.count}</span>
            </Link>
          );
        })}
      </nav>

      <form method="get" className="mt-4 flex max-w-md gap-2">
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Search all patients by name, mobile, or code"
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
                extraParams={{ when }}
              />
            ) : null}
            {!query && totalCount === null ? (
              <SimplePager
                page={page}
                pageSize={PAGE_SIZE}
                shown={patients.length}
                hasNext={list.hasNext}
                basePath="/dashboard/patients"
                extraParams={{ when }}
              />
            ) : null}
          </>
        ) : (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {query
              ? `No patients match "${query}".`
              : when === "today"
                ? 'No patients registered or seen today. Use "All patients" or search to find someone.'
                : "No patients registered yet."}
          </p>
        )}
      </div>
    </main>
  );
}
