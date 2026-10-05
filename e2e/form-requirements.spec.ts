import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { cleanupTestPatients } from "./utils/cleanup-test-patients";
import { createPatientViaUi } from "./utils/create-patient";

const DEMO_PASSWORD = "demo-password-123!";
const CLARITY_ADMIN_EMAIL = "admin@clarity.test";
const FORM_NAME = `E2E Form Req Form ${Date.now()}`;

function serviceRole() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

test.beforeAll(async () => {
  await cleanupTestPatients("E2E Form Req Patient");
  const sr = serviceRole();
  const { data: hospital } = await sr
    .from("hospitals")
    .select("id")
    .eq("name", "Clarity Diagnostics")
    .single();
  const { data: visitType } = await sr
    .from("visit_types")
    .select("id")
    .eq("hospital_id", hospital!.id)
    .eq("name", "Pregnancy/Obstetric USG")
    .single();
  // The page only lists the form; nothing opens the PDF unless it is
  // clicked, so a placeholder storage path is enough here.
  const { data: template, error } = await sr
    .from("form_templates")
    .insert({
      hospital_id: hospital!.id,
      name: FORM_NAME,
      storage_path: `${hospital!.id}/form-templates/e2e-placeholder.pdf`,
      page_width: 595,
      page_height: 842,
      signature_x: 50,
      signature_y: 100,
      signature_width: 150,
      signature_height: 50,
    })
    .select("id")
    .single();
  if (error) throw error;
  const { error: ruleError } = await sr.from("visit_type_form_requirements").insert({
    hospital_id: hospital!.id,
    visit_type_id: visitType!.id,
    form_template_id: template!.id,
    required: true,
  });
  if (ruleError) throw ruleError;
});

test.afterAll(async () => {
  // Visits (and with them their requirement snapshots) go first, then the template.
  await cleanupTestPatients("E2E Form Req Patient");
  await serviceRole().from("form_templates").delete().eq("name", FORM_NAME);
});

test("a form required by the visit type is listed above the upload row with its status, and counts as pending", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(CLARITY_ADMIN_EMAIL);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  const name = `E2E Form Req Patient ${Date.now()}`;
  await createPatientViaUi(page, { name });
  // Gender only drives a soft hint on the visit page.
  await serviceRole().from("patients").update({ gender: "FEMALE" }).eq("name", name);

  await page.getByRole("link", { name: "New visit" }).click();
  await page.getByLabel("Visit type").selectOption({ label: "Pregnancy/Obstetric USG" });
  await page.getByRole("button", { name: "Create visit" }).click();
  await expect(page).toHaveURL(/\/dashboard\/visits\/[0-9a-f-]+$/);

  await expect(page.getByText("Female patient on a USG visit")).toBeVisible();
  const formRow = page.getByRole("listitem").filter({ hasText: FORM_NAME });
  await expect(formRow.getByText("Required — not filled")).toBeVisible();
  await expect(formRow.getByRole("button", { name: "Fill & sign" })).toBeVisible();

  // Forms come first: their block sits above the file chooser.
  const formsBox = await page.getByRole("heading", { name: "Forms for this visit" }).boundingBox();
  const chooserBox = await page.getByLabel("Document type").boundingBox();
  expect(formsBox!.y).toBeLessThan(chooserBox!.y);

  // The unsigned required form appears on the pending list.
  await page.goto("/dashboard/documents");
  await expect(page.getByText(`${FORM_NAME} (form)`).last()).toBeVisible();
});
