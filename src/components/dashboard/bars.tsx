import { barPercent, percentChange } from "@/lib/dashboard/summary";

/**
 * The dashboard's bars are plain HTML + CSS -- no charting library, so
 * they add nothing to the JavaScript the browser downloads and render on
 * the server. Single colour, the figure printed beside every bar.
 */

export interface BarRow {
  key: string;
  label: string;
  /** Small grey text under the label (a hospital name, a module). */
  sublabel?: string | null;
  value: number;
  /** What to print at the end of the bar. */
  display: string;
  /** Optional second figure shown after the first ("₹4,200 collected"). */
  secondary?: string | null;
}

/** Ranked horizontal bars, longest first -- the "which one is busiest" view. */
export function BarList({
  title,
  rows,
  empty = "Nothing to show for this period.",
}: {
  title: string;
  rows: BarRow[];
  empty?: string;
}) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  return (
    <section>
      <h3 className="text-sm font-medium text-slate-700">{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">{empty}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {rows.map((r) => (
            <li key={r.key}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate text-slate-800" title={r.label}>
                  {r.label}
                  {r.sublabel ? (
                    <span className="ml-1 text-xs text-slate-500">{r.sublabel}</span>
                  ) : null}
                </span>
                <span className="shrink-0 text-slate-700 tabular-nums">
                  {r.display}
                  {r.secondary ? (
                    <span className="ml-2 text-xs text-slate-500">{r.secondary}</span>
                  ) : null}
                </span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-slate-100" aria-hidden="true">
                <div
                  className="h-2 rounded-full bg-teal-500"
                  style={{ width: `${barPercent(r.value, max)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** "▲ 12%" / "▼ 5%" versus the previous period; "—" when there is nothing to compare with. */
export function Delta({
  current,
  previous,
  upIsGood = true,
}: {
  current: number;
  previous: number;
  /** For dues, a rise is bad news -- flip the colours. */
  upIsGood?: boolean;
}) {
  const change = percentChange(current, previous);
  if (change === null) {
    return (
      <span className="text-xs text-slate-400" title="No data for the previous period">
        —
      </span>
    );
  }
  if (change === 0) {
    return <span className="text-xs text-slate-500">no change</span>;
  }
  const up = change > 0;
  const good = up === upIsGood;
  return (
    <span
      className={`text-xs font-medium ${good ? "text-emerald-700" : "text-rose-700"}`}
      title="Compared with the previous period"
    >
      {up ? "▲" : "▼"} {Math.abs(change)}%
      <span className="sr-only"> {up ? "up" : "down"} on the previous period</span>
    </span>
  );
}
