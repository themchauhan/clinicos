import { createClient } from "@/lib/supabase/server";
import { cachedFor } from "@/lib/dashboard/cache";
import { type Period } from "@/lib/dashboard/periods";
import type { DashboardSummary } from "@/lib/dashboard/summary";
import { BusinessOverview } from "./business-overview";

/**
 * Loads and renders the business overview. It is its own async component
 * so the dashboard can wrap it in <Suspense>: the page's own cards paint
 * immediately and these heavier figures fill in after, instead of the
 * whole page waiting on them. Only ever rendered for the centre's Admin
 * -- staff never trigger these queries at all.
 *
 * Cached for a minute per centre + period; `hospitalId` comes from the
 * server-side session (never the request) and the result is Admin-only,
 * so the key can't mix centres or expose money to anyone else.
 */
export async function BusinessOverviewSection({
  hospitalId,
  period,
}: {
  hospitalId: string;
  period: Period;
}) {
  const supabase = await createClient();
  const scope = `${hospitalId}:admin`;

  const [summary, previous] = await Promise.all([
    cachedFor<DashboardSummary>(`${scope}:${period.from}:${period.to}`, async () => {
      const { data } = await supabase.rpc("dashboard_summary", {
        p_from: period.from,
        p_to: period.to,
      });
      return data;
    }),
    cachedFor<DashboardSummary>(`${scope}:${period.prevFrom}:${period.prevTo}:totals`, async () => {
      const { data } = await supabase.rpc("dashboard_summary", {
        p_from: period.prevFrom,
        p_to: period.prevTo,
        p_totals_only: true,
      });
      return data;
    }),
  ]);

  if (!summary || !previous) {
    return (
      <p className="mt-10 text-sm text-slate-500">
        The business overview couldn&rsquo;t be loaded right now. Refresh to try again.
      </p>
    );
  }
  return <BusinessOverview summary={summary} previous={previous.totals} period={period} />;
}

/** Shown while the overview loads: same footprint, so nothing jumps. */
export function BusinessOverviewSkeleton() {
  return (
    <section className="mt-10" aria-busy="true" aria-label="Loading business overview">
      <div className="h-7 w-48 animate-pulse rounded bg-slate-200" />
      <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-xl bg-slate-100" />
        ))}
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="h-56 animate-pulse rounded-xl bg-slate-100" />
        <div className="h-56 animate-pulse rounded-xl bg-slate-100" />
      </div>
    </section>
  );
}
