/**
 * A tiny in-memory, per-server-instance cache for the dashboard's heavy
 * aggregate, so refreshing the page or flipping between tabs doesn't
 * recompute a month or a year of figures each time. Results can be up to
 * `ttlMs` stale (a payment recorded a moment ago shows on the overview
 * within a minute) -- fine for a business overview; today's live cards
 * above it are not cached.
 *
 * The key MUST include everything the answer depends on: the centre (from
 * the server session, never client input) and the role (the Admin's
 * result carries money fields a receptionist's must not), plus the period.
 * Only successful results are stored; the map is bounded.
 */

const DEFAULT_TTL_MS = 60_000;
const MAX_ENTRIES = 200;

interface Entry {
  at: number;
  value: unknown;
}

const store = new Map<string, Entry>();

export async function cachedFor<T>(
  key: string,
  load: () => Promise<T | null>,
  options: { ttlMs?: number; now?: () => number } = {},
): Promise<T | null> {
  const ttl = options.ttlMs ?? DEFAULT_TTL_MS;
  const now = options.now ?? Date.now;

  const hit = store.get(key);
  if (hit && now() - hit.at < ttl) {
    return hit.value as T;
  }

  const value = await load();
  if (value !== null && value !== undefined) {
    store.set(key, { at: now(), value });
    // Bounded: drop the oldest entries first (Map keeps insertion order).
    while (store.size > MAX_ENTRIES) {
      const oldest = store.keys().next().value;
      if (oldest === undefined) break;
      store.delete(oldest);
    }
  }
  return value;
}

/** Test helper. */
export function clearDashboardCache(): void {
  store.clear();
}
