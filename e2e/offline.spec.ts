import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { cleanupTestPatients } from "./utils/cleanup-test-patients";

const DEMO_PASSWORD = "demo-password-123!";
const RECEPTIONIST_EMAIL = "reception@clarity.test";
const ADMIN_EMAIL = "admin@clarity.test";

function serviceRole() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

// Random letters, so two test patients never look like each other to the
// duplicate check (it compares name similarity) -- only the mobile number is
// shared on purpose in the review test.
const letters = "bcdfghjklmnpqrstvwxz";
const word = (n: number) =>
  Array.from({ length: n }, () => letters[Math.floor(Math.random() * letters.length)]).join("");
const uniqueName = () => `E2EOffline ${word(9)} ${word(8)}`;

let clarityId: string;
let originalFlag = false;

test.beforeAll(async () => {
  const sr = serviceRole();
  const { data } = await sr
    .from("hospitals")
    .select("id, offline_sync_enabled")
    .eq("name", "Clarity Diagnostics")
    .single();
  clarityId = data!.id;
  originalFlag = data!.offline_sync_enabled;
  await sr.from("hospitals").update({ offline_sync_enabled: true }).eq("id", clarityId);
  await cleanupTestPatients("E2EOffline");
});

test.afterAll(async () => {
  await cleanupTestPatients("E2EOffline");
  await serviceRole()
    .from("hospitals")
    .update({ offline_sync_enabled: originalFlag })
    .eq("id", clarityId);
});

async function login(page: Page, email = RECEPTIONIST_EMAIL) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

/** Waits until this browser has the shell cached and the offline session saved. */
async function waitUntilReadyForOffline(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const cache = await caches.open("clinicos-shell-v2");
          const shell = Boolean(await cache.match("/offline"));
          const session = await new Promise<boolean>((resolve) => {
            const open = indexedDB.open("clinicos-offline");
            open.onerror = () => resolve(false);
            open.onsuccess = () => {
              const db = open.result;
              if (!db.objectStoreNames.contains("meta")) return resolve(false);
              const get = db.transaction("meta").objectStore("meta").get("session");
              get.onsuccess = () => resolve(Boolean(get.result));
              get.onerror = () => resolve(false);
            };
          });
          return shell && session && Boolean(navigator.serviceWorker.controller);
        }),
      { timeout: 30_000 },
    )
    .toBe(true);
}

async function fillRegistration(page: Page, name: string, mobile?: string) {
  await page.getByLabel("Name", { exact: true }).fill(name);
  if (mobile) await page.getByLabel("Mobile").fill(mobile);
  await page.getByLabel("Visit type").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Save on this computer" }).click();
}

async function patientsNamed(name: string) {
  const { data } = await serviceRole().from("patients").select("id").eq("name", name);
  return data ?? [];
}

