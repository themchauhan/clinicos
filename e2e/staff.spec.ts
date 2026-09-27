import { test, expect } from "@playwright/test";

const DEMO_PASSWORD = "demo-password-123!";
const ADMIN_EMAIL = "admin@sunrise.test";

test("a hospital admin invites staff and can deactivate/reactivate them", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  // MFA is opt-in (see src/lib/auth/mfa.ts) and this seeded account
  // hasn't enrolled a factor, so sign-in goes straight to the dashboard.
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.getByRole("link", { name: "Manage staff →" }).click();
  await expect(page).toHaveURL(/\/dashboard\/staff$/);

  const invitedEmail = `invitee-${Date.now()}@sunrise.test`;
  await page.getByLabel("Name").fill("Demo Invitee");
  await page.getByLabel("Email").fill(invitedEmail);
  await page.getByLabel("Role").selectOption("RECEPTIONIST");
  await page.getByRole("button", { name: "Send invite" }).click();

  await expect(page.getByText(`Invited ${invitedEmail}.`)).toBeVisible();

  const row = page.locator("tr", { hasText: invitedEmail });
  await expect(row).toBeVisible();
  await expect(row.getByText("Receptionist")).toBeVisible();
  await expect(row.getByText("Active")).toBeVisible();

  await row.getByRole("button", { name: "Deactivate" }).click();
  await expect(
    page.locator("tr", { hasText: invitedEmail }).getByText("Deactivated"),
  ).toBeVisible();

  await page
    .locator("tr", { hasText: invitedEmail })
    .getByRole("button", { name: "Reactivate" })
    .click();
  await expect(page.locator("tr", { hasText: invitedEmail }).getByText("Active")).toBeVisible();
});
