import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth/session";
import { requireRole } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { HospitalStatusForm } from "@/components/admin/hospital-status-form";
import { HospitalPlanForm } from "@/components/admin/hospital-plan-form";
import { RecordPaymentForm } from "@/components/admin/record-payment-form";
import { DeleteHospitalForm } from "@/components/admin/delete-hospital-form";
import { BackLink } from "@/components/back-link";

export const metadata: Metadata = { title: "Centre — ClinicOS" };

export default async function HospitalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await getSessionProfile();
  if (!profile) {
    redirect(`/login?next=/admin/hospitals/${id}`);
  }
  if (!profile.isPlatformAdmin) {
    redirect("/dashboard");
  }
  requireRole(profile, ["SUPER_ADMIN"]);

  const supabase = await createClient();
  const [{ data: hospital }, { data: payments }] = await Promise.all([
    supabase.from("hospitals").select("*, hospital_modules(module)").eq("id", id).maybeSingle(),
    supabase
      .from("subscription_payments")
      .select("*")
      .eq("hospital_id", id)
      .order("created_at", { ascending: false }),
  ]);

  if (!hospital) {
    notFound();
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-16 sm:px-6">
      <BackLink href="/admin" label="Super admin console" />
      <p className="mt-3 text-sm font-medium text-slate-500">Platform admin</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">{hospital.name}</h1>
      <p className="mt-1 text-sm text-slate-600">
        Modules: {hospital.hospital_modules.map((m) => m.module).join(", ") || "—"}
      </p>
      <Link
        href={`/admin/hospitals/${hospital.id}/patients`}
        className="mt-2 w-fit text-sm text-teal-700 hover:underline"
      >
        View patients →
      </Link>

      <dl className="mt-8 grid max-w-lg grid-cols-[auto_1fr] gap-x-6 gap-y-4 text-sm">
        <dt className="pt-2 text-slate-500">Status</dt>
        <dd>
          <HospitalStatusForm hospitalId={hospital.id} currentStatus={hospital.status} />
        </dd>

        <dt className="pt-2 text-slate-500">Plan</dt>
        <dd>
          <HospitalPlanForm hospitalId={hospital.id} currentPlan={hospital.plan} />
        </dd>

        <dt className="text-slate-500">Trial ends</dt>
        <dd>{new Date(hospital.trial_ends_at).toLocaleDateString()}</dd>

        <dt className="text-slate-500">Subscription ends</dt>
        <dd>
          {hospital.subscription_ends_at
            ? new Date(hospital.subscription_ends_at).toLocaleDateString()
            : "—"}
        </dd>

        <dt className="text-slate-500">Address</dt>
        <dd>{hospital.address ?? "—"}</dd>

        <dt className="text-slate-500">Phone</dt>
        <dd>{hospital.phone ?? "—"}</dd>

        <dt className="text-slate-500">Email</dt>
        <dd>{hospital.email ?? "—"}</dd>
      </dl>

      <div className="mt-10 rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-lg font-semibold text-slate-900">Record a subscription payment</h2>
        <p className="mt-1 text-sm text-slate-500">
          Recording a payment sets the subscription end date to the period end, and reactivates the
          centre if it wasn&apos;t already active.
        </p>
        <div className="mt-4">
          <RecordPaymentForm hospitalId={hospital.id} />
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-lg font-semibold text-slate-900">Payment history</h2>
        {payments && payments.length > 0 ? (
          <>
            <div className="mt-4 flex flex-col gap-3 sm:hidden">
              {payments.map((p) => (
                <div key={p.id} className="rounded-lg border border-slate-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className={p.is_reversal ? "font-medium text-red-600" : "font-medium"}>
                      ₹{Number(p.amount).toFixed(2)}
                    </p>
                    <p className="shrink-0 text-sm text-slate-500">
                      {new Date(p.payment_date).toLocaleDateString()}
                    </p>
                  </div>
                  <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-sm text-slate-600">
                    <dt className="text-slate-400">Method</dt>
                    <dd>{p.payment_method}</dd>
                    <dt className="text-slate-400">Reference</dt>
                    <dd>{p.reference_number ?? "—"}</dd>
                    <dt className="text-slate-400">Period</dt>
                    <dd>
                      {p.period_start} – {p.period_end}
                    </dd>
                    <dt className="text-slate-400">Notes</dt>
                    <dd>{p.notes ?? "—"}</dd>
                  </dl>
                </div>
              ))}
            </div>

            <table className="mt-4 hidden w-full text-left text-sm sm:table">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 font-medium">Date</th>
                  <th className="py-2 font-medium">Amount</th>
                  <th className="py-2 font-medium">Method</th>
                  <th className="py-2 font-medium">Reference</th>
                  <th className="py-2 font-medium">Period</th>
                  <th className="py-2 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} className="border-b border-slate-100 last:border-0">
                    <td className="py-2 text-slate-600">
                      {new Date(p.payment_date).toLocaleDateString()}
                    </td>
                    <td className={p.is_reversal ? "py-2 text-red-600" : "py-2"}>
                      ₹{Number(p.amount).toFixed(2)}
                    </td>
                    <td className="py-2">{p.payment_method}</td>
                    <td className="py-2 text-slate-600">{p.reference_number ?? "—"}</td>
                    <td className="py-2 text-slate-600">
                      {p.period_start} – {p.period_end}
                    </td>
                    <td className="py-2 text-slate-600">{p.notes ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <p className="mt-4 text-sm text-slate-500">No payments recorded yet.</p>
        )}
      </div>

      <div className="mt-6 rounded-xl border border-red-300 bg-red-50 p-6 shadow-sm sm:p-8">
        <h2 className="text-lg font-semibold text-red-900">Danger zone</h2>
        <div className="mt-4">
          <DeleteHospitalForm hospitalId={hospital.id} hospitalName={hospital.name} />
        </div>
      </div>
    </main>
  );
}
