import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth/session";
import { requireRole } from "@/lib/auth/guards";
import { getMfaStatus } from "@/lib/auth/mfa";
import { createClient } from "@/lib/supabase/server";
import type { HospitalStatus } from "@/types/database";

export const metadata: Metadata = { title: "Platform admin — ClinicOS" };

const STATUS_ORDER: HospitalStatus[] = ["TRIAL", "ACTIVE", "SUSPENDED", "EXPIRED"];

const STATUS_STYLES: Record<HospitalStatus, string> = {
  TRIAL: "bg-amber-100 text-amber-800",
  ACTIVE: "bg-emerald-100 text-emerald-800",
  SUSPENDED: "bg-red-100 text-red-800",
  EXPIRED: "bg-slate-200 text-slate-700",
};

export default async function AdminPage() {
  const profile = await getSessionProfile();

  if (!profile) {
    redirect("/login?next=/admin");
  }
  if (!profile.isPlatformAdmin) {
    redirect("/dashboard");
  }

  requireRole(profile, ["SUPER_ADMIN"]);

  const mfaStatus = await getMfaStatus(profile.role);
  if (mfaStatus === "enroll_required") {
    redirect("/mfa/setup?next=/admin");
  }
  if (mfaStatus === "challenge_required") {
    redirect("/mfa/verify?next=/admin");
  }

  const supabase = await createClient();
  const { data: hospitals } = await supabase
    .from("hospitals")
    .select("id, name, status, plan, trial_ends_at, subscription_ends_at, hospital_modules(module)")
    .order("name");

  const counts = STATUS_ORDER.reduce(
    (acc, status) => {
      acc[status] = (hospitals ?? []).filter((h) => h.status === status).length;
      return acc;
    },
    {} as Record<HospitalStatus, number>,
  );

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-16 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-500">Platform admin</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
            Super admin console
          </h1>
        </div>
        <Link
          href="/admin/hospitals/new"
          className="rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-700"
        >
          Create centre
        </Link>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {STATUS_ORDER.map((status) => (
          <div key={status} className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm font-medium text-slate-500">{status}</p>
            <p className="mt-2 text-3xl font-semibold text-slate-900">{counts[status]}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-lg font-semibold text-slate-900">Centres</h2>
        {hospitals && hospitals.length > 0 ? (
          <div className="-mx-6 overflow-x-auto px-6 sm:mx-0 sm:px-0">
            <table className="mt-4 w-full min-w-[640px] text-left text-sm sm:min-w-0">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 font-medium">Name</th>
                  <th className="py-2 font-medium">Status</th>
                  <th className="py-2 font-medium">Plan</th>
                  <th className="py-2 font-medium">Modules</th>
                  <th className="py-2 font-medium">Trial ends</th>
                  <th className="py-2 font-medium">Subscription ends</th>
                </tr>
              </thead>
              <tbody>
                {hospitals.map((h) => (
                  <tr key={h.id} className="border-b border-slate-100 last:border-0">
                    <td className="py-2">
                      <Link
                        href={`/admin/hospitals/${h.id}`}
                        className="text-teal-700 hover:underline"
                      >
                        {h.name}
                      </Link>
                    </td>
                    <td className="py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[h.status]}`}
                      >
                        {h.status}
                      </span>
                    </td>
                    <td className="py-2 text-slate-600">{h.plan}</td>
                    <td className="py-2 text-slate-600">
                      {h.hospital_modules.map((m) => m.module).join(", ") || "—"}
                    </td>
                    <td className="py-2 text-slate-600">
                      {new Date(h.trial_ends_at).toLocaleDateString()}
                    </td>
                    <td className="py-2 text-slate-600">
                      {h.subscription_ends_at
                        ? new Date(h.subscription_ends_at).toLocaleDateString()
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-500">No centres yet.</p>
        )}
      </div>
    </main>
  );
}
