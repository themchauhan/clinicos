import { test, expect } from "@playwright/test";
import { resetMfaFactors } from "./utils/reset-mfa";
import { completeMfaEnrollment } from "./utils/mfa-flow";

const DEMO_PASSWORD = "demo-password-123!";
const PLATFORM_ADMIN_EMAIL = "super@platform.test";

test.afterAll(async () => {
  await resetMfaFactors(PLATFORM_ADMIN_EMAIL);
});

test("a platform admin creates a centre, manages its status/plan, and records a payment", async ({
  page,
}) => {
  // MFA is mandatory for SUPER_ADMIN (see src/lib/auth/mfa.ts and
  // mfa.spec.ts, which covers the enroll/verify/disable flows in
  // detail) -- reset first so this account deterministically hits the
  // enroll form regardless of what a previous e2e run left behind,
  // then complete it once so the rest of this test can proceed as a
  // normal aal2 session.
  await resetMfaFactors(PLATFORM_ADMIN_EMAIL);
  await page.goto("/login");
  await page.getByLabel("Email").fill(PLATFORM_ADMIN_EMAIL);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await completeMfaEnrollment(page);
  await expect(page).toHaveURL(/\/admin$/);

  await page.getByRole("link", { name: "Create centre" }).click();
  await expect(page).toHaveURL(/\/admin\/hospitals\/new$/);

  const centreName = `E2E Test Centre ${Date.now()}`;
  await page.getByLabel("Centre name").fill(centreName);
  await page.getByLabel("General OPD").check();
  await page.getByLabel("Admin name").fill("E2E Centre Admin");
  await page.getByLabel("Admin email").fill(`e2e-centre-admin-${Date.now()}@example.test`);
  await page.getByRole("button", { name: "Create centre" }).click();

  // Redirects to the new centre's own detail page.
  await expect(page).toHaveURL(/\/admin\/hospitals\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { name: centreName })).toBeVisible();
  await expect(page.getByText("Modules: GENERAL_OPD")).toBeVisible();

  // Shows up in the centre list too.
  await page.goto("/admin");
  // Scoped to the centres table: the File storage card above it lists
  // every centre as a link too.
  const centreLink = page.getByRole("table").getByRole("link", { name: centreName });
  await expect(centreLink).toBeVisible();

  // Change its status directly (no payment attached).
  await centreLink.click();
  await page.getByRole("combobox").first().selectOption("SUSPENDED");
  await expect(page.getByText("Saving…")).toHaveCount(0, { timeout: 10_000 });

  // Change its plan.
  const planInput = page.locator('input[type="text"]').first();
  await planInput.fill("PILOT");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();

  // Recording a payment reactivates a SUSPENDED centre and extends its
  // subscription — the actual behavior under test here, since
  // requireActiveTenant()'s own enforcement logic is already covered
  // by src/lib/auth/guards.test.ts (SUSPENDED/EXPIRED throw, every
  // write action in the app wraps requireRole in requireActiveTenant —
  // confirmed by code audit in the Phase 8 plan), so this e2e test
  // deliberately doesn't re-suspend a *shared* seeded hospital just to
  // re-prove that unit-level fact end-to-end.
  await page.getByLabel("Amount (₹)").fill("5000");
  await page.getByLabel("Payment method").fill("UPI");
  await page.getByLabel("Reference number").fill("TESTREF123");
  await page.getByLabel("Period start").fill("2026-01-01");
  await page.getByLabel("Period end").fill("2026-02-01");
  await page.getByRole("button", { name: "Record payment" }).click();

  // Payment history renders a mobile card (first in the DOM, hidden
  // via CSS at this test's desktop viewport) and a desktop table row
  // for the same payment -- .last() lands on the visible one.
  await expect(page.getByText("TESTREF123").last()).toBeVisible();
  await expect(page.locator("select")).toHaveValue("ACTIVE");
});
