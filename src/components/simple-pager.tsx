import Link from "next/link";

function buildHref(
  basePath: string,
  extraParams: Record<string, string | undefined>,
  page: number,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(extraParams)) {
    if (value) params.set(key, value);
  }
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

const ACTIVE =
  "rounded-md border border-zinc-300 px-3 py-1.5 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900";
const DISABLED =
  "rounded-md border border-zinc-200 px-3 py-1.5 text-zinc-300 dark:border-zinc-800 dark:text-zinc-700";

/**
 * Previous / Next without a total. An exact `count(*)` over a hospital's
 * whole history costs a full scan on every page view (hundreds of ms at
 * 100k+ rows), so the big lists fetch one row more than they show and
 * only learn whether a next page exists -- the same navigation, without
 * the per-view scan. Small, bounded lists (e.g. today's queue) keep the
 * numbered <Pagination>.
 */
export function SimplePager({
  page,
  pageSize,
  shown,
  hasNext,
  basePath,
  extraParams = {},
}: {
  page: number;
  pageSize: number;
  /** Rows actually rendered on this page. */
  shown: number;
  hasNext: boolean;
  basePath: string;
  extraParams?: Record<string, string | undefined>;
}) {
  if (page === 1 && !hasNext) return null;
  const from = (page - 1) * pageSize + 1;
  return (
    <nav
      aria-label="Pagination"
      className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm"
    >
      <p className="text-zinc-500 dark:text-zinc-400">
        Showing {from}–{from + Math.max(shown, 1) - 1}
      </p>
      <div className="flex items-center gap-1">
        {page > 1 ? (
          <Link href={buildHref(basePath, extraParams, page - 1)} className={ACTIVE}>
            Previous
          </Link>
        ) : (
          <span className={DISABLED}>Previous</span>
        )}
        {hasNext ? (
          <Link href={buildHref(basePath, extraParams, page + 1)} className={ACTIVE}>
            Next
          </Link>
        ) : (
          <span className={DISABLED}>Next</span>
        )}
      </div>
    </nav>
  );
}
