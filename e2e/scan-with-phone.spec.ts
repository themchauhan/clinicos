import path from "node:path";
import { test, expect } from "@playwright/test";
import { cleanupTestPatients } from "./utils/cleanup-test-patients";
import { createPatientViaUi } from "./utils/create-patient";

const DEMO_PASSWORD = "demo-password-123!";
const RECEPTIONIST_EMAIL = "reception@sunrise.test";
const ID_PROOF_JPEG = path.join(__dirname, "fixtures", "id-proof.jpg");

test.beforeAll(async () => {
  await cleanupTestPatients("E2E Scan Test Patient");
});

test("scan with phone: desktop QR session, a separate browser context uploads pages, desktop sees them appear", async ({
  page,
  context,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(RECEPTIONIST_EMAIL);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  const name = `E2E Scan Test Patient ${Date.now()}`;
  await createPatientViaUi(page, { name });

  await page.getByLabel("Document type").selectOption({ label: "ID Proof" });
  await page.getByRole("button", { name: "Scan with phone" }).click();

  // The fallback plain-text link is what makes this testable without
  // decoding QR pixels — it carries the exact same token the QR does.
  const link = page.locator('a[href*="/scan#"]');
  await expect(link).toBeVisible();
  const scanUrl = await link.getAttribute("href");
  expect(scanUrl).toBeTruthy();

  // Simulate the phone: a completely separate browser context with no
  // cookies at all, matching a real phone that never signed in.
  const phoneContext = await context.browser()!.newContext();
  const phonePage = await phoneContext.newPage();
  await phonePage.goto(scanUrl!);

  await expect(phonePage.getByText("ID Proof")).toBeVisible();
  await expect(phonePage.getByText(name)).toBeVisible();

  // Page 1.
  await phonePage.locator('input[type="file"]').setInputFiles(ID_PROOF_JPEG);
  await phonePage.getByRole("button", { name: "Use this photo" }).click();
  await expect(phonePage.getByText("Page 1")).toBeVisible();

  // Page 2. No need to click the "Add another page" label first —
  // clicking a label that wraps a hidden file input would try to open
  // a real native file-picker dialog in the browser and hang the
  // test; setInputFiles() sets the input's files directly regardless
  // of visibility.
  await expect(phonePage.getByText("Add another page")).toBeVisible();
  await phonePage.locator('input[type="file"]').setInputFiles(ID_PROOF_JPEG);
  await phonePage.getByRole("button", { name: "Use this photo" }).click();
  await expect(phonePage.getByText("Page 2")).toBeVisible();

  // Desktop polls every ~2.5s and refreshes; wait for it to notice
  // both pages before finishing on the phone.
  await expect(page.getByText("2 pages uploaded so far…")).toBeVisible({ timeout: 10_000 });

  await phonePage.getByRole("button", { name: "Finish" }).click();
  await expect(phonePage.getByText("Done")).toBeVisible();
  await expect(phonePage.getByText("2 pages uploaded for")).toBeVisible();

  // Desktop reflects completion and the document actually landed on
  // the patient's document list.
  await expect(page.getByText("Scan finished — 2 pages added.")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("td", { hasText: "ID Proof" }).first()).toBeVisible();

  await phoneContext.close();
});

test("an expired or already-finished scan link is rejected", async ({ page, context }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(RECEPTIONIST_EMAIL);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  const name = `E2E Scan Test Patient ${Date.now()}`;
  await createPatientViaUi(page, { name });

  await page.getByLabel("Document type").selectOption({ label: "ID Proof" });
  await page.getByRole("button", { name: "Scan with phone" }).click();
  const scanUrl = await page.locator('a[href*="/scan#"]').getAttribute("href");

  const phoneContext = await context.browser()!.newContext();
  const phonePage = await phoneContext.newPage();
  await phonePage.goto(scanUrl!);
  await phonePage.locator('input[type="file"]').setInputFiles(ID_PROOF_JPEG);
  await phonePage.getByRole("button", { name: "Use this photo" }).click();
  await phonePage.getByRole("button", { name: "Finish" }).click();
  await expect(phonePage.getByText("Done")).toBeVisible();

  // Re-opening the same (now-completed) link is rejected.
  const secondPhonePage = await phoneContext.newPage();
  await secondPhonePage.goto(scanUrl!);
  await expect(
    secondPhonePage.getByText(
      "This scan session is already finished. Ask reception for a fresh QR code.",
    ),
  ).toBeVisible();

  await phoneContext.close();
});
