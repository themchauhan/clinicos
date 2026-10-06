import Link from "next/link";
import { RANGE_OPTIONS, type Period } from "@/lib/dashboard/periods";
import {
  WEEKDAY_LABELS,
  foldRest,
  formatCount,
  formatInr,
  formatRange,
  type DashboardSummary,
  type SummaryTotals,
} from "@/lib/dashboard/summary";
import { BarList, Delta } from "./bars";

function Kpi({
  label,
  value,
  delta,
  hint,
}: {
  label: string;
  value: string;
  delta?: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-900 tabular-nums">{value}</p>
      <p className="mt-1 min-h-4 text-xs text-slate-500">
        {delta}
        {hint ? <span className={delta ? "ml-2" : ""}>{hint}</span> : null}
      </p>
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      {children}
    </div>
  );
}

/**
 * "How is the centre doing?" -- visits, new vs returning patients, and
 * (for the Admin only) collection and dues, for a chosen period, with the
 * change from the comparable previous period. The numbers all come from
 * one database function (dashboard_summary); this only lays them out.
 */
export function BusinessOverview({
  summary,
  previous,
  period,
}: {
  summary: DashboardSummary;
  previous: SummaryTotals;
  period: Period;
}) {
  const t = summary.totals;
  const admin = summary.is_admin;
  const weekday = (summary.weekday ?? []).map((w) => ({
    key: String(w.dow),
    label: WEEKDAY_LABELS[w.dow - 1],
    value: w.visits,
    display: formatCount(w.visits),
  }));

  return (
    <section className="mt-10" aria-labelledby="business-overview-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="business-overview-heading" className="text-xl font-semibold text-slate-900">
            Business overview
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            {formatRange(period.from, period.to)}
            <span className="text-slate-400">
              {" "}
              · compared with {formatRange(period.prevFrom, period.prevTo)}
            </span>
          </p>
        </div>
        <nav aria-label="Period" className="flex flex-wrap gap-2">
          {RANGE_OPTIONS.map((o) => {
            const active = o.key === period.key;
            return (
              <Link
                key={o.key}
                href={`/dashboard?range=${o.key}`}
                scroll={false}
                aria-current={active ? "page" : undefined}
                className={
                  active
                    ? "rounded-md bg-teal-600 px-3 py-1.5 text-sm font-medium text-white"
                    : "rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 transition-colors hover:bg-slate-100"
                }
              >
                {o.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi
          label="Visits"
          value={formatCount(t.visits)}
          delta={<Delta current={t.visits} previous={previous.visits} />}
          hint={t.cancelled > 0 ? `${t.cancelled} cancelled` : undefined}
        />
        <Kpi
          label="New patients"
          value={formatCount(t.new_patients)}
          delta={<Delta current={t.new_patients} previous={previous.new_patients} />}
        />
        <Kpi
          label="Returning patients"
          value={formatCount(t.returning_patients)}
          delta={<Delta current={t.returning_patients} previous={previous.returning_patients} />}
          hint={
            t.patients_visited > 0
              ? `${Math.round((t.returning_patients / t.patients_visited) * 100)}% of ${formatCount(t.patients_visited)} seen`
              : undefined
          }
        />
        {admin && t.collected !== null ? (
          <Kpi
            label="Collected"
            value={formatInr(t.collected)}
            delta={<Delta current={t.collected} previous={previous.collected ?? 0} />}
            hint={t.billed !== null ? `of ${formatInr(t.billed)} billed` : undefined}
          />
        ) : null}
      </div>
      {admin && t.outstanding_amount !== null ? (
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Kpi
            label="Outstanding dues"
            value={formatInr(t.outstanding_amount)}
            delta={
              <Delta
                current={t.outstanding_amount}
                previous={previous.outstanding_amount ?? 0}
                upIsGood={false}
              />
            }
            hint={`${formatCount(t.outstanding_count ?? 0)} visit${t.outstanding_count === 1 ? "" : "s"} not fully paid`}
          />
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {admin ? (
          <Panel>
            <BarList
              title="Collection by payment mode"
              rows={(summary.by_mode ?? []).map((r) => ({
                key: r.mode,
                label: r.mode === "UPI" ? "UPI" : r.mode[0] + r.mode.slice(1).toLowerCase(),
                value: Math.max(0, r.amount),
                display: formatInr(r.amount),
              }))}
              empty="No payments received in this period."
            />
          </Panel>
        ) : null}
        <Panel>
          <BarList
            title="Doctors"
            rows={foldRest(summary.by_doctor ?? []).map((r) => ({
              key: r.name,
              label: r.name,
              value: r.visits,
              display: `${formatCount(r.visits)} visits`,
              secondary: admin && r.collected !== null ? formatInr(r.collected) : null,
            }))}
          />
        </Panel>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel>
          <BarList
            title="Who refers the most patients"
            rows={(summary.referrers ?? []).map((r) => ({
              key: r.name,
              label: r.name,
              sublabel: r.hospital,
              value: r.visits,
              display: `${formatCount(r.visits)} visits`,
              secondary: admin && r.billed !== null ? `${formatInr(r.billed)} billed` : null,
            }))}
            empty="No referrals recorded in this period."
          />
        </Panel>
        <Panel>
          <BarList title="Busiest days of the week" rows={weekday} />
        </Panel>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {admin ? (
          <Panel>
            <BarList
              title="Collected by staff"
              rows={(summary.by_staff ?? []).map((r) => ({
                key: r.name,
                label: r.name,
                value: Math.max(0, r.amount),
                display: formatInr(r.amount),
              }))}
              empty="No payments received in this period."
            />
          </Panel>
        ) : null}
      </div>
    </section>
  );
}