test("register offline, lose the acknowledgement, retry: exactly one patient is created", async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  await login(page);
  await waitUntilReadyForOffline(page);

  const name = uniqueName();

  // Unplug: the offline shell still opens.
  await context.setOffline(true);
  await page.goto("/offline");
  await expect(page.getByRole("heading", { name: "Offline mode" })).toBeVisible();
  await page.getByRole("button", { name: /New patient \+ visit/ }).click();
  await fillRegistration(page, name);

  // Saved on this computer only, and says so.
  await expect(page.getByText("Saved on this computer — provisional no.")).toBeVisible();
  await expect(page.getByText("not in the cloud yet")).toBeVisible();
  expect(await patientsNamed(name)).toHaveLength(0);

  // Survives a reload while still offline.
  await page.reload();
  await page.getByRole("button", { name: /Saved on this computer/ }).click();
  await expect(page.getByText(name)).toBeVisible();
  await expect(page.getByText("Waiting to sync")).toBeVisible();

  // Reconnect, but the server's reply to the first sync is lost AFTER it commits.
  let dropped = 0;
  await context.route("**/api/offline/sync", async (route) => {
    if (dropped === 0) {
      dropped++;
      await route.fetch(); // the server really processes it
      await route.abort("connectionreset"); // ...but the browser never hears
      return;
    }
    await route.continue();
  });
  await context.setOffline(false);

  await expect.poll(async () => (await patientsNamed(name)).length, { timeout: 30_000 }).toBe(1);
  expect(dropped).toBe(1);

  // The queue retries the SAME operation; the page ends up "Synced", still one patient.
  await page.getByRole("button", { name: "Sync now" }).click();
  await expect(page.getByText("Synced", { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Sync now" }).click();
  expect(await patientsNamed(name)).toHaveLength(1);
});

test("a registration that looks like an existing patient is held for review, never merged", async ({
  page,
}) => {
  await login(page);
  await waitUntilReadyForOffline(page);
  await page.goto("/offline?view=new");

  const mobile = `9${String(Date.now()).slice(-9)}`;
  const first = uniqueName();
  await fillRegistration(page, first, mobile);
  await expect(page.getByText(/provisional no\.|Synced/).first()).toBeVisible();
  await expect.poll(async () => (await patientsNamed(first)).length, { timeout: 30_000 }).toBe(1);

  await page.goto("/offline?view=new");
  const second = uniqueName();
  await fillRegistration(page, second, mobile);
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: /Saved on this computer/ }).click();
  await page.getByRole("button", { name: "Sync now" }).click();

  await expect(page.getByText("This looks like a patient who is already registered.")).toBeVisible({
    timeout: 30_000,
  });
  // The possible match is shown (read live), and nothing was created for the second one.
  await expect(page.getByText(first)).toBeVisible();
  expect(await patientsNamed(second)).toHaveLength(0);

  await page.getByRole("button", { name: "A different person — register as new" }).click();
  await expect.poll(async () => (await patientsNamed(second)).length, { timeout: 30_000 }).toBe(1);
  expect(await patientsNamed(first)).toHaveLength(1);
});

test("a second save of the same person on this computer asks before creating another record", async ({
  page,
}) => {
  await login(page);
  await waitUntilReadyForOffline(page);
  await page.goto("/offline?view=new");
  const name = uniqueName();
  const mobile = `9${String(Date.now()).slice(-9)}`;
  // Offline, so nothing syncs between the two saves.
  await page.context().setOffline(true);
  await fillRegistration(page, name, mobile);
  await expect(page.getByText("Saved on this computer — provisional no.")).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: /New patient \+ visit/ }).click();
  await fillRegistration(page, name, mobile);
  await expect(
    page.getByText("This looks like someone already saved on this computer"),
  ).toBeVisible();
  await page.context().setOffline(false);
});

test("the centre's administrator sees an intact ledger and nothing hidden", async ({ page }) => {
  await login(page, ADMIN_EMAIL);
  await page.goto("/dashboard/settings/offline");
  await expect(page.getByText("Offline mode is on for your centre.")).toBeVisible();
  await expect(page.getByText(/Integrity check passed/)).toBeVisible();
});

test("after signing out, the offline screens do not show the previous person's records", async ({
  page,
}) => {
  await login(page);
  await waitUntilReadyForOffline(page);
  const name = uniqueName();

  // A record waiting on this computer (made while offline, never synced).
  await page.context().setOffline(true);
  await page.goto("/offline?view=new");
  await fillRegistration(page, name);
  await expect(page.getByText("Saved on this computer — provisional no.")).toBeVisible();
  // Back online, but syncing is blocked, so the record stays on this computer.
  await page.context().route("**/api/offline/sync", (route) => route.abort("connectionreset"));
  await page.context().setOffline(false);

  // Sign out (online): the offline screens lock.
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.goto("/offline?view=pending");
  await expect(
    page.getByRole("heading", { name: "Offline mode is not set up on this computer" }),
  ).toBeVisible();
  await expect(page.getByText(name)).toHaveCount(0);

  // Their records are not lost: signing in again brings them back.
  await login(page);
  await page.goto("/offline?view=pending");
  await expect(page.getByText(name)).toBeVisible();
  await page.context().unroute("**/api/offline/sync");
});
