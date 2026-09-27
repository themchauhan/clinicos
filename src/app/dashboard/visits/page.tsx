import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { derivePaymentStatus, sumPayments } from "@/lib/visits/payment-status";
import { BackLink } from "@/components/back-link";

export const metadata: Metadata = { title: "Visits — ClinicOS" };

const STATUS_LABELS = { UNPAID: "Unpaid", PARTIAL: "Partially paid", PAID: "Paid" } as const;

export default async function VisitsPage() {
  const supabase = await createClient();
  const { data: visits } = await supabase
    .from("visits")
    .select(
      "id, visit_number, visit_date, fee_amount, visit_types(name), patients(id, name, patient_code), visit_payments(amount)",
    )
    .order("visit_date", { ascending: false })
    .order("visit_number", { ascending: false })
    .limit(50);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-16 sm:px-6">
      <BackLink href="/dashboard" label="Dashboard" />
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">Visits</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Most recent visits across all patients. Open a patient&rsquo;s own profile for their full
        visit history.
      </p>

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
                      </p>
                      <p className="shrink-0 text-sm text-zinc-500 dark:text-zinc-400">
                        {v.visit_date}
                      </p>
                    </div>
                    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
                      <dt className="text-zinc-400 dark:text-zinc-500">Visit</dt>
                      <dd>#{v.visit_number}</dd>
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
                  <th className="py-2 font-medium">Visit</th>
                  <th className="py-2 font-medium">Type</th>
                  <th className="py-2 font-medium">Payment</th>
                </tr>
              </thead>
              <tbody>
                {visits.map((v) => {
                  const amountPaid = sumPayments(v.visit_payments);
                  const status = derivePaymentStatus(Number(v.fee_amount), amountPaid);
                  return (
                    <tr
                      key={v.id}
                      className="border-b border-zinc-100 last:border-0 dark:border-zinc-900"
                    >
                      <td className="py-2 text-zinc-600 dark:text-zinc-400">{v.visit_date}</td>
                      <td className="py-2">
                        <Link
                          href={`/dashboard/patients/${v.patients!.id}`}
                          className="hover:underline"
                        >
                          {v.patients!.name} ({v.patients!.patient_code})
                        </Link>
                      </td>
                      <td className="py-2">
                        <Link href={`/dashboard/visits/${v.id}`} className="hover:underline">
                          #{v.visit_number}
                        </Link>
                      </td>
                      <td className="py-2">{v.visit_types!.name}</td>
                      <td className="py-2 text-zinc-600 dark:text-zinc-400">
                        {STATUS_LABELS[status]}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        ) : (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">No visits recorded yet.</p>
        )}
      </div>
    </main>
  );
}
