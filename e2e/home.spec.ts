import { test, expect } from "@playwright/test";

test("an unauthenticated visitor to / is redirected to /login", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("link", { name: "ClinicOS" })).toBeVisible();
});
