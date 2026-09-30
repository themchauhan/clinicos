import { describe, expect, it } from "vitest";
import { SEED_ACCOUNTS, signInAs } from "./helpers";

// RLS/Storage tests don't need a real, parseable PDF -- just bytes to
// upload (same reasoning as documents.rls.test.ts's FAKE_JPEG).
const FAKE_PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);

async function makeSunriseFormTemplate(sunrise: Awaited<ReturnType<typeof signInAs>>) {
  const { data: patient } = await sunrise
    .from("patients")
    .insert({ name: "Form Template Test Patient" })
    .select()
    .single();

  const storagePath = `${patient!.hospital_id}/form-templates/${crypto.randomUUID()}.pdf`;
  const { error: uploadError } = await sunrise.storage
    .from("documents")
    .upload(storagePath, FAKE_PDF, { contentType: "application/pdf" });
  if (uploadError) throw uploadError;

  const { data: template, error: templateError } = await sunrise
    .from("form_templates")
    .insert({
      name: "Test Consent Form",
      storage_path: storagePath,
      page_width: 595,
      page_height: 842,
      signature_x: 50,
      signature_y: 100,
      signature_width: 150,
      signature_height: 50,
    })
    .select()
    .single();
  if (templateError || !template) throw templateError ?? new Error("failed to create form template");

  const { data: field, error: fieldError } = await sunrise
    .from("form_template_fields")
    .insert({
      form_template_id: template.id,
      field_key: "patient_name",
      label: "Patient name",
      x: 50,
      y: 700,
    })
    .select()
    .single();
  if (fieldError || !field) throw fieldError ?? new Error("failed to create form template field");

  return { patient: patient!, template, field, storagePath };
}

describe("form_templates RLS", () => {
  it("happy path: authorized staff can create a template with fields and read it back", async () => {
    const sunrise = await signInAs(SEED_ACCOUNTS.sunrise.admin);
    const { template, field } = await makeSunriseFormTemplate(sunrise);

    const { data: reopened } = await sunrise
      .from("form_templates")
      .select("*, form_template_fields(*)")
      .eq("id", template.id)
      .single();
    expect(reopened?.name).toBe("Test Consent Form");
    expect(reopened?.form_template_fields?.[0]?.id).toBe(field.id);
  });

  it("cross-tenant: another hospital cannot see the template or its fields", async () => {
    const sunrise = await signInAs(SEED_ACCOUNTS.sunrise.admin);
    const { template } = await makeSunriseFormTemplate(sunrise);

    const clarity = await signInAs(SEED_ACCOUNTS.clarity.admin);
    const { data: templates } = await clarity.from("form_templates").select("*").eq("id", template.id);
    expect(templates).toHaveLength(0);

    const { data: fields } = await clarity
      .from("form_template_fields")
      .select("*")
      .eq("form_template_id", template.id);
    expect(fields).toHaveLength(0);
  });

  it("cross-tenant: another hospital cannot read the blank template's Storage object", async () => {
    const sunrise = await signInAs(SEED_ACCOUNTS.sunrise.admin);
    const { storagePath } = await makeSunriseFormTemplate(sunrise);

    const clarity = await signInAs(SEED_ACCOUNTS.clarity.admin);
    const { data, error } = await clarity.storage.from("documents").createSignedUrl(storagePath, 60);
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });

  it("no DELETE policy on form_templates -- retire via active=false instead", async () => {
    const sunrise = await signInAs(SEED_ACCOUNTS.sunrise.admin);
    const { template } = await makeSunriseFormTemplate(sunrise);

    const { data: deleted } = await sunrise
      .from("form_templates")
      .delete()
      .eq("id", template.id)
      .select();
    expect(deleted).toHaveLength(0);

    const { data: updated, error } = await sunrise
      .from("form_templates")
      .update({ active: false })
      .eq("id", template.id)
      .select()
      .single();
    expect(error).toBeNull();
    expect(updated?.active).toBe(false);
  });

  it("form_template_fields ARE hard-deletable (position metadata, not a patient record)", async () => {
    const sunrise = await signInAs(SEED_ACCOUNTS.sunrise.admin);
    const { field } = await makeSunriseFormTemplate(sunrise);

    const { data: deleted, error } = await sunrise
      .from("form_template_fields")
      .delete()
      .eq("id", field.id)
      .select();
    expect(error).toBeNull();
    expect(deleted).toHaveLength(1);
  });

  it("a document must come from exactly one of document_type_id / form_template_id", async () => {
    const sunrise = await signInAs(SEED_ACCOUNTS.sunrise.admin);
    const { patient, template } = await makeSunriseFormTemplate(sunrise);
    const { data: idProofType } = await sunrise
      .from("document_types")
      .select("id")
      .eq("name", "ID Proof")
      .single();

    const storagePath = `${patient.hospital_id}/${patient.id}/${crypto.randomUUID()}.pdf`;
    await sunrise.storage
      .from("documents")
      .upload(storagePath, FAKE_PDF, { contentType: "application/pdf" });

    const base = {
      patient_id: patient.id,
      file_name: "x.pdf",
      file_type: "application/pdf",
      storage_path: storagePath,
      file_size: FAKE_PDF.byteLength,
      sha256: "test-hash",
    };

    const { error: neitherError } = await sunrise.from("documents").insert(base);
    expect(neitherError).not.toBeNull();

    const { error: bothError } = await sunrise
      .from("documents")
      .insert({ ...base, document_type_id: idProofType!.id, form_template_id: template.id });
    expect(bothError).not.toBeNull();

    const { error: formOnlyError } = await sunrise
      .from("documents")
      .insert({ ...base, form_template_id: template.id });
    expect(formOnlyError).toBeNull();
  });

  it("a scan_session must come from exactly one of document_type_id / form_template_id", async () => {
    const sunrise = await signInAs(SEED_ACCOUNTS.sunrise.admin);
    const { patient, template } = await makeSunriseFormTemplate(sunrise);
    const { data: idProofType } = await sunrise
      .from("document_types")
      .select("id")
      .eq("name", "ID Proof")
      .single();

    const base = {
      patient_id: patient.id,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    };

    const { error: neitherError } = await sunrise
      .from("scan_sessions")
      .insert({ ...base, token_hash: crypto.randomUUID() });
    expect(neitherError).not.toBeNull();

    const { error: bothError } = await sunrise.from("scan_sessions").insert({
      ...base,
      token_hash: crypto.randomUUID(),
      document_type_id: idProofType!.id,
      form_template_id: template.id,
      field_values: { patient_name: "Test" },
    });
    expect(bothError).not.toBeNull();

    const { error: formOnlyError } = await sunrise.from("scan_sessions").insert({
      ...base,
      token_hash: crypto.randomUUID(),
      form_template_id: template.id,
      field_values: { patient_name: "Test" },
    });
    expect(formOnlyError).toBeNull();

    const { error: documentOnlyError } = await sunrise.from("scan_sessions").insert({
      ...base,
      token_hash: crypto.randomUUID(),
      document_type_id: idProofType!.id,
    });
    expect(documentOnlyError).toBeNull();
  });
});
