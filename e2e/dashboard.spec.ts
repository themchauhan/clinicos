import { test, expect, type Page } from "@playwright/test";

const DEMO_PASSWORD = "demo-password-123!";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test("the Admin sees the business overview with money, and can switch the period", async ({
  page,
}) => {
  await login(page, "admin@sunrise.test");

  await expect(page.getByRole("heading", { name: "Business overview" })).toBeVisible();
  // Money is for the Admin.
  await expect(page.getByText("Collected", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Outstanding dues", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Doctors" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Collection by payment mode" })).toBeVisible();

  // Switching to the financial year keeps the page working and marks the tab.
  await page.getByRole("link", { name: "This financial year" }).click();
  await expect(page).toHaveURL(/range=fy$/);
  await expect(page.getByRole("link", { name: "This financial year" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByRole("heading", { name: "Business overview" })).toBeVisible();

  // An unknown range falls back to the current month rather than erroring.
  await page.goto("/dashboard?range=nonsense");
  await expect(page.getByRole("link", { name: "This month" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("a receptionist's dashboard has no business overview at all -- just the fast daily cards", async ({
  page,
}) => {
  await login(page, "reception@sunrise.test");

  // The daily cards are there...
  await expect(page.getByRole("link", { name: /^Patients\s*\d+$/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Today's visits\s*\d+$/ })).toBeVisible();
  // ...and nothing from the Admin's overview, money or otherwise.
  await expect(page.getByRole("heading", { name: "Business overview" })).toHaveCount(0);
  await expect(page.getByText("Collected", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Outstanding dues", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "This financial year" })).toHaveCount(0);
});
