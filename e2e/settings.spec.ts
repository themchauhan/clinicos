import { test, expect } from "@playwright/test";
import { cleanupTestPatients } from "./utils/cleanup-test-patients";
import { createPatientViaUi } from "./utils/create-patient";

const DEMO_PASSWORD = "demo-password-123!";
const ADMIN_EMAIL = "admin@sunrise.test";

test.beforeAll(async () => {
  await cleanupTestPatients("E2E Settings Test Patient");
});

test("editing a visit type's document requirements changes the checklist for new visits only", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  // MFA is opt-in (see src/lib/auth/mfa.ts) and this seeded account
  // hasn't enrolled a factor, so sign-in goes straight to the dashboard.
  await expect(page).toHaveURL(/\/dashboard$/);

  // Settings lives in the nav's "More" dropdown -- going straight
  // there is simpler and more robust than opening the dropdown first.
  await page.goto("/dashboard/settings");

  // Add a new VISIT-scope document type.
  const docTypeName = `E2E Settings Doc Type ${Date.now()}`;
  await page.getByLabel("Document type name").fill(docTypeName);
  await page.getByLabel("Scope").selectOption("VISIT");
  await page.getByRole("button", { name: "Add document type" }).click();
  // Shows up in the document-type list's mobile card (first in the
  // DOM, hidden via CSS at this test's desktop viewport), its desktop
  // table row, and the requirements matrix's row header -- .last()
  // lands on a row that's actually visible here.
  await expect(page.getByText(docTypeName).last()).toBeVisible();

  // Mark it required for OPD Consultation (one click: none -> required).
  // The cell's accessible name is "<visit type>: <state>" so it's
  // unambiguous even if other visit types (from other specs' fixture
  // data, never cleaned up) also show up as matrix columns.
  const row = page.locator("tr", { hasText: docTypeName });
  await row.getByRole("button", { name: /^OPD Consultation:/ }).click();
  await expect(row.getByRole("button", { name: "OPD Consultation: Required" })).toBeVisible();

  // Create the first patient/visit — should pick up the new requirement.
  const name = `E2E Settings Test Patient ${Date.now()}`;
  await createPatientViaUi(page, { name });
  const patientUrl = page.url();
  await page.getByRole("link", { name: "New visit" }).click();
  await page.getByLabel("Visit type").selectOption({ label: "OPD Consultation" });
  await page.getByRole("button", { name: "Create visit" }).click();
  await expect(page).toHaveURL(/\/dashboard\/visits\/[0-9a-f-]+$/);
  const firstVisitUrl = page.url();

  await expect(page.locator("li", { hasText: docTypeName })).toContainText("(pending)");

  // Back to settings: relax the requirement to optional (required -> optional).
  await page.goto("/dashboard/settings");
  await row.getByRole("button", { name: "OPD Consultation: Required" }).click();
  await expect(row.getByRole("button", { name: "OPD Consultation: Optional" })).toBeVisible();

  // A second visit under the same visit type no longer shows it pending.
  await page.goto(`${patientUrl}/visits/new`);
  await page.getByLabel("Visit type").selectOption({ label: "OPD Consultation" });
  await page.getByRole("button", { name: "Create visit" }).click();
  await expect(page).toHaveURL(/\/dashboard\/visits\/[0-9a-f-]+$/);
  await expect(page.locator("li", { hasText: docTypeName })).not.toContainText("(pending)");

  // The FIRST visit's already-snapshotted checklist is untouched.
  await page.goto(firstVisitUrl);
  await expect(page.locator("li", { hasText: docTypeName })).toContainText("(pending)");
});

test("adding a doctor makes them selectable on a new visit, deactivating removes them from that list", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto("/dashboard/settings");
  const doctorName = `E2E Settings Doctor ${Date.now()}`;
  await page.getByLabel("Doctor name").fill(doctorName);
  await page.getByRole("button", { name: "Add doctor" }).click();
  await expect(page.getByText(doctorName).last()).toBeVisible();

  const name = `E2E Settings Test Patient ${Date.now()}`;
  await createPatientViaUi(page, { name });
  await page.getByRole("link", { name: "New visit" }).click();
  await expect(page.getByLabel("Doctor").locator(`option:has-text("${doctorName}")`)).toHaveCount(1);

  // Deactivate the doctor, then confirm they no longer appear as an
  // option on a fresh visit form (the existing .eq("active", true)
  // filter on that page's own query already does this).
  await page.goto("/dashboard/settings");
  const row = page.locator("tr", { hasText: doctorName });
  await row.getByRole("button", { name: "Deactivate" }).click();
  await expect(row.getByRole("button", { name: "Reactivate" })).toBeVisible();

  await page.goto(`/dashboard/patients`);
  await page.getByRole("link", { name }).click();
  await page.getByRole("link", { name: "New visit" }).click();
  await expect(page.getByLabel("Doctor").locator(`option:has-text("${doctorName}")`)).toHaveCount(0);
});
