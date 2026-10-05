import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth/session";
import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { BackLink } from "@/components/back-link";
import type { PaymentMode } from "@/types/database";
import { todayInAppTimezone } from "@/lib/visits/today";

export const metadata: Metadata = { title: "USG dashboard — ClinicOS" };

type Column = "waiting" | "documentsPending" | "inProgress" | "completed";

const COLUMN_LABELS: Record<Column, string> = {
  waiting: "Waiting",
  documentsPending: "Documents pending",
  inProgress: "In progress",
  completed: "Completed",
};

export default async function UsgDashboardPage() {
  // dashboard/layout.tsx already confirmed a signed-in, MFA-satisfied
  // tenant profile. Any hospital staff role can view this (it's an
  // operational worklist, not an admin-only settings page) — gated
  // instead on the hospital having the USG module enabled at all.
  const profile = await getSessionProfile();
  if (!profile) {
    redirect("/login?next=/dashboard/usg");
  }
  requireRole(profile, ["HOSPITAL_ADMIN", "RECEPTIONIST"]);

  const supabase = await createClient();
  const { data: usgModule } = await supabase
    .from("hospital_modules")
    .select("module")
    .eq("module", "USG")
    .maybeSingle();
  if (!usgModule) {
    redirect("/dashboard");
  }

  const today = todayInAppTimezone();

  const [{ data: visits }, { data: payments }] = await Promise.all([
    supabase
      .from("visits")
      .select(
        "id, token_number, status, patients(id, name, patient_code), visit_types!inner(name, module)",
      )
      .eq("visit_date", today)
      .eq("visit_types.module", "USG")
      .order("token_number"),
    supabase
      .from("visit_payments")
      .select("amount, mode, is_reversal, received_by, profiles(name)")
      .gte("received_at", `${today}T00:00:00`)
      .lt("received_at", `${today}T23:59:59.999`),
  ]);

  const visitIds = (visits ?? []).map((v) => v.id);
  const [{ data: requirements }, { data: allDocs }, { data: formRequirements }] = await Promise.all(
    [
      supabase
        .from("visit_document_requirements")
        .select("visit_id, document_type_id, required")
        .in("visit_id", visitIds)
        .eq("required", true),
      supabase
        .from("documents")
        .select("patient_id, visit_id, document_type_id, form_template_id")
        .is("deleted_at", null),
      supabase
        .from("visit_form_requirements")
        .select("visit_id, form_template_id")
        .in("visit_id", visitIds)
        .eq("required", true),
    ],
  );

  const signedFormsByVisit = new Set(
    (allDocs ?? [])
      .filter((d) => d.visit_id && d.form_template_id)
      .map((d) => `${d.visit_id}:${d.form_template_id}`),
  );

  const fulfilledByVisit = new Set(
    (allDocs ?? []).filter((d) => d.visit_id).map((d) => `${d.visit_id}:${d.document_type_id}`),
  );
  const fulfilledByPatient = new Set(
    (allDocs ?? []).map((d) => `${d.patient_id}:${d.document_type_id}`),
  );

  const columns: Record<Column, typeof visits> = {
    waiting: [],
    documentsPending: [],
    inProgress: [],
    completed: [],
  };

  for (const visit of visits ?? []) {
    if (visit.status === "COMPLETED") {
      columns.completed!.push(visit);
      continue;
    }
    if (visit.status === "IN_PROGRESS") {
      columns.inProgress!.push(visit);
      continue;
    }
    const patientId = visit.patients!.id;
    const missingDocument = (requirements ?? [])
      .filter((r) => r.visit_id === visit.id)
      .some(
        (r) =>
          !fulfilledByVisit.has(`${visit.id}:${r.document_type_id}`) &&
          !fulfilledByPatient.has(`${patientId}:${r.document_type_id}`),
      );
    const missingForm = (formRequirements ?? [])
      .filter((r) => r.visit_id === visit.id)
      .some((r) => !signedFormsByVisit.has(`${visit.id}:${r.form_template_id}`));
    const missingRequired = missingDocument || missingForm;
    if (missingRequired) {
      columns.documentsPending!.push(visit);
    } else {
      columns.waiting!.push(visit);
    }
  }

  const collectionByMode = new Map<PaymentMode, number>();
  const collectionByStaff = new Map<string, number>();
  for (const p of payments ?? []) {
    const amount = Number(p.amount);
    collectionByMode.set(p.mode, (collectionByMode.get(p.mode) ?? 0) + amount);
    const staffName = p.profiles?.name ?? "—";
    collectionByStaff.set(staffName, (collectionByStaff.get(staffName) ?? 0) + amount);
  }
  const totalCollection = [...collectionByMode.values()].reduce((sum, v) => sum + v, 0);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-16 sm:px-6">
      <BackLink href="/dashboard" label="Dashboard" />
      <p className="mt-3 text-sm font-medium text-zinc-500 dark:text-zinc-400">
        {profile.hospital?.name ?? "Your centre"}
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">
        USG dashboard — today&rsquo;s examinations
      </h1>

      <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {(Object.keys(COLUMN_LABELS) as Column[]).map((col) => (
          <div key={col} className="rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
            <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">
              {COLUMN_LABELS[col]} ({columns[col]!.length})
            </h2>
            <ul className="mt-3 flex flex-col gap-2 text-sm">
              {columns[col]!.length === 0 ? (
                <li className="text-zinc-400 dark:text-zinc-600">Nothing here.</li>
              ) : (
                columns[col]!.map((v) => (
                  <li key={v.id}>
                    <Link href={`/dashboard/visits/${v.id}`} className="hover:underline">
                      {v.patients!.name} ({v.patients!.patient_code}) — {v.visit_types!.name}
                    </Link>
                  </li>
                ))
              )}
            </ul>
          </div>
        ))}
      </div>

      <div className="mt-10 rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-lg font-semibold">Today&rsquo;s collection</h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Total: ₹{totalCollection.toFixed(2)}
        </p>

        <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div>
            <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">By mode</h3>
            <table className="mt-2 w-full max-w-sm text-left text-sm">
              <tbody>
                {[...collectionByMode.entries()].map(([mode, amount]) => (
                  <tr key={mode} className="border-b border-zinc-100 dark:border-zinc-900">
                    <td className="py-1.5">{mode}</td>
                    <td className="py-1.5 text-right">₹{amount.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">By staff</h3>
            <table className="mt-2 w-full max-w-sm text-left text-sm">
              <tbody>
                {[...collectionByStaff.entries()].map(([staff, amount]) => (
                  <tr key={staff} className="border-b border-zinc-100 dark:border-zinc-900">
                    <td className="py-1.5">{staff}</td>
                    <td className="py-1.5 text-right">₹{amount.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  );
}
