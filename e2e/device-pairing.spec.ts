import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { test, expect } from "@playwright/test";
import { cleanupTestPatients } from "./utils/cleanup-test-patients";
import { createPatientViaUi } from "./utils/create-patient";

const DEMO_PASSWORD = "demo-password-123!";
const RECEPTIONIST_EMAIL = "reception@sunrise.test";
const ID_PROOF_JPEG = path.join(__dirname, "fixtures", "id-proof.jpg");

test.beforeAll(async () => {
  await cleanupTestPatients("E2E Device Pairing Test Patient");
});

// Leaves reception@sunrise.test's hospital with no leftover paired
// device for other specs, regardless of how this one ends.
test.afterAll(async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return;
  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: hospital } = await supabase
    .from("hospitals")
    .select("id")
    .eq("name", "Sunrise General Hospital")
    .single();
  if (hospital) {
    await supabase.from("paired_devices").delete().eq("hospital_id", hospital.id);
  }
});

test("pair a device once, send a request to it, and disconnect", async ({ page, context }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(RECEPTIONIST_EMAIL);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  const name = `E2E Device Pairing Test Patient ${Date.now()}`;
  await createPatientViaUi(page, { name });

  // Connect a device.
  await page.getByRole("button", { name: "Connect a device" }).click();
  const pairLink = page.locator('a[href*="/device/connect#"]');
  await expect(pairLink).toBeVisible();
  const pairUrl = await pairLink.getAttribute("href");
  expect(pairUrl).toBeTruthy();

  // Simulate the phone/tablet: a completely separate browser context.
  const phoneContext = await context.browser()!.newContext();
  const phonePage = await phoneContext.newPage();
  await phonePage.goto(pairUrl!);
  await expect(phonePage.getByText("Sunrise General Hospital")).toBeVisible();
  await phonePage.getByRole("button", { name: "Connect this device" }).click();
  await expect(phonePage).toHaveURL(/\/device$/);
  await expect(phonePage.getByText("Waiting for a request…")).toBeVisible();

  // Desktop notices the confirmed pairing (polls every ~2.5s).
  await expect(page.getByText("Device connected")).toBeVisible({ timeout: 10_000 });

  // Start a scan/sign request -- with a device connected, this goes
  // straight to the paired device instead of showing a QR.
  await page.getByLabel("Document type").selectOption({ label: "ID Proof" });
  await page.getByRole("button", { name: "Scan with phone" }).click();
  await expect(page.getByText("Sent to your connected device — waiting…")).toBeVisible();

  // The phone's waiting room picks up the assigned request.
  await expect(phonePage.getByText(`ID Proof — ${name}`)).toBeVisible({ timeout: 10_000 });
  await phonePage.getByRole("button", { name: "Open", exact: true }).click();
  await expect(phonePage).toHaveURL(/\/scan#/);
  await expect(phonePage.getByText(name)).toBeVisible();

  await phonePage.locator('input[type="file"]').setInputFiles(ID_PROOF_JPEG);
  await phonePage.getByRole("button", { name: "Use this photo" }).click();
  await expect(phonePage.getByText("Page 1")).toBeVisible();
  await phonePage.getByRole("button", { name: "Finish" }).click();
  await expect(phonePage.getByText("Done")).toBeVisible();
  // Reached via the paired device, not a fresh QR -- offers a way back
  // to the waiting room instead of "you can close this tab".
  await expect(phonePage.getByRole("link", { name: "Back to waiting" })).toBeVisible();

  // Desktop reflects completion.
  await expect(page.getByText("Scan finished — 1 page added.")).toBeVisible({ timeout: 10_000 });

  // Disconnect.
  await page.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByRole("button", { name: "Connect a device" })).toBeVisible();

  await phoneContext.close();
});
