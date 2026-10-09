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
import { FormFillPanel, type FormStatus } from "@/components/visits/form-fill-panel";
import { LmpForm } from "@/components/visits/lmp-form";
import { formatGestationalAge } from "@/lib/visits/gestational-age";
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
      "*, patients(id, name, patient_code, guardian_name, guardian_relation, address, mobile, dob, approximate_age_years, gender, living_sons, living_sons_ages, living_daughters, living_daughters_ages), visit_types(name, module), doctors(name, registration_no), visit_payments(id, amount, mode, note, reference_number, is_reversal, received_at)",
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
    { data: formTemplates },
    { data: hospitalRow },
    { data: hospitalFormProfile },
    { data: formRequirements },
    { data: patientDocumentTypeIds },
  ] = await Promise.all([
    supabase
      .from("visit_document_requirements")
      .select("id, document_type_id, document_type_name, required")
      .eq("visit_id", visit.id),
    supabase
      .from("document_types")
      .select("id, name, requires_signature, two_sided")
      .eq("scope", "VISIT")
      .eq("active", true),
    supabase
      .from("documents")
      .select(
        "id, file_name, file_type, created_at, document_type_id, form_template_id, document_types(name, sensitive), form_templates(name, sensitive)",
      )
      .eq("visit_id", visit.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    supabase.from("paired_devices").select("id, confirmed_at, last_seen_at").maybeSingle(),
    supabase
      .from("form_templates")
      .select(
        "id, name, description, form_template_fields(field_key, label, input_type, checklist_key, display_order)",
      )
      .eq("active", true)
      .order("name"),
    supabase.from("hospitals").select("name, address").maybeSingle(),
    supabase
      .from("hospital_form_profile")
      .select("centre_name, centre_address, registration_no")
      .maybeSingle(),
    supabase
      .from("visit_form_requirements")
      .select("form_template_id, required")
      .eq("visit_id", visit.id),
    supabase
      .from("documents")
      .select("document_type_id, document_types(scope)")
      .eq("patient_id", visit.patients!.id)
      .is("deleted_at", null),
  ]);
  const pairedDevice = pairedDeviceRow
    ? {
        id: pairedDeviceRow.id,
        confirmedAt: pairedDeviceRow.confirmed_at,
        lastSeenAt: pairedDeviceRow.last_seen_at,
      }
    : null;

  // A requirement is fulfilled by a document of that type attached to
  // THIS visit, or -- only for PATIENT-scope types like ID Proof,
  // captured once and reused -- by any such document on the patient.
  // Same rule as the pending_visit_requirements view behind the
  // dashboard and Pending documents list. (A USG report from an earlier
  // visit must not satisfy this one.)
  const fulfilledTypeIds = new Set([
    ...(documents ?? []).map((d) => d.document_type_id),
    ...(patientDocumentTypeIds ?? [])
      .filter((d) => d.document_types?.scope === "PATIENT")
      .map((d) => d.document_type_id),
  ]);

  const { data: pcPndtTypes } = await supabase
    .from("document_types")
    .select("version, effective_from")
    .in(
      "id",
      (requirements ?? []).map((r) => r.document_type_id),
    )
    .eq("pc_pndt_form", true);

  // Forms: a requirement is met by a signed copy attached to THIS visit
  // (never carried over from an earlier visit). Gender only drives a
  // soft hint -- it never makes a form required or blocks anything.
  const signedTemplateIds = new Set(
    (documents ?? []).map((d) => d.form_template_id).filter((v): v is string => v !== null),
  );
  const requirementByTemplate = new Map(
    (formRequirements ?? []).map((r) => [r.form_template_id, r.required]),
  );
  const statusByTemplate: Record<string, FormStatus> = Object.fromEntries(
    (formTemplates ?? []).map((t) => [
      t.id,
      {
        required: requirementByTemplate.has(t.id) ? requirementByTemplate.get(t.id)! : null,
        signed: signedTemplateIds.has(t.id),
      },
    ]),
  );
  const unsignedForms = (formTemplates ?? []).filter((t) => !statusByTemplate[t.id]!.signed);
  const formHint =
    visit.patients!.gender === "FEMALE" &&
    visit.visit_types!.module === "USG" &&
    unsignedForms.length > 0
      ? "Female patient on a USG visit — PC-PNDT forms (e.g. Form G) are usually needed before the scan. Check the forms below."
      : null;

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
            Token {visit.token_number} — {visit.visit_types!.name}
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

        {visit.visit_types!.module === "USG" ? (
          <>
            <dt className="pt-1 text-zinc-500 dark:text-zinc-400">LMP</dt>
            <dd className="flex flex-col gap-1">
              <LmpForm visitId={visit.id} lmpDate={visit.lmp_date} />
              {visit.lmp_date ? (
                <span className="text-zinc-600 dark:text-zinc-400">
                  {formatGestationalAge(visit.lmp_date, visit.visit_date)} of pregnancy
                </span>
              ) : null}
            </dd>
          </>
        ) : null}

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

        {formTemplates && formTemplates.length > 0 ? (
          <div className="mt-4">
            <h3 className="mb-2 text-sm font-semibold">Forms for this visit</h3>
            <FormFillPanel
              templates={formTemplates.map((t) => ({
                id: t.id,
                name: t.name,
                description: t.description,
              }))}
              fieldsByTemplate={Object.fromEntries(
                formTemplates.map((t) => [
                  t.id,
                  (t.form_template_fields ?? []).map((f) => ({
                    fieldKey: f.field_key,
                    label: f.label,
                    inputType: f.input_type,
                    checklistKey: f.checklist_key,
                    displayOrder: f.display_order,
                  })),
                ]),
              )}
              patientId={visit.patients!.id}
              visitId={visit.id}
              patient={{
                name: visit.patients!.name,
                guardianName: visit.patients!.guardian_name,
                guardianRelation: visit.patients!.guardian_relation,
                address: visit.patients!.address,
                mobile: visit.patients!.mobile,
                dob: visit.patients!.dob,
                approximateAgeYears: visit.patients!.approximate_age_years,
                gender: visit.patients!.gender,
                livingSons: visit.patients!.living_sons,
                livingSonsAges: visit.patients!.living_sons_ages,
                livingDaughters: visit.patients!.living_daughters,
                livingDaughtersAges: visit.patients!.living_daughters_ages,
              }}
              visit={{
                date: visit.visit_date,
                typeName: visit.visit_types!.name,
                module: visit.visit_types!.module,
                referredByName: visit.referred_by_name,
                referredByHospital: visit.referred_by_hospital,
                lmpDate: visit.lmp_date,
              }}
              hospital={{
                name: hospitalRow?.name ?? "—",
                address: hospitalRow?.address ?? null,
                centreName: hospitalFormProfile?.centre_name ?? null,
                centreAddress: hospitalFormProfile?.centre_address ?? null,
                registrationNo: hospitalFormProfile?.registration_no ?? null,
              }}
              doctor={{
                name: visit.doctors?.name ?? null,
                registrationNo: visit.doctors?.registration_no ?? null,
              }}
              revalidate={`/dashboard/visits/${visit.id}`}
              pairedDevice={pairedDevice}
              statusByTemplate={statusByTemplate}
              hint={formHint}
            />
          </div>
        ) : null}

        <div className="mt-6">
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
