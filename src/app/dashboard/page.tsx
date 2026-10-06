import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { getSessionProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { ModuleType } from "@/types/database";
import { todayInAppTimezone } from "@/lib/visits/today";
import { parseRange, resolvePeriod } from "@/lib/dashboard/periods";
import {
  BusinessOverviewSection,
  BusinessOverviewSkeleton,
} from "@/components/dashboard/business-overview-section";

export const metadata: Metadata = { title: "Dashboard — ClinicOS" };

const MODULE_LABELS: Record<ModuleType, string> = { GENERAL_OPD: "General OPD", USG: "USG" };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range } = await searchParams;
  // Role/MFA gating already happened in dashboard/layout.tsx; this
  // call is a cheap cache() hit, not a re-fetch.
  const profile = await getSessionProfile();
  const supabase = await createClient();
  const today = todayInAppTimezone();
  const period = resolvePeriod(parseRange(range), today);

  const [{ data: patientCount }, { count: todayVisitCount }, { count: pendingVisitCount }] =
    await Promise.all([
      // Total patients ever registered and still on file -- not just today's.
      // (An rpc returns its value in `data`, not `count`.)
      supabase.rpc("patient_total"),
      supabase.from("visits").select("id", { count: "exact", head: true }).eq("visit_date", today),
      // Computed in the database (see the pending_visit_requirements
      // migration) rather than by diffing every document in the app.
      supabase.from("visits_with_pending_requirements").select("visit_id", {
        count: "exact",
        head: true,
      }),
    ]);

  const modules = profile?.enabledModules ?? [];
  const isAdmin = profile?.role === "HOSPITAL_ADMIN";

  const stats = [
    { label: "Patients", value: Number(patientCount ?? 0), href: "/dashboard/patients" },
    { label: "Today's visits", value: todayVisitCount ?? 0, href: "/dashboard/visits" },
    {
      label: "Documents pending",
      value: pendingVisitCount ?? 0,
      href: "/dashboard/documents",
    },
  ];

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-16 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-500">
            {profile?.hospital?.name ?? "Your centre"}
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-900">
            Welcome back{profile?.name ? `, ${profile.name.split(" ")[0]}` : ""}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Signed in as {profile?.role === "HOSPITAL_ADMIN" ? "Admin" : "Receptionist"}
          </p>
        </div>
        <div className="flex gap-2">
          {modules.map((module) => (
            <span
              key={module}
              className="rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-medium text-teal-800"
            >
              {MODULE_LABELS[module]}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {stats.map((stat) => (
          <Link
            key={stat.label}
            href={stat.href}
            className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm transition-colors hover:border-teal-300"
          >
            <p className="text-sm font-medium text-slate-500">{stat.label}</p>
            <p className="mt-2 text-3xl font-semibold text-slate-900">{stat.value}</p>
          </Link>
        ))}
      </div>

      {/* Only actions the persistent nav above doesn't already cover —
          Patients/USG/Documents/Settings are all one click away there,
          so repeating them here would just be a second, redundant
          "Settings" (etc.) link on the same page. */}
      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-lg font-semibold text-slate-900">Quick actions</h2>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            href="/dashboard/patients/new"
            className="rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-700"
          >
            Register a patient
          </Link>
          {isAdmin ? (
            <Link
              href="/dashboard/staff"
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              Manage staff →
            </Link>
          ) : null}
        </div>
      </div>

      {/* Admin only, and streamed in after the cards above so they paint at
          once: staff never run these queries, and the Admin's page isn't
          held up by them. */}
      {isAdmin && profile?.hospitalId ? (
        <Suspense key={period.key} fallback={<BusinessOverviewSkeleton />}>
          <BusinessOverviewSection hospitalId={profile.hospitalId} period={period} />
        </Suspense>
      ) : null}
    </main>
  );
}
