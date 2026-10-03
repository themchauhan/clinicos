import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { derivePaymentStatus, sumPayments } from "@/lib/visits/payment-status";
import { BackLink } from "@/components/back-link";
import { Pagination } from "@/components/pagination";
import { LinkPendingSpinner } from "@/components/link-pending-spinner";
import { VisitRow } from "@/components/visits/visit-row";

export const metadata: Metadata = { title: "Visits — ClinicOS" };

const STATUS_LABELS = { UNPAID: "Unpaid", PARTIAL: "Partially paid", PAID: "Paid" } as const;
const PAGE_SIZE = 50;
const VISIT_COLUMNS =
  "id, token_number, visit_date, fee_amount, visit_types(name), patients(id, name, patient_code), visit_payments(amount)";

interface VisitRow {
  id: string;
  token_number: number;
  visit_date: string;
  fee_amount: number;
  visit_types: { name: string } | null;
  patients: { id: string; name: string; patient_code: string } | null;
  visit_payments: { amount: number }[];
}

export default async function VisitsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { q, page: pageParam } = await searchParams;
  const query = q?.trim() ?? "";
  const page = Math.max(1, Number(pageParam) || 1);

  const supabase = await createClient();
  // Search results aren't paginated -- search_visits already caps
  // itself at 50 best matches server-side (see its own migration), so
  // a search narrow enough to matter never needs a second page.
  let visits: VisitRow[] | null;
  let totalCount: number | null = null;
  if (query) {
    // search_visits returns setof visits (bare columns only, no
    // embeds) -- fetch the matching ids in their already-ranked
    // order, then hydrate with a normal query for the joined
    // visit_types/patients/visit_payments fields, and put them back in
    // that same order (.in() doesn't preserve it).
    const { data: matches } = await supabase.rpc("search_visits", { p_query: query });
    const orderedIds = (matches ?? []).map((v) => v.id);
    const { data: hydrated } = orderedIds.length
      ? await supabase.from("visits").select(VISIT_COLUMNS).in("id", orderedIds)
      : { data: [] as VisitRow[] };
    const byId = new Map((hydrated ?? []).map((v) => [v.id, v]));
    visits = orderedIds.map((id) => byId.get(id)).filter((v): v is VisitRow => v !== undefined);
  } else {
    const result = await supabase
      .from("visits")
      .select(VISIT_COLUMNS, { count: "exact" })
      .order("visit_date", { ascending: false })
      .order("token_number", { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
    visits = result.data;
    totalCount = result.count;
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-16 sm:px-6">
      <BackLink href="/dashboard" label="Dashboard" />
      <div className="mt-3 border-l-4 border-amber-500 pl-4">
        <h1 className="text-3xl font-semibold tracking-tight text-amber-800 dark:text-amber-400">
          Visits
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Most recent visits across all patients. Open a patient&rsquo;s own profile for their full
          visit history.
        </p>
      </div>

      <form method="get" className="mt-6 flex max-w-md gap-2">
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Search by patient name, mobile, patient code, or UPI reference"
          aria-label="Search visits"
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
        {visits && visits.length > 0 ? (
          <>
            <div className="flex flex-col gap-3 sm:hidden">
              {visits.map((v) => {
                const amountPaid = sumPayments(v.visit_payments);
                const status = derivePaymentStatus(Number(v.fee_amount), amountPaid);
                return (
                  <Link
                    key={v.id}
                    href={`/dashboard/visits/${v.id}`}
                    className="block rounded-lg border border-zinc-200 p-4 transition-colors hover:bg-slate-50 dark:border-zinc-800"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="font-medium">
                        {v.patients!.name} ({v.patients!.patient_code})
                        <LinkPendingSpinner />
                      </p>
                      <p className="shrink-0 text-sm text-zinc-500 dark:text-zinc-400">
                        {v.visit_date}
                      </p>
                    </div>
                    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
                      <dt className="text-zinc-400 dark:text-zinc-500">Token</dt>
                      <dd>#{v.token_number}</dd>
                      <dt className="text-zinc-400 dark:text-zinc-500">Type</dt>
                      <dd>{v.visit_types!.name}</dd>
                      <dt className="text-zinc-400 dark:text-zinc-500">Payment</dt>
                      <dd>{STATUS_LABELS[status]}</dd>
                    </dl>
                  </Link>
                );
              })}
            </div>

            <table className="hidden w-full text-left text-sm sm:table">
              <thead>
                <tr className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                  <th className="py-2 font-medium">Date</th>
                  <th className="py-2 font-medium">Patient</th>
                  <th className="py-2 font-medium">Token</th>
                  <th className="py-2 font-medium">Type</th>
                  <th className="py-2 font-medium">Payment</th>
                </tr>
              </thead>
              <tbody>
                {visits.map((v) => {
                  const amountPaid = sumPayments(v.visit_payments);
                  const status = derivePaymentStatus(Number(v.fee_amount), amountPaid);
                  return (
                    <VisitRow
                      key={v.id}
                      visit={{
                        id: v.id,
                        visitDate: v.visit_date,
                        tokenNumber: v.token_number,
                        visitTypeName: v.visit_types!.name,
                        paymentLabel: STATUS_LABELS[status],
                        patient: {
                          id: v.patients!.id,
                          name: v.patients!.name,
                          patientCode: v.patients!.patient_code,
                        },
                      }}
                    />
                  );
                })}
              </tbody>
            </table>

            {!query && totalCount !== null ? (
              <Pagination
                page={page}
                pageSize={PAGE_SIZE}
                totalCount={totalCount}
                basePath="/dashboard/visits"
              />
            ) : null}
          </>
        ) : (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {query ? `No visits match "${query}".` : "No visits recorded yet."}
          </p>
        )}
      </div>
    </main>
  );
}
