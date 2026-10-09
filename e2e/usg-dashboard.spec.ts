import path from "node:path";
import { test, expect } from "@playwright/test";
import { cleanupTestPatients } from "./utils/cleanup-test-patients";
import { createPatientViaUi } from "./utils/create-patient";

const DEMO_PASSWORD = "demo-password-123!";
const CLARITY_ADMIN_EMAIL = "admin@clarity.test";
const SUNRISE_ADMIN_EMAIL = "admin@sunrise.test";
const ID_PROOF_JPEG = path.join(__dirname, "fixtures", "id-proof.jpg");

test.beforeAll(async () => {
  await cleanupTestPatients("E2E USG Test Patient");
});

// MFA is opt-in (see src/lib/auth/mfa.ts) and these seeded accounts
// haven't enrolled a factor, so this is a plain login.
async function login(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test("a pregnancy/obstetric USG visit moves through the dashboard columns as its documents and status change", async ({
  page,
}) => {
  await login(page, CLARITY_ADMIN_EMAIL);

  const name = `E2E USG Test Patient ${Date.now()}`;
  await createPatientViaUi(page, { name });

  // ID Proof is required for every visit type (seeded), not just USG
  // — fulfil it once at the patient level before checking columns
  // below, or the visit would show as "Documents pending" forever.
  await page.getByLabel("Document type").selectOption({ label: "ID Proof" });
  await page.locator('input[type="file"]#front').setInputFiles(ID_PROOF_JPEG);
  await page.getByRole("button", { name: "Upload" }).click();
  // The document list renders a mobile card (first in the DOM, hidden
  // via CSS at this test's desktop viewport) and a desktop table row
  // for the same document -- .last() lands on the visible one.
  await expect(page.getByText("ID Proof (front).jpg").last()).toBeVisible();

  await page.getByRole("link", { name: "New visit" }).click();
  await page.getByLabel("Visit type").selectOption({ label: "Pregnancy/Obstetric USG" });
  await page.getByRole("button", { name: "Create visit" }).click();
  await expect(page).toHaveURL(/\/dashboard\/visits\/[0-9a-f-]+$/);
  const visitUrl = page.url();

  // Documents outstanding — shows in "Documents pending".
  await page.goto("/dashboard/usg");
  await expect(
    page.locator("div.grid > div", { hasText: "Documents pending" }).getByText(name),
  ).toBeVisible();

  // Fulfil both required documents. Each upload's own DocumentList row
  // (scoped to the table, not the select's own options or the
  // requirements checklist, both of which also contain this text
  // regardless of upload success) is waited on before starting the
  // next select+upload, since a Server Action's revalidatePath can
  // replace the form's DOM between submissions.
  await page.goto(visitUrl);
  const documentsTable = page.locator("table").last();

  await page.getByLabel("Document type").selectOption({ label: "USG Report" });
  await page.locator('input[type="file"]#file').setInputFiles(ID_PROOF_JPEG);
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(documentsTable.locator("td", { hasText: "USG Report" })).toBeVisible();

  await page.getByLabel("Document type").selectOption({ label: "PC-PNDT Declaration" });
  await page.locator('input[type="file"]#file').setInputFiles(ID_PROOF_JPEG);
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(documentsTable.locator("td", { hasText: "PC-PNDT Declaration" })).toBeVisible();
  await expect(page.getByText(/^v1, effective/)).toBeVisible();

  // Documents now fulfilled, status still SCHEDULED — "Waiting".
  await page.goto("/dashboard/usg");
  await expect(
    page.locator("div.grid > div", { hasText: "Waiting" }).getByText(name),
  ).toBeVisible();

  // Start the examination — "In progress".
  await page.goto(visitUrl);
  await page.getByRole("button", { name: "Start examination" }).click();
  await expect(page.getByText("In progress")).toBeVisible();
  await page.goto("/dashboard/usg");
  await expect(
    page.locator("div.grid > div", { hasText: "In progress" }).getByText(name),
  ).toBeVisible();

  // Complete it — "Completed".
  await page.goto(visitUrl);
  await page.getByRole("button", { name: "Mark completed" }).click();
  await expect(page.getByText("Completed")).toBeVisible();
  await page.goto("/dashboard/usg");
  await expect(
    page.locator("div.grid > div", { hasText: "Completed" }).getByText(name),
  ).toBeVisible();
});

test("a GENERAL_OPD-only hospital is redirected away from the USG dashboard", async ({ page }) => {
  await login(page, SUNRISE_ADMIN_EMAIL);
  await page.goto("/dashboard/usg");
  await expect(page).toHaveURL(/\/dashboard$/);
});
