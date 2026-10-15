// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

/**
 * The service worker is plain JavaScript in public/sw.js. These tests run it
 * against a small fake of the service-worker environment to pin down exactly
 * when it serves the offline shell, and what it refuses to touch.
 */

const SOURCE = fs.readFileSync(path.join(process.cwd(), "public", "sw.js"), "utf8");
const ORIGIN = "https://clinic.example";

type Handler = (event: Record<string, unknown>) => void;

class FakeCache {
  store = new Map<string, Response>();
  async match(req: RequestInfo | URL) {
    const key =
      typeof req === "string" ? req : req instanceof URL ? req.pathname : (req as Request).url;
    for (const [k, v] of this.store) {
      if (key === k || key.endsWith(k) || k.endsWith(key)) return v.clone();
    }
    return undefined;
  }
  async put(req: RequestInfo | URL, res: Response) {
    const key = typeof req === "string" ? req : (req as Request).url;
    this.store.set(key, res);
  }
  async keys() {
    return [...this.store.keys()].map((k) => new Request(new URL(k, ORIGIN)));
  }
  async delete(req: RequestInfo | URL) {
    return this.store.delete(typeof req === "string" ? req : (req as Request).url);
  }
}

function load(world: {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}) {
  const handlers = new Map<string, Handler>();
  const caches = new Map<string, FakeCache>();
  const cacheApi = {
    open: async (name: string) => {
      if (!caches.has(name)) caches.set(name, new FakeCache());
      return caches.get(name)!;
    },
    keys: async () => [...caches.keys()],
    delete: async (name: string) => caches.delete(name),
  };
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: Handler) => handlers.set(type, fn),
    skipWaiting: async () => undefined,
    clients: { claim: async () => undefined },
  };
  new Function("self", "caches", "fetch", "Response", "URL", "AbortSignal", SOURCE)(
    self,
    cacheApi,
    world.fetch,
    Response,
    URL,
    AbortSignal,
  );
  return { handlers, caches, cacheApi };
}

async function navigate(
  sw: ReturnType<typeof load>,
  pathName: string,
  opts: { method?: string; mode?: string } = {},
): Promise<Response | "ignored"> {
  const request = Object.assign(
    new Request(`${ORIGIN}${pathName}`, { method: opts.method ?? "GET" }),
    {},
  );
  Object.defineProperty(request, "mode", { value: opts.mode ?? "navigate" });
  let responded: Promise<Response> | null = null;
  sw.handlers.get("fetch")!({
    request,
    respondWith: (p: Promise<Response>) => (responded = p),
    waitUntil: () => undefined,
  });
  return responded ? await responded : "ignored";
}

const html = (url: string, init: ResponseInit = {}, redirected = false) => {
  const res = new Response("<html>/_next/static/chunks/app.js</html>", { status: 200, ...init });
  Object.defineProperty(res, "url", { value: `${ORIGIN}${url}` });
  Object.defineProperty(res, "redirected", { value: redirected });
  return res;
};

let healthy: boolean;
let netUp: boolean;
let responses: Record<string, () => Response>;

const world = {
  fetch: async (input: RequestInfo | URL) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      ORIGIN,
    );
    if (!netUp) throw new TypeError("offline");
    if (url.pathname === "/api/health") return new Response("{}", { status: healthy ? 200 : 503 });
    const make = responses[url.pathname];
    return make ? make() : new Response("not found", { status: 404 });
  },
};

async function installedWorker() {
  const sw = load(world);
  let done: Promise<unknown> | undefined;
  sw.handlers.get("install")!({ waitUntil: (p: Promise<unknown>) => (done = p) });
  await done;
  return sw;
}

beforeEach(() => {
  healthy = true;
  netUp = true;
  responses = {
    "/offline": () => html("/offline"),
    "/dashboard": () => html("/dashboard"),
    "/login": () => html("/login"),
    "/_next/static/chunks/app.js": () => new Response("js", { status: 200 }),
  };
});

describe("service worker", () => {
  it("caches the offline shell and its static files on install", async () => {
    const sw = await installedWorker();
    expect(await (await sw.cacheApi.open("clinicos-shell-v2")).match("/offline")).toBeDefined();
    expect(sw.caches.get("clinicos-static-v2")?.store.size).toBeGreaterThan(0);
  });

  it("does NOT cache a shell that was reached through a redirect (e.g. to the login page)", async () => {
    responses["/offline"] = () => html("/login", {}, true);
    const sw = await installedWorker();
    expect(await (await sw.cacheApi.open("clinicos-shell-v2")).match("/offline")).toBeUndefined();
  });

  it("sends a navigation to the offline shell when the network is down", async () => {
    const sw = await installedWorker();
    netUp = false;
    const res = (await navigate(sw, "/dashboard/patients")) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/offline");
  });

  it("serves the shell itself when the shell is what was asked for", async () => {
    const sw = await installedWorker();
    netUp = false;
    const res = (await navigate(sw, "/offline")) as Response;
    expect(res.status).toBe(200);
  });

  it("treats a hosting-layer 5xx like being offline", async () => {
    const sw = await installedWorker();
    responses["/dashboard"] = () => new Response("bad gateway", { status: 502 });
    const res = (await navigate(sw, "/dashboard")) as Response;
    expect(res.headers.get("location")).toContain("/offline");
  });

  it("app up, database down: a bounce to the login page means OFFLINE, not 'signed out'", async () => {
    const sw = await installedWorker();
    responses["/dashboard"] = () => html("/login", {}, true);
    healthy = false;
    const res = (await navigate(sw, "/dashboard")) as Response;
    expect(res.headers.get("location")).toContain("/offline");
  });

  it("a genuine sign-out (backend healthy) still shows the login page", async () => {
    const sw = await installedWorker();
    responses["/dashboard"] = () => html("/login", {}, true);
    healthy = true;
    const res = (await navigate(sw, "/dashboard")) as Response;
    expect(res.status).toBe(200);
    expect(res.url).toContain("/login");
  });

  it("falls back to a plain error (never a wrong page) if no shell was ever cached", async () => {
    const sw = load(world);
    netUp = false;
    const res = (await navigate(sw, "/dashboard")) as Response;
    expect(res.type === "error" || res.status === 0).toBe(true);
  });

  it("never touches API calls, posts, other origins or non-navigation requests", async () => {
    const sw = await installedWorker();
    expect(await navigate(sw, "/api/offline/sync", { mode: "cors" })).toBe("ignored");
    expect(await navigate(sw, "/dashboard", { method: "POST" })).toBe("ignored");
    expect(await navigate(sw, "/api/health", { mode: "cors" })).toBe("ignored");
  });

  it("serves build files from its cache first (so the shell works with no network)", async () => {
    const sw = await installedWorker();
    netUp = false;
    const res = (await navigate(sw, "/_next/static/chunks/app.js", {
      mode: "no-cors",
    })) as Response;
    expect(res.status).toBe(200);
  });

  it("discards caches from older versions when it activates", async () => {
    const sw = await installedWorker();
    await sw.cacheApi.open("clinicos-shell-v1");
    await sw.cacheApi.open("someone-elses-cache");
    let done: Promise<unknown> | undefined;
    sw.handlers.get("activate")!({ waitUntil: (p: Promise<unknown>) => (done = p) });
    await done;
    expect(sw.caches.has("clinicos-shell-v1")).toBe(false);
    expect(sw.caches.has("someone-elses-cache")).toBe(true);
    expect(sw.caches.has("clinicos-shell-v2")).toBe(true);
  });
});
