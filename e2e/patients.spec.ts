import { test, expect } from "@playwright/test";
import { cleanupTestPatients } from "./utils/cleanup-test-patients";
import { createPatientViaUi } from "./utils/create-patient";

const DEMO_PASSWORD = "demo-password-123!";
const RECEPTIONIST_EMAIL = "reception@sunrise.test";

test.beforeAll(async () => {
  // See cleanup-test-patients.ts: without this, leftover patients from
  // previous runs can fuzzy-match this run's and trip the duplicate
  // warning where a clean create is expected.
  await cleanupTestPatients("E2E Test Patient");
  await cleanupTestPatients("Duplicate Warning Patient");
});

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(RECEPTIONIST_EMAIL);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test("create a patient, find them by name/mobile/code, then edit them", async ({ page }) => {
  await login(page);

  const unique = Date.now();
  const name = `E2E Test Patient ${unique}`;
  const mobile = `9${String(unique).slice(-9)}`;

  await createPatientViaUi(page, { name, mobile });

  await expect(page.getByRole("heading", { name })).toBeVisible();
  const patientCode = await page.locator("p.font-mono").first().textContent();
  expect(patientCode).toMatch(/^\d{6}$/);

  for (const query of [name, mobile, patientCode!]) {
    await page.goto(`/dashboard/patients?q=${encodeURIComponent(query)}`);
    await expect(page.getByRole("link", { name })).toBeVisible();
  }

  await page.goto("/dashboard/patients");
  await page.getByRole("link", { name }).click();
  await page.getByRole("link", { name: "Edit" }).click();
  await expect(page).toHaveURL(/\/edit$/);

  await page.getByLabel("Address").fill("12 Test Street");
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page).toHaveURL(/\/dashboard\/patients\/[0-9a-f-]+$/);
  await expect(page.getByText("12 Test Street")).toBeVisible();
});

test("warns about a likely duplicate but allows creating anyway", async ({ page }) => {
  await login(page);

  const unique = Date.now();
  const name = `Duplicate Warning Patient ${unique}`;
  const mobile = `8${String(unique).slice(-9)}`;

  await page.goto("/dashboard/patients/new");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Mobile").fill(mobile);
  await page.getByRole("button", { name: "Create patient" }).click();
  await expect(page).toHaveURL(/\/dashboard\/patients\/[0-9a-f-]+$/);

  // Try registering the same name + mobile again.
  await page.goto("/dashboard/patients/new");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Mobile").fill(mobile);
  await page.getByRole("button", { name: "Create patient" }).click();

  await expect(page.getByText("This might already be an existing patient:")).toBeVisible();
  // The fields must still show what was typed, not have reset.
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(name);
  await expect(page.getByLabel("Mobile")).toHaveValue(mobile);

  await page.getByRole("button", { name: "This is a different person — create anyway" }).click();
  await expect(page).toHaveURL(/\/dashboard\/patients\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { name })).toBeVisible();
});

test("rejects a non-numeric mobile number", async ({ page }) => {
  await login(page);

  await page.goto("/dashboard/patients/new");
  await page.getByLabel("Name", { exact: true }).fill(`E2E Invalid Mobile Patient ${Date.now()}`);
  await page.getByLabel("Mobile").fill("abcd");
  await page.getByRole("button", { name: "Create patient" }).click();

  // The Mobile field's `pattern` blocks this via native browser
  // constraint validation before the form ever submits, so the page
  // never navigates away -- no patient is created either.
  await expect(page).toHaveURL(/\/dashboard\/patients\/new$/);
});
