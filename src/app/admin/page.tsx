import type { Metadata } from "next";
import Link from "next/link";
import { getSessionProfile } from "@/lib/auth/session";
import { requireRole } from "@/lib/auth/guards";
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
  // Session/platform-admin/MFA gating is handled by admin/layout.tsx;
  // this call stays as defensive redundancy, same convention
  // dashboard/staff uses on top of dashboard/layout.tsx.
  requireRole(await getSessionProfile(), ["SUPER_ADMIN"]);

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
          <>
            {/* Card list below `sm` — a 6-column table doesn't fit a
                phone screen usefully even with horizontal scroll, so
                mobile gets a stacked list instead. */}
            <div className="mt-4 flex flex-col gap-3 sm:hidden">
              {hospitals.map((h) => (
                <Link
                  key={h.id}
                  href={`/admin/hospitals/${h.id}`}
                  className="rounded-lg border border-slate-200 p-4 transition-colors hover:bg-slate-50"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-medium text-teal-700">{h.name}</p>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[h.status]}`}
                    >
                      {h.status}
                    </span>
                  </div>
                  <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-sm text-slate-600">
                    <dt className="text-slate-400">Plan</dt>
                    <dd>{h.plan}</dd>
                    <dt className="text-slate-400">Modules</dt>
                    <dd>{h.hospital_modules.map((m) => m.module).join(", ") || "—"}</dd>
                    <dt className="text-slate-400">Trial ends</dt>
                    <dd>{new Date(h.trial_ends_at).toLocaleDateString()}</dd>
                    <dt className="text-slate-400">Subscription ends</dt>
                    <dd>
                      {h.subscription_ends_at
                        ? new Date(h.subscription_ends_at).toLocaleDateString()
                        : "—"}
                    </dd>
                  </dl>
                </Link>
              ))}
            </div>

            <table className="mt-4 hidden w-full text-left text-sm sm:table">
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
          </>
        ) : (
          <p className="mt-4 text-sm text-slate-500">No centres yet.</p>
        )}
      </div>
    </main>
  );
}
