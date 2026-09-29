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

/**
 * Windowed page numbers (first, last, current ± 1) with "…" gaps --
 * fine for the hundreds-of-pages scale a single hospital's patient/
 * visit list would realistically reach, without needing to render
 * every page number. The "Showing X-Y of Z" count always renders (it's
 * useful even on a single-page list); only the Previous/Next/page-
 * number controls are hidden when there's nothing to page through.
 */
export function Pagination({
  page,
  pageSize,
  totalCount,
  basePath,
  extraParams = {},
}: {
  page: number;
  pageSize: number;
  totalCount: number;
  basePath: string;
  extraParams?: Record<string, string | undefined>;
}) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const from = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalCount);

  const pageNumbers = [...new Set([1, totalPages, page - 1, page, page + 1])]
    .filter((p) => p >= 1 && p <= totalPages)
    .sort((a, b) => a - b);

  return (
    <nav
      aria-label="Pagination"
      className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm"
    >
      <p className="text-zinc-500 dark:text-zinc-400">
        Showing {from}–{to} of {totalCount}
      </p>

      {totalPages > 1 ? (
        <div className="flex items-center gap-1">
          {page > 1 ? (
            <Link
              href={buildHref(basePath, extraParams, page - 1)}
              className="rounded-md border border-zinc-300 px-3 py-1.5 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              Previous
            </Link>
          ) : (
            <span className="rounded-md border border-zinc-200 px-3 py-1.5 text-zinc-300 dark:border-zinc-800 dark:text-zinc-700">
              Previous
            </span>
          )}

          {pageNumbers.map((p, i) => (
            <span key={p} className="flex items-center gap-1">
              {i > 0 && p - pageNumbers[i - 1] > 1 ? (
                <span className="px-1 text-zinc-400">…</span>
              ) : null}
              <Link
                href={buildHref(basePath, extraParams, p)}
                aria-current={p === page ? "page" : undefined}
                className={
                  p === page
                    ? "rounded-md bg-teal-600 px-3 py-1.5 text-white"
                    : "rounded-md border border-zinc-300 px-3 py-1.5 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
                }
              >
                {p}
              </Link>
            </span>
          ))}

          {page < totalPages ? (
            <Link
              href={buildHref(basePath, extraParams, page + 1)}
              className="rounded-md border border-zinc-300 px-3 py-1.5 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              Next
            </Link>
          ) : (
            <span className="rounded-md border border-zinc-200 px-3 py-1.5 text-zinc-300 dark:border-zinc-800 dark:text-zinc-700">
              Next
            </span>
          )}
        </div>
      ) : null}
    </nav>
  );
}
