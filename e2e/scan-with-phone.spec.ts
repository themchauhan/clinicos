import path from "node:path";
import { test, expect } from "@playwright/test";
import { cleanupTestPatients } from "./utils/cleanup-test-patients";
import { createPatientViaUi } from "./utils/create-patient";
import { countDocuments } from "./utils/audit-logs";

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

  // ID Proof is two-sided: the phone asks for the front, then the back.
  await expect(phonePage.getByText("Take a photo of the front")).toBeVisible();
  await phonePage.locator('input[type="file"]').setInputFiles(ID_PROOF_JPEG);
  await phonePage.getByRole("button", { name: "Use this photo" }).click();
  await expect(phonePage.getByText("Front", { exact: true })).toBeVisible();

  // Now the back. (setInputFiles directly, not a click on the label that
  // wraps the hidden input, which would open a native file picker.)
  await expect(phonePage.getByText("Take a photo of the back")).toBeVisible();
  await phonePage.locator('input[type="file"]').setInputFiles(ID_PROOF_JPEG);
  await phonePage.getByRole("button", { name: "Use this photo" }).click();
  await expect(phonePage.getByText("Back", { exact: true })).toBeVisible();
  await expect(phonePage.getByText("Both sides captured")).toBeVisible();

  // Desktop polls every ~2.5s and refreshes; wait for it to notice both
  // sides before finishing on the phone.
  await expect(page.getByText("2 sides of the ID captured so far…")).toBeVisible({
    timeout: 10_000,
  });

  await phonePage.getByRole("button", { name: "Finish" }).click();
  await expect(phonePage.getByText("Done")).toBeVisible();
  await expect(phonePage.getByText("ID Proof saved for")).toBeVisible();

  // Desktop reflects completion, and what landed is ONE merged document --
  // not two pages.
  await expect(page.getByText("Scan finished — the ID was saved as one image.")).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText("ID Proof (front + back).jpg").last()).toBeVisible();
  const patientId = page.url().match(/\/dashboard\/patients\/([0-9a-f-]+)/)![1];
  expect(await countDocuments(patientId, "ID Proof (front + back).jpg")).toBe(1);
  // The two working pages were retired.
  expect(await countDocuments(patientId, "front.jpg")).toBe(0);
  expect(await countDocuments(patientId, "back.jpg")).toBe(0);

  await phoneContext.close();
});

test("scanning only the front of an ID (skipping the back) stores that one side", async ({
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
  const patientId = page.url().match(/\/dashboard\/patients\/([0-9a-f-]+)/)![1];

  await page.getByLabel("Document type").selectOption({ label: "ID Proof" });
  await page.getByRole("button", { name: "Scan with phone" }).click();
  const scanUrl = await page.locator('a[href*="/scan#"]').getAttribute("href");

  const phoneContext = await context.browser()!.newContext();
  const phonePage = await phoneContext.newPage();
  await phonePage.goto(scanUrl!);

  await phonePage.locator('input[type="file"]').setInputFiles(ID_PROOF_JPEG);
  await phonePage.getByRole("button", { name: "Use this photo" }).click();
  await expect(phonePage.getByText("Take a photo of the back")).toBeVisible();
  await phonePage.getByRole("button", { name: "Skip the back — front only" }).click();
  await expect(phonePage.getByText("ID Proof saved for")).toBeVisible();

  await expect(page.getByText("ID Proof (front).jpg").last()).toBeVisible({ timeout: 10_000 });
  expect(await countDocuments(patientId, "ID Proof (front).jpg")).toBe(1);

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
