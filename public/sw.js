/* ClinicOS offline shell.
 *
 * Deliberately small. It does ONE thing: keep the offline screens (/offline)
 * and the static files they need available when the network, the hosted app
 * or the database is unreachable.
 *
 * What it never does:
 *  - cache API responses, server-rendered pages, or anything with patient
 *    data (patient data lives in the app's own IndexedDB store, not here);
 *  - touch POSTs, server actions or Next's data requests;
 *  - cache a login page (or any redirect) as if it were the shell.
 *
 * While the app or its database is unreachable, a page navigation anywhere in
 * the app lands on /offline. Bump VERSION to force every computer to rebuild
 * its shell cache.
 */
const VERSION = "v2";
const SHELL_CACHE = `clinicos-shell-${VERSION}`;
const STATIC_CACHE = `clinicos-static-${VERSION}`;
const SHELL_URL = "/offline";
const MAX_STATIC_ENTRIES = 300;
const HEALTH_TIMEOUT_MS = 3000;

const STATIC_PATTERN = /\/_next\/static\/[^"'\\\s)<>]+/g;

// A real shell response: OK, not a redirect (e.g. to /login), and for /offline itself.
function isUsableShell(res) {
  if (!res || !res.ok || res.redirected) return false;
  try {
    return new URL(res.url).pathname === SHELL_URL;
  } catch {
    return false;
  }
}

async function cacheStaticFiles(html) {
  const urls = Array.from(new Set(html.match(STATIC_PATTERN) || []));
  const cache = await caches.open(STATIC_CACHE);
  await Promise.all(
    urls.map(async (url) => {
      if (await cache.match(url)) return;
      try {
        const res = await fetch(url, { credentials: "same-origin" });
        if (res.ok) await cache.put(url, res);
      } catch {
        /* best effort: runtime caching below fills any gap */
      }
    }),
  );
  // Keep the cache from growing forever across deployments (oldest first).
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_STATIC_ENTRIES))) {
    await cache.delete(key);
  }
}

async function refreshShell() {
  try {
    const res = await fetch(SHELL_URL, { credentials: "same-origin", cache: "no-store" });
    if (!isUsableShell(res)) return false;
    const copy = res.clone();
    const cache = await caches.open(SHELL_CACHE);
    await cache.put(SHELL_URL, res);
    await cacheStaticFiles(await copy.text());
    return true;
  } catch {
    return false;
  }
}

// Is the app's backend (app server + database) really answering?
async function backendHealthy() {
  try {
    const res = await fetch("/api/health", {
      cache: "no-store",
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(refreshShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith("clinicos-") && name !== SHELL_CACHE && name !== STATIC_CACHE) {
          await caches.delete(name);
        }
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "refresh-shell") event.waitUntil(refreshShell());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Immutable, content-hashed build files: cache first.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      })(),
    );
    return;
  }

  // Page navigations only.
  if (req.mode !== "navigate") return;
  event.respondWith(
    (async () => {
      const goOffline = async () => {
        const cached = await (await caches.open(SHELL_CACHE)).match(SHELL_URL);
        if (!cached) return null;
        // Already asking for the shell: serve it. Elsewhere: send them to it.
        return url.pathname === SHELL_URL
          ? cached
          : Response.redirect(new URL(SHELL_URL, self.location.origin).href, 302);
      };
      try {
        const res = await fetch(req);
        // Hosting-layer outage pages: treat like being offline.
        if ([502, 503, 504].includes(res.status)) return (await goOffline()) || res;
        // The app is up but its database is not: every page check fails and the
        // visitor is bounced to the login page. If the backend is not really
        // answering, that bounce means "offline", not "signed out".
        if (res.redirected && new URL(res.url).pathname === "/login" && url.pathname !== "/login") {
          if (!(await backendHealthy())) return (await goOffline()) || res;
        }
        // Opportunistically keep the shell fresh when it is visited online.
        if (url.pathname === SHELL_URL && isUsableShell(res)) {
          const copy = res.clone();
          event.waitUntil(
            (async () => {
              await (await caches.open(SHELL_CACHE)).put(SHELL_URL, copy.clone());
              await cacheStaticFiles(await copy.text());
            })(),
          );
        }
        return res;
      } catch {
        return (await goOffline()) || Response.error();
      }
    })(),
  );
});
