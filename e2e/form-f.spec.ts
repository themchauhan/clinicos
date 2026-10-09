import path from "node:path";
import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { cleanupTestPatients } from "./utils/cleanup-test-patients";

const DEMO_PASSWORD = "demo-password-123!";
const CLARITY_ADMIN_EMAIL = "admin@clarity.test";
const FORM_F_PDF = path.join(__dirname, "fixtures", "form-f.pdf");
const TEMPLATE_NAME = `E2E Form F ${Date.now()}`;

function serviceRole() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

test.beforeAll(async () => {
  await cleanupTestPatients("E2E Form F Patient");
});

test.afterAll(async () => {
  await cleanupTestPatients("E2E Form F Patient");
  await serviceRole().from("form_templates").delete().eq("name", TEMPLATE_NAME);
});

test("Form F: the ready-made layout saves, and the fill screen pre-fills children, LMP and referrer", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(CLARITY_ADMIN_EMAIL);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  // Template: upload the blank Form F and take the ready-made layout.
  await page.goto("/dashboard/settings/forms/new");
  await page.getByLabel("Form name").fill(TEMPLATE_NAME);
  await page.getByLabel("Blank form (PDF)").setInputFiles(FORM_F_PDF);
  await page.getByRole("button", { name: "Use the standard Form F layout" }).click();
  await page.getByRole("button", { name: "Save form template" }).click();
  await expect(page).toHaveURL(/\/dashboard\/settings\/forms$/, { timeout: 20_000 });
  await expect(page.getByText(TEMPLATE_NAME).last()).toBeVisible();

  // The layout reached the database whole: fields, tick positions, extra stamps.
  const { data: template } = await serviceRole()
    .from("form_templates")
    .select(
      "seal_page, doctor_signature_page, extra_stamps, form_template_fields(field_key, input_type, tick_marks)",
    )
    .eq("name", TEMPLATE_NAME)
    .single();
  expect(template?.seal_page).toBe(3);
  expect(template?.extra_stamps).toHaveLength(2);
  const checklist = template?.form_template_fields.find((f) => f.input_type === "checklist");
  expect(checklist?.tick_marks).toHaveLength(23);

  // A patient with children, and a USG visit with an LMP.
  const name = `E2E Form F Patient ${Date.now()}`;
  await page.goto("/dashboard/patients/new");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByText("Children (asked on PC-PNDT Form F)").click();
  await page.getByLabel("Living sons").fill("1");
  await page.getByLabel("Age of each son").fill("4 years");
  await page.getByLabel("Living daughters").fill("2");
  await page.getByRole("button", { name: "Create patient" }).click();
  const duplicate = page.getByRole("button", {
    name: "This is a different person — create anyway",
  });
  if (await duplicate.isVisible({ timeout: 3_000 }).catch(() => false)) await duplicate.click();
  await expect(page).toHaveURL(/\/dashboard\/patients\/[0-9a-f-]+$/, { timeout: 10_000 });

  await page.getByRole("link", { name: "New visit" }).click();
  await page.getByLabel("Visit type").selectOption({ label: "Pregnancy/Obstetric USG" });
  await page.getByLabel("Referred by (doctor)").fill("Dr Referrer Demo");
  const today = new Date();
  const lmp = new Date(today.getTime() - 70 * 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel("Last menstrual period (LMP)").fill(lmp);
  await page.getByRole("button", { name: "Create visit" }).click();
  await expect(page).toHaveURL(/\/dashboard\/visits\/[0-9a-f-]+$/);

  // Weeks of pregnancy are worked out from the LMP: 70 days = 10 weeks.
  await expect(page.getByText("10 weeks of pregnancy")).toBeVisible();

  // An LMP in the future is refused.
  const future = new Date(today.getTime() + 5 * 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel("Last menstrual period", { exact: true }).fill(future);
  await page.getByRole("button", { name: "Save" }).first().click();
  await expect(page.getByRole("alert").first()).toBeVisible();

  // The fill screen pre-fills what is already on file.
  await page.reload();
  await page
    .locator("li", { hasText: TEMPLATE_NAME })
    .getByRole("button", { name: /Fill/ })
    .click();
  await expect(page.getByLabel("Total living children")).toHaveValue("3");
  await expect(page.getByLabel("Living sons — age of each")).toHaveValue("4 years");
  await expect(page.getByLabel("Referred by (name and address)")).toHaveValue(/Dr Referrer Demo/);
  await expect(page.getByLabel("LMP / weeks of pregnancy")).toHaveValue(/10 weeks/);
  // Findings-type fields stay empty: typed at fill time, never stored.
  await expect(page.getByLabel("Result of the procedure (not saved anywhere else)")).toHaveValue(
    "",
  );
});
