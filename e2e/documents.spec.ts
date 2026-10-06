import path from "node:path";
import { test, expect } from "@playwright/test";
import { cleanupTestPatients } from "./utils/cleanup-test-patients";
import { createPatientViaUi } from "./utils/create-patient";
import { countAuditLogs, countDocuments, findDocumentId } from "./utils/audit-logs";

const DEMO_PASSWORD = "demo-password-123!";
const RECEPTIONIST_EMAIL = "reception@sunrise.test";

const FIXTURES_DIR = path.join(__dirname, "fixtures");
const ID_PROOF_JPEG = path.join(FIXTURES_DIR, "id-proof.jpg");
const NOT_AN_IMAGE = path.join(FIXTURES_DIR, "not-an-image.jpg");

test.beforeAll(async () => {
  await cleanupTestPatients("E2E Document Test Patient");
});

test("upload a patient-level document, view it, and see it fulfil a visit requirement", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(RECEPTIONIST_EMAIL);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  const name = `E2E Document Test Patient ${Date.now()}`;
  await createPatientViaUi(page, { name });
  const patientId = page.url().match(/\/dashboard\/patients\/([0-9a-f-]+)$/)![1];

  // Patient-level "ID Proof" upload.
  await page.getByLabel("Document type").selectOption({ label: "ID Proof" });
  await page.locator('input[type="file"]#file').setInputFiles(ID_PROOF_JPEG);
  await page.getByRole("button", { name: "Upload" }).click();

  // The document list renders a mobile card (first in the DOM, hidden
  // via CSS at this test's desktop viewport) and a desktop table row
  // for the same document -- .last() lands on the visible one.
  await expect(page.getByText("id-proof.jpg").last()).toBeVisible();
  await expect(page.getByText("Sensitive").last()).toBeVisible();

  // Uploading the exact same file again in the same slot stores nothing
  // new -- it says so instead.
  await page.getByLabel("Document type").selectOption({ label: "ID Proof" });
  await page.locator('input[type="file"]#file').setInputFiles(ID_PROOF_JPEG);
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByText("already attached here")).toBeVisible();
  expect(await countDocuments(patientId, "id-proof.jpg")).toBe(1);

  // Viewing a sensitive document logs exactly one audit_logs row.
  const documentId = await findDocumentId(patientId, "id-proof.jpg");

  const [viewTab] = await Promise.all([
    page.waitForEvent("popup"),
    page.getByRole("button", { name: "View" }).click(),
  ]);
  await viewTab.waitForURL(/\/storage\/v1\/object\/sign\/documents\//, { timeout: 10_000 });
  await viewTab.close();

  expect(await countAuditLogs("document.viewed", documentId)).toBe(1);

  // Create a visit and confirm the checklist already shows ID Proof
  // fulfilled (captured once at the patient level, reused here) but
  // OPD Slip / Prescription still pending.
  await page.getByRole("link", { name: "New visit" }).click();
  await page.getByLabel("Visit type").selectOption({ label: "OPD Consultation" });
  await page.getByLabel("Fee amount (₹)").fill("400");
  await page.getByRole("button", { name: "Create visit" }).click();
  await expect(page).toHaveURL(/\/dashboard\/visits\/[0-9a-f-]+$/);

  await expect(page.locator("li", { hasText: "ID Proof" })).toContainText("✓");
  await expect(page.locator("li", { hasText: "OPD Slip / Prescription" })).toContainText(
    "(pending)",
  );

  // Upload the visit-level document; the checklist should flip to
  // fulfilled after the page revalidates.
  await page.getByLabel("Document type").selectOption({ label: "OPD Slip / Prescription" });
  await page.locator('input[type="file"]#file').setInputFiles(ID_PROOF_JPEG);
  await page.getByRole("button", { name: "Upload" }).click();

  await expect(page.locator("li", { hasText: "OPD Slip / Prescription" })).not.toContainText(
    "(pending)",
  );
});

test("rejects a disallowed file type with a clear error", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(RECEPTIONIST_EMAIL);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  const name = `E2E Document Test Patient ${Date.now()}`;
  await createPatientViaUi(page, { name });

  await page.getByLabel("Document type").selectOption({ label: "ID Proof" });
  await page.locator('input[type="file"]#file').setInputFiles(NOT_AN_IMAGE);
  await page.getByRole("button", { name: "Upload" }).click();

  await expect(page.locator("p[role=alert]")).toHaveText(
    "Only JPEG, PNG, or PDF files are accepted.",
  );
  await expect(page.getByText("No documents uploaded yet.")).toBeVisible();
});
