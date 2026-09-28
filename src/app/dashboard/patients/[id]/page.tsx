import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { derivePaymentStatus, sumPayments } from "@/lib/visits/payment-status";
import { DocumentUploadPanel } from "@/components/documents/document-upload-panel";
import { DocumentList } from "@/components/documents/document-list";
import { BackLink } from "@/components/back-link";

export const metadata: Metadata = { title: "Patient — ClinicOS" };

function formatDob(dob: string | null, approximateAgeYears: number | null): string {
  if (dob) {
    const age = Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 60 * 60 * 1000));
    return `${dob} (age ${age})`;
  }
  if (approximateAgeYears !== null) {
    return `Unknown — approximately ${approximateAgeYears} years old`;
  }
  return "Unknown";
}

export default async function PatientProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: patient } = await supabase
    .from("patients")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!patient) {
    notFound();
  }

  const [{ data: visits }, { data: patientDocumentTypes }, { data: documents }] = await Promise.all(
    [
      supabase
        .from("visits")
        .select(
          "id, visit_number, visit_date, status, fee_amount, visit_types(name), visit_payments(amount)",
        )
        .eq("patient_id", patient.id)
        .order("visit_date", { ascending: false })
        .order("visit_number", { ascending: false }),
      supabase
        .from("document_types")
        .select("id, name, requires_signature")
        .eq("scope", "PATIENT")
        .eq("active", true),
      supabase
        .from("documents")
        .select("id, file_name, file_type, created_at, document_types(name, sensitive)")
        .eq("patient_id", patient.id)
        .is("visit_id", null)
        .is("deleted_at", null)
        .order("created_at", { ascending: false }),
    ],
  );

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-16 sm:px-6">
      <BackLink href="/dashboard/patients" label="Patients" />
      <div className="mt-3 flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-sm text-zinc-500 dark:text-zinc-400">
            {patient.patient_code}
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">{patient.name}</h1>
        </div>
        <Link
          href={`/dashboard/patients/${patient.id}/edit`}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          Edit
        </Link>
      </div>

      <dl className="mt-8 grid max-w-lg grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
        <dt className="text-zinc-500 dark:text-zinc-400">Mobile</dt>
        <dd>{patient.mobile ?? "—"}</dd>

        <dt className="text-zinc-500 dark:text-zinc-400">Date of birth</dt>
        <dd>{formatDob(patient.dob, patient.approximate_age_years)}</dd>

        <dt className="text-zinc-500 dark:text-zinc-400">Gender</dt>
        <dd>{patient.gender ?? "—"}</dd>

        <dt className="text-zinc-500 dark:text-zinc-400">Guardian</dt>
        <dd>{patient.guardian_name ?? "—"}</dd>

        <dt className="text-zinc-500 dark:text-zinc-400">Address</dt>
        <dd>{patient.address ?? "—"}</dd>
      </dl>

      <div className="mt-12 rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Visits</h2>
          <Link
            href={`/dashboard/patients/${patient.id}/visits/new`}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            New visit
          </Link>
        </div>

        {visits && visits.length > 0 ? (
          <>
            <div className="mt-4 flex flex-col gap-3 sm:hidden">
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
                      <p className="font-medium">#{v.visit_number}</p>
                      <p className="text-sm text-zinc-500 dark:text-zinc-400">{v.visit_date}</p>
                    </div>
                    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
                      <dt className="text-zinc-400 dark:text-zinc-500">Type</dt>
                      <dd>{v.visit_types!.name}</dd>
                      <dt className="text-zinc-400 dark:text-zinc-500">Payment</dt>
                      <dd>{status}</dd>
                    </dl>
                  </Link>
                );
              })}
            </div>

            <table className="mt-4 hidden w-full text-left text-sm sm:table">
              <thead>
                <tr className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                  <th className="py-2 font-medium">Date</th>
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
                        <Link href={`/dashboard/visits/${v.id}`} className="hover:underline">
                          #{v.visit_number}
                        </Link>
                      </td>
                      <td className="py-2">{v.visit_types!.name}</td>
                      <td className="py-2 text-zinc-600 dark:text-zinc-400">{status}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        ) : (
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">No visits yet.</p>
        )}
      </div>

      <div className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-lg font-semibold">Documents</h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Patient-level documents (e.g. ID proof) — captured once, reused on every visit.
        </p>

        <div className="mt-4">
          <DocumentUploadPanel
            patientId={patient.id}
            revalidate={`/dashboard/patients/${patient.id}`}
            documentTypes={patientDocumentTypes ?? []}
          />
        </div>

        <div className="mt-6">
          <DocumentList documents={documents ?? []} />
        </div>
      </div>
    </main>
  );
}
