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

  const [{ data: requirements }, { data: documents }] = await Promise.all([
    supabase
      .from("visit_document_requirements")
      .select(
        "id, document_type_id, document_type_name, required, visits(id, token_number, visit_date, patients(id, name, patient_code))",
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

  // Fulfillment depends on a join across two separately-fetched tables,
  // so pagination happens here in-memory (over the already-filtered
  // list) rather than as a .range() on the initial query.
  const pageStart = (page - 1) * PAGE_SIZE;
  const pendingPage = pending.slice(pageStart, pageStart + PAGE_SIZE);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-16 sm:px-6">
      <BackLink href="/dashboard" label="Dashboard" />
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">Pending documents</h1>
      <p className="mt-2 max-w-xl text-sm text-zinc-600 dark:text-zinc-400">
        Visits missing a document their visit type requires. Nothing here means every required
        document has been captured.
      </p>

      {pending.length > 0 ? (
        <>
          <div className="mt-8 flex flex-col gap-3 sm:hidden">
            {pendingPage.map((r) => {
              const visit = r.visits!;
              const patient = visit.patients!;
              return (
                <div
                  key={r.id}
                  className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
                >
                  <Link
                    href={`/dashboard/patients/${patient.id}`}
                    className="font-medium hover:underline"
                  >
                    {patient.name} ({patient.patient_code})
                  </Link>
                  <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
                    <dt className="text-zinc-400 dark:text-zinc-500">Token</dt>
                    <dd>
                      <Link href={`/dashboard/visits/${visit.id}`} className="hover:underline">
                        #{visit.token_number}
                      </Link>
                    </dd>
                    <dt className="text-zinc-400 dark:text-zinc-500">Date</dt>
                    <dd>{visit.visit_date}</dd>
                    <dt className="text-zinc-400 dark:text-zinc-500">Missing</dt>
                    <dd className="text-amber-700 dark:text-amber-400">{r.document_type_name}</dd>
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
              {pendingPage.map((r) => {
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
                        #{visit.token_number}
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

          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            totalCount={pending.length}
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
