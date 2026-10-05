import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { BackLink } from "@/components/back-link";
import { Pagination } from "@/components/pagination";

export const metadata: Metadata = { title: "Pending documents — ClinicOS" };

const PAGE_SIZE = 50;

/**
 * Every visit missing a required document shows up here — the safety
 * net the brief calls out explicitly: "so nothing is silently lost,
 * this is the safety net that paper alone never had."
 */
export default async function PendingDocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);

  const supabase = await createClient();

  // Missing documents and unsigned required forms in one list, newest
  // visit first, filtered and paginated in the database.
  const { data: pendingPage, count: pendingCount } = await supabase
    .from("pending_visit_requirements")
    .select("*", { count: "exact" })
    .order("visit_date", { ascending: false })
    .order("token_number", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  const rows = pendingPage ?? [];
  const totalPending = pendingCount ?? 0;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-16 sm:px-6">
      <BackLink href="/dashboard" label="Dashboard" />
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">Pending documents</h1>
      <p className="mt-2 max-w-xl text-sm text-zinc-600 dark:text-zinc-400">
        Visits missing a document their visit type requires. Nothing here means every required
        document has been captured.
      </p>

      {totalPending > 0 ? (
        <>
          <div className="mt-8 flex flex-col gap-3 sm:hidden">
            {rows.map((r) => {
              return (
                <div
                  key={r.id}
                  className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
                >
                  <Link
                    href={`/dashboard/patients/${r.patient_id}`}
                    className="font-medium hover:underline"
                  >
                    {r.patient_name} ({r.patient_code})
                  </Link>
                  <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
                    <dt className="text-zinc-400 dark:text-zinc-500">Token</dt>
                    <dd>
                      <Link href={`/dashboard/visits/${r.visit_id}`} className="hover:underline">
                        #{r.token_number}
                      </Link>
                    </dd>
                    <dt className="text-zinc-400 dark:text-zinc-500">Date</dt>
                    <dd>{r.visit_date}</dd>
                    <dt className="text-zinc-400 dark:text-zinc-500">Missing</dt>
                    <dd className="text-amber-700 dark:text-amber-400">{r.missing_name}</dd>
                  </dl>
                </div>
              );
            })}
          </div>

          <table className="mt-8 hidden w-full max-w-3xl text-left text-sm sm:table">
            <thead>
              <tr className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                <th className="py-2 font-medium">Patient</th>
                <th className="py-2 font-medium">Token</th>
                <th className="py-2 font-medium">Date</th>
                <th className="py-2 font-medium">Missing document</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                return (
                  <tr
                    key={r.id}
                    className="border-b border-zinc-100 last:border-0 dark:border-zinc-900"
                  >
                    <td className="py-2">
                      <Link
                        href={`/dashboard/patients/${r.patient_id}`}
                        className="hover:underline"
                      >
                        {r.patient_name} ({r.patient_code})
                      </Link>
                    </td>
                    <td className="py-2">
                      <Link href={`/dashboard/visits/${r.visit_id}`} className="hover:underline">
                        #{r.token_number}
                      </Link>
                    </td>
                    <td className="py-2 text-zinc-600 dark:text-zinc-400">{r.visit_date}</td>
                    <td className="py-2 text-amber-700 dark:text-amber-400">{r.missing_name}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            totalCount={totalPending}
            basePath="/dashboard/documents"
          />
        </>
      ) : (
        <p className="mt-8 text-sm text-zinc-500 dark:text-zinc-400">
          Nothing pending — every required document has been captured.
        </p>
      )}
    </main>
  );
}
