import { test, expect } from "@playwright/test";
import { cleanupTestPatients } from "./utils/cleanup-test-patients";
import { createPatientViaUi } from "./utils/create-patient";

const DEMO_PASSWORD = "demo-password-123!";
const RECEPTIONIST_EMAIL = "reception@sunrise.test";
const ADMIN_EMAIL = "admin@sunrise.test";

test.beforeAll(async () => {
  await cleanupTestPatients("E2E Visit Test Patient");
});

test("create a visit, record a partial payment, then pay the rest via the shortcut", async ({
  page,
}) => {
  // Stub window.print (applies to every frame, including the hidden
  // print iframe) so PrintSlipButton's cleanup -- normally triggered
  // by the real print dialog closing -- doesn't fire near-instantly
  // with no real dialog to wait on, racing this test's own inspection
  // of that iframe's content.
  await page.addInitScript(() => {
    window.print = () => {};
  });

  await page.goto("/login");
  await page.getByLabel("Email").fill(RECEPTIONIST_EMAIL);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  const name = `E2E Visit Test Patient ${Date.now()}`;
  await createPatientViaUi(page, { name });

  await page.getByRole("link", { name: "New visit" }).click();
  await expect(page).toHaveURL(/\/visits\/new$/);

  await page.getByLabel("Visit type").selectOption({ label: "OPD Consultation" });
  await page.getByLabel("Referred by (doctor)").fill("Dr. Referring Test");
  await page.getByLabel("Referring hospital/clinic").fill("Test Referral Clinic");
  await page.getByLabel("Fee amount (₹)").fill("500");
  await page.getByRole("button", { name: "Create visit" }).click();

  await expect(page).toHaveURL(/\/dashboard\/visits\/[0-9a-f-]+$/);
  await expect(page.getByText("Unpaid — ₹0.00 of ₹500.00")).toBeVisible();
  await expect(page.getByText("Dr. Referring Test")).toBeVisible();
  await expect(page.getByText("Test Referral Clinic")).toBeVisible();

  // Partial payment.
  await page.getByLabel("Amount (₹)").fill("200");
  await page.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByText("Partially paid — ₹200.00 of ₹500.00")).toBeVisible();

  // Pay the rest via the "received in full" shortcut.
  await page.getByRole("button", { name: /Received in full/ }).click();
  await page.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByText("Paid — ₹500.00 of ₹500.00")).toBeVisible();

  // No reversal form for a RECEPTIONIST.
  await expect(page.getByText("Correction (admin only)")).not.toBeVisible();

  // The printable slip loads into a hidden iframe (no new tab/page)
  // and shows the right header info.
  await page.getByRole("button", { name: "Print slip" }).click();
  const slip = page.frameLocator('iframe[src*="/slip"]');
  await expect(slip.getByRole("heading", { name: "Sunrise General Hospital" })).toBeAttached();
  await expect(slip.getByText(name)).toBeAttached();
});

test("only a HOSPITAL_ADMIN can record a reversal", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  // MFA is opt-in (see src/lib/auth/mfa.ts) and this seeded account
  // hasn't enrolled a factor, so sign-in goes straight to the dashboard.
  await expect(page).toHaveURL(/\/dashboard$/);

  const name = `E2E Visit Test Patient ${Date.now()}`;
  await createPatientViaUi(page, { name });
  await page.getByRole("link", { name: "New visit" }).click();
  await page.getByLabel("Visit type").selectOption({ label: "OPD Consultation" });
  await page.getByLabel("Fee amount (₹)").fill("300");
  await page.getByRole("button", { name: "Create visit" }).click();

  await page.getByLabel("Amount (₹)").fill("300");
  await page.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByText("Paid — ₹300.00 of ₹300.00")).toBeVisible();

  await expect(page.getByText("Correction (admin only)")).toBeVisible();
  await page.getByLabel("Reversal amount (₹, negative)").fill("-50");
  await page.getByLabel("Reason").fill("Test refund");
  await page.getByRole("button", { name: "Record reversal" }).click();

  await expect(page.getByText("Partially paid — ₹250.00 of ₹300.00")).toBeVisible();
  // The payment history renders both a mobile card (first in the DOM,
  // hidden via CSS at this test's desktop viewport) and a desktop
  // table for the same rows, so this text matches twice -- .last()
  // picks the one actually visible here.
  await expect(page.getByText("Test refund").last()).toBeVisible();
});

test("recording a UPI payment with a transaction ID shows it in history and makes the visit searchable by it", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(RECEPTIONIST_EMAIL);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  const name = `E2E Visit Test Patient ${Date.now()}`;
  await createPatientViaUi(page, { name });
  await page.getByRole("link", { name: "New visit" }).click();
  await page.getByLabel("Visit type").selectOption({ label: "OPD Consultation" });
  await page.getByLabel("Fee amount (₹)").fill("400");
  await page.getByRole("button", { name: "Create visit" }).click();
  await expect(page).toHaveURL(/\/dashboard\/visits\/[0-9a-f-]+$/);

  // The transaction ID field only appears once UPI is selected.
  await expect(page.getByLabel("UPI transaction ID")).not.toBeVisible();
  await page.getByLabel("Mode").selectOption("UPI");
  const reference = `UPIE2E${Date.now()}`;
  await page.getByLabel("UPI transaction ID").fill(reference);
  await page.getByLabel("Amount (₹)").fill("400");
  await page.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByText("Paid — ₹400.00 of ₹400.00")).toBeVisible();
  await expect(page.getByText(reference).last()).toBeVisible();

  // Findable from the Visits list by that same reference.
  await page.goto(`/dashboard/visits?q=${encodeURIComponent(reference)}`);
  await expect(page.getByRole("link", { name })).toBeVisible();
});
