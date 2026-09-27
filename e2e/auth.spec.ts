import { test, expect } from "@playwright/test";

// Credentials from scripts/seed.ts. Run `npx supabase start && npm run
// db:seed` before this spec — see README.md.
const DEMO_PASSWORD = "demo-password-123!";
// MFA is mandatory for SUPER_ADMIN and opt-in for every other role
// (see src/lib/auth/mfa.ts) -- RECEPTIONIST never enrolls, so it's the
// simplest account for tests that are about session mechanics rather
// than MFA itself. See mfa.spec.ts for the SUPER_ADMIN mandatory and
// HOSPITAL_ADMIN opt-in enroll/verify/disable flows.
const TENANT_EMAIL = "reception@sunrise.test";

async function login(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("a tenant user logs in and lands on /dashboard", async ({ page }) => {
  await login(page, TENANT_EMAIL);
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: /^Welcome back/ })).toBeVisible();
  await expect(page.getByText(TENANT_EMAIL)).toBeVisible();
});

test("an incorrect password shows an error and does not navigate", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(TENANT_EMAIL);
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByText("Incorrect email or password.")).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test("a deactivated account cannot log in", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("deactivated@sunrise.test");
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByText("This account has been deactivated.")).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test("signing out returns to a signed-out state", async ({ page }) => {
  await login(page, TENANT_EMAIL);
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

  // Session is really gone, not just a client-side redirect.
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard/);
});

test("an unauthenticated visitor hitting /dashboard is redirected to /login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard/);
});

test("a tenant user hitting /admin is redirected to /dashboard, not shown the admin console", async ({
  page,
}) => {
  await login(page, TENANT_EMAIL);
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto("/admin");
  await expect(page).toHaveURL(/\/dashboard$/);
});
