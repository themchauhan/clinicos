import type { Metadata } from "next";
import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/auth/session";
import { derivePaymentStatus, sumPayments } from "@/lib/visits/payment-status";
import { PaymentForm } from "@/components/visits/payment-form";
import { ReversalForm } from "@/components/visits/reversal-form";
import { DocumentUploadPanel } from "@/components/documents/document-upload-panel";
import { DocumentList } from "@/components/documents/document-list";
import { StatusTransitionButtons } from "@/components/visits/status-transition-buttons";
import { PrintSlipButton } from "@/components/visits/print-slip-button";
import { BackLink } from "@/components/back-link";

export const metadata: Metadata = { title: "Visit — ClinicOS" };

const STATUS_LABELS = { UNPAID: "Unpaid", PARTIAL: "Partially paid", PAID: "Paid" } as const;

export default async function VisitDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const profile = await getSessionProfile();

  const { data: visit } = await supabase
    .from("visits")
    .select(
      "*, patients(id, name, patient_code), visit_types(name), doctors(name), visit_payments(id, amount, mode, note, reference_number, is_reversal, received_at)",
    )
    .eq("id", id)
    .maybeSingle();

  if (!visit) {
    notFound();
  }

  const amountPaid = sumPayments(visit.visit_payments);
  const balanceDue = Math.max(0, Number(visit.fee_amount) - amountPaid);
  const status = derivePaymentStatus(Number(visit.fee_amount), amountPaid);

  const [
    { data: requirements },
    { data: visitDocumentTypes },
    { data: documents },
    { data: pairedDeviceRow },
  ] = await Promise.all([
    supabase
      .from("visit_document_requirements")
      .select("id, document_type_id, document_type_name, required")
      .eq("visit_id", visit.id),
    supabase
      .from("document_types")
      .select("id, name, requires_signature")
      .eq("scope", "VISIT")
      .eq("active", true),
    supabase
      .from("documents")
      .select(
        "id, file_name, file_type, created_at, document_type_id, document_types(name, sensitive)",
      )
      .eq("visit_id", visit.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    supabase.from("paired_devices").select("id, confirmed_at, last_seen_at").maybeSingle(),
  ]);
  const pairedDevice = pairedDeviceRow
    ? {
        id: pairedDeviceRow.id,
        confirmedAt: pairedDeviceRow.confirmed_at,
        lastSeenAt: pairedDeviceRow.last_seen_at,
      }
    : null;

  // A requirement is fulfilled by any document of that type attached
  // to this visit (VISIT-scope docs) OR to this patient at all
  // (PATIENT-scope docs like ID Proof, captured once and reused).
  const { data: patientDocumentTypeIds } = await supabase
    .from("documents")
    .select("document_type_id")
    .eq("patient_id", visit.patients!.id)
    .is("deleted_at", null);
  const fulfilledTypeIds = new Set([
    ...(documents ?? []).map((d) => d.document_type_id),
    ...(patientDocumentTypeIds ?? []).map((d) => d.document_type_id),
  ]);

  const { data: pcPndtTypes } = await supabase
    .from("document_types")
    .select("version, effective_from")
    .in(
      "id",
      (requirements ?? []).map((r) => r.document_type_id),
    )
    .eq("pc_pndt_form", true);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-16 sm:px-6">
      <BackLink href="/dashboard/visits" label="Visits" />
      <div className="mt-3 flex items-start justify-between gap-4 border-l-4 border-amber-500 pl-4">
        <div>
          <span className="inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold tracking-wide text-amber-800 uppercase dark:bg-amber-950 dark:text-amber-300">
            Visit
          </span>
          <p className="mt-1.5 text-sm font-medium text-zinc-500 dark:text-zinc-400">
            <Link href={`/dashboard/patients/${visit.patients!.id}`} className="hover:underline">
              {visit.patients!.name} ({visit.patients!.patient_code})
            </Link>
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-amber-800 dark:text-amber-400">
            Visit #{visit.visit_number} — {visit.visit_types!.name}
          </h1>
        </div>
        <PrintSlipButton visitId={visit.id} />
      </div>

      <dl className="mt-8 grid max-w-lg grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
        <dt className="text-zinc-500 dark:text-zinc-400">Date</dt>
        <dd>{visit.visit_date}</dd>

        <dt className="text-zinc-500 dark:text-zinc-400">Doctor</dt>
        <dd>{visit.doctors?.name ?? "—"}</dd>

        <dt className="text-zinc-500 dark:text-zinc-400">Referred by</dt>
        <dd>{visit.referred_by_name ?? "—"}</dd>

        <dt className="text-zinc-500 dark:text-zinc-400">Referring hospital</dt>
        <dd>{visit.referred_by_hospital ?? "—"}</dd>

        <dt className="text-zinc-500 dark:text-zinc-400">Status</dt>
        <dd>
          <StatusTransitionButtons visitId={visit.id} status={visit.status} />
        </dd>

        <dt className="text-zinc-500 dark:text-zinc-400">Follow-up</dt>
        <dd>{visit.follow_up_date ?? "—"}</dd>

        <dt className="text-zinc-500 dark:text-zinc-400">Notes</dt>
        <dd>{visit.notes ?? "—"}</dd>

        {pcPndtTypes && pcPndtTypes.length > 0
          ? pcPndtTypes.map((pt, i) => (
              <Fragment key={i}>
                <dt className="text-zinc-500 dark:text-zinc-400">PC-PNDT declaration</dt>
                <dd>
                  v{pt.version}, effective {pt.effective_from}
                </dd>
              </Fragment>
            ))
          : null}
      </dl>

      <div className="mt-12 rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex items-baseline gap-3">
          <h2 className="text-lg font-semibold">Payment</h2>
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            {STATUS_LABELS[status]} — ₹{amountPaid.toFixed(2)} of ₹
            {Number(visit.fee_amount).toFixed(2)}
          </span>
        </div>

        {visit.visit_payments.length > 0 ? (
          <>
            <div className="mt-4 flex flex-col gap-3 sm:hidden">
              {visit.visit_payments.map((p) => (
                <div
                  key={p.id}
                  className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <p
                      className={
                        p.is_reversal ? "font-medium text-red-600 dark:text-red-400" : "font-medium"
                      }
                    >
                      ₹{Number(p.amount).toFixed(2)}
                    </p>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                      {new Date(p.received_at).toLocaleString()}
                    </p>
                  </div>
                  <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
                    <dt className="text-zinc-400 dark:text-zinc-500">Mode</dt>
                    <dd>{p.mode}</dd>
                    <dt className="text-zinc-400 dark:text-zinc-500">Reference</dt>
                    <dd>{p.reference_number ?? "—"}</dd>
                    <dt className="text-zinc-400 dark:text-zinc-500">Note</dt>
                    <dd>{p.note ?? "—"}</dd>
                  </dl>
                </div>
              ))}
            </div>

            <table className="mt-4 hidden w-full max-w-lg text-left text-sm sm:table">
              <thead>
                <tr className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                  <th className="py-2 font-medium">When</th>
                  <th className="py-2 font-medium">Amount</th>
                  <th className="py-2 font-medium">Mode</th>
                  <th className="py-2 font-medium">Reference</th>
                  <th className="py-2 font-medium">Note</th>
                </tr>
              </thead>
              <tbody>
                {visit.visit_payments.map((p) => (
                  <tr
                    key={p.id}
                    className="border-b border-zinc-100 last:border-0 dark:border-zinc-900"
                  >
                    <td className="py-2 text-zinc-600 dark:text-zinc-400">
                      {new Date(p.received_at).toLocaleString()}
                    </td>
                    <td className={p.is_reversal ? "py-2 text-red-600 dark:text-red-400" : "py-2"}>
                      ₹{Number(p.amount).toFixed(2)}
                    </td>
                    <td className="py-2">{p.mode}</td>
                    <td className="py-2 text-zinc-600 dark:text-zinc-400">
                      {p.reference_number ?? "—"}
                    </td>
                    <td className="py-2 text-zinc-600 dark:text-zinc-400">{p.note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : null}

        <div className="mt-6">
          <PaymentForm visitId={visit.id} balanceDue={balanceDue} />
        </div>

        {profile?.role === "HOSPITAL_ADMIN" ? (
          <div className="mt-6 border-t border-zinc-100 pt-6 dark:border-zinc-900">
            <p className="mb-3 text-sm font-medium text-zinc-500 dark:text-zinc-400">
              Correction (admin only)
            </p>
            <ReversalForm visitId={visit.id} />
          </div>
        ) : null}
      </div>

      <div className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-lg font-semibold">Documents</h2>

        {requirements && requirements.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-1.5 text-sm">
            {requirements.map((r) => {
              const fulfilled = fulfilledTypeIds.has(r.document_type_id);
              return (
                <li key={r.id} className="flex items-center gap-2">
                  <span
                    className={
                      fulfilled
                        ? "text-emerald-700 dark:text-emerald-400"
                        : "text-amber-700 dark:text-amber-400"
                    }
                  >
                    {fulfilled ? "✓" : "○"}
                  </span>
                  {r.document_type_name}
                  {!fulfilled && r.required ? (
                    <span className="text-xs text-amber-700 dark:text-amber-400">(pending)</span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}

        <div className="mt-4">
          <DocumentUploadPanel
            patientId={visit.patients!.id}
            visitId={visit.id}
            revalidate={`/dashboard/visits/${visit.id}`}
            documentTypes={visitDocumentTypes ?? []}
            pairedDevice={pairedDevice}
          />
        </div>

        <div className="mt-6">
          <DocumentList documents={documents ?? []} />
        </div>
      </div>
    </main>
  );
}
