import { test, expect, type Page } from "@playwright/test";
import { generateTotp } from "./utils/totp";
import { resetMfaFactors } from "./utils/reset-mfa";
import { completeMfaEnrollment } from "./utils/mfa-flow";

const DEMO_PASSWORD = "demo-password-123!";
// MFA is mandatory for SUPER_ADMIN (platform admin) by default, and
// opt-in for every other role via the self-service /account/security
// page -- see src/lib/auth/mfa.ts.
const SUPER_ADMIN_EMAIL = "super@platform.test";
const HOSPITAL_ADMIN_EMAIL = "admin@sunrise.test";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  // Wait for the post-login redirect (to /admin, /dashboard, or
  // /mfa/*) to actually land before a caller does anything else -- a
  // bare click() doesn't wait for the navigation it triggers to
  // complete, and a caller's very next action can otherwise race it
  // (e.g. a fresh page.goto interrupting an in-flight redirect and
  // landing back on /login instead).
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
}

// Every describe block below shares its account's MFA enrollment
// state across its own tests, so each block runs serially internally
// (playwright.config.ts otherwise parallelizes across the whole
// suite) -- but the two blocks use different accounts, so they don't
// need to be serial with each other.
test.describe.serial("Mandatory MFA (SUPER_ADMIN)", () => {
  test("a SUPER_ADMIN must enroll on first login, is challenged on later logins, and can't disable it", async ({
    page,
  }) => {
    // Guarantee this run exercises the enroll path regardless of
    // whether a previous run already enrolled this account (local
    // Supabase data persists across `npm run e2e` runs).
    await resetMfaFactors(SUPER_ADMIN_EMAIL);

    await login(page, SUPER_ADMIN_EMAIL);
    await expect(
      page.getByRole("heading", { name: "Set up two-factor authentication" }),
    ).toBeVisible();
    await expect(page.getByText("Required for platform admin accounts")).toBeVisible();

    const secret = await completeMfaEnrollment(page);
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { name: "Super admin console" })).toBeVisible();

    // Sign out and back in: this time a verified factor exists, so
    // it's challenged rather than enrolled again.
    await signOut(page);
    await login(page, SUPER_ADMIN_EMAIL);
    await expect(page).toHaveURL(/\/mfa\/verify/);
    await expect(page.getByRole("heading", { name: "Verify it's you" })).toBeVisible();

    await page.getByLabel("6-digit code from your authenticator app").fill(generateTotp(secret));
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page).toHaveURL(/\/admin$/);
    // Wait for the admin page to actually render (not just the URL to
    // change) before navigating again, so the aal2 cookie the client
    // just wrote is guaranteed to have round-tripped through a real
    // server render before the next request relies on it.
    await expect(page.getByRole("heading", { name: "Super admin console" })).toBeVisible();

    // No opt-out control for this role.
    await page.goto("/account/security");
    await expect(page.getByText("can't be turned off here")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Disable two-factor authentication" }),
    ).toHaveCount(0);
  });

  test("an incorrect MFA code is rejected during verification", async ({ page }) => {
    await login(page, SUPER_ADMIN_EMAIL);
    await expect(page).toHaveURL(/\/mfa\/verify/);

    await page.getByLabel("6-digit code from your authenticator app").fill("000000");
    await page.getByRole("button", { name: "Verify" }).click();

    await expect(page.getByText("Incorrect code")).toBeVisible();
    // Loosely matching /admin$/ against the full URL would also match
    // the still-present ?next=/admin query string, so check the
    // pathname specifically.
    expect(new URL(page.url()).pathname).not.toBe("/admin");
  });
});

test.describe.serial("Opt-in MFA (HOSPITAL_ADMIN)", () => {
  /** Enrolls via the self-service /account/security entry point. */
  async function enrollFromAccountSecurity(page: Page): Promise<string> {
    await page.goto("/account/security");
    await page.getByRole("link", { name: "Enable two-factor authentication" }).click();
    const secret = await completeMfaEnrollment(page);

    await expect(page).toHaveURL(/\/account\/security/);
    // "you'll be asked..." only appears in the enabled-state copy --
    // unlike a bare "Enabled" search, it can't also match the "Not
    // enabled..." paragraph as a case-insensitive substring.
    await expect(page.getByText("you'll be asked for a code", { exact: false })).toBeVisible();
    return secret;
  }

  test("a HOSPITAL_ADMIN can opt in from Account security, is challenged on future logins, and can opt out again", async ({
    page,
  }) => {
    await resetMfaFactors(HOSPITAL_ADMIN_EMAIL);

    // Not mandatory: logging in with no enrolled factor goes straight
    // to /dashboard, no MFA prompt.
    await login(page, HOSPITAL_ADMIN_EMAIL);
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.goto("/account/security");
    await expect(page.getByText("Not enabled", { exact: false })).toBeVisible();

    const secret = await enrollFromAccountSecurity(page);

    // Sign out and back in: this time a verified factor exists, so
    // it's challenged before reaching /dashboard.
    await signOut(page);
    await login(page, HOSPITAL_ADMIN_EMAIL);
    await expect(page).toHaveURL(/\/mfa\/verify/);
    await expect(page.getByRole("heading", { name: "Verify it's you" })).toBeVisible();

    await page.getByLabel("6-digit code from your authenticator app").fill(generateTotp(secret));
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: /^Welcome back/ })).toBeVisible();

    // Opt back out.
    await page.goto("/account/security");
    await expect(page.getByText("you'll be asked for a code", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Disable two-factor authentication" }).click();
    await expect(page.getByText("Not enabled", { exact: false })).toBeVisible();

    await signOut(page);
    await login(page, HOSPITAL_ADMIN_EMAIL);
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("an incorrect MFA code is rejected during verification", async ({ page }) => {
    await resetMfaFactors(HOSPITAL_ADMIN_EMAIL);
    await login(page, HOSPITAL_ADMIN_EMAIL);
    await enrollFromAccountSecurity(page);

    await signOut(page);
    await login(page, HOSPITAL_ADMIN_EMAIL);
    await expect(page).toHaveURL(/\/mfa\/verify/);

    await page.getByLabel("6-digit code from your authenticator app").fill("000000");
    await page.getByRole("button", { name: "Verify" }).click();

    await expect(page.getByText("Incorrect code")).toBeVisible();
    expect(new URL(page.url()).pathname).not.toBe("/dashboard");
  });

  // admin@sunrise.test is a shared fixture used by several other e2e
  // specs (settings, staff, visits, usg-dashboard) that all assume it
  // has no enrolled MFA factor -- always leave it that way afterward,
  // regardless of how the tests above ended.
  test.afterAll(async () => {
    await resetMfaFactors(HOSPITAL_ADMIN_EMAIL);
  });
});
