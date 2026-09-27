import { expect, type Page } from "@playwright/test";
import { generateTotp } from "./totp";

/**
 * Completes the /mfa/setup enrollment form currently on screen and
 * returns the secret, for specs that need a working aal2 session but
 * aren't testing MFA itself -- see mfa.spec.ts for the enroll/verify/
 * disable flows in detail.
 */
export async function completeMfaEnrollment(page: Page): Promise<string> {
  await expect(page).toHaveURL(/\/mfa\/setup/);
  const secretCode = page.locator("code");
  await expect(secretCode).toBeVisible();
  const secret = (await secretCode.textContent())?.trim();
  expect(secret).toBeTruthy();

  await page.getByLabel("6-digit code").fill(generateTotp(secret!));
  await page.getByRole("button", { name: "Confirm" }).click();
  return secret!;
}

/** Completes the /mfa/verify challenge currently on screen using the given secret. */
export async function completeMfaVerification(page: Page, secret: string): Promise<void> {
  await expect(page).toHaveURL(/\/mfa\/verify/);
  await page.getByLabel("6-digit code from your authenticator app").fill(generateTotp(secret));
  await page.getByRole("button", { name: "Verify" }).click();
}
