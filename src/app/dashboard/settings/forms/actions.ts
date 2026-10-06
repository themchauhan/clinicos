"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getSessionProfile } from "@/lib/auth/session";
import { requireRole, requireActiveTenant, AuthError } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit/log";
import { MAX_FORM_TEMPLATE_BYTES, validateFile } from "@/lib/documents/file-validation";
import { readPdfPageSize } from "@/lib/documents/form-flatten";
import type { FormFieldInputType } from "@/types/database";

const SETTINGS_PATH = "/dashboard/settings/forms";

export interface FormTemplateFieldInput {
  fieldKey: string;
  label: string;
  inputType: FormFieldInputType;
  pageNumber: number;
  x: number;
  y: number;
  fontSize: number;
  displayOrder: number;
}

export interface SignatureBoxInput {
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** No image here, unlike SignatureBoxInput's conceptual twin -- the
 * seal image itself lives on the hospital (hospital_form_profile),
 * not the template; this is only ever the placement. */
export interface SealBoxInput {
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Same idea as SealBoxInput, for the doctor's own saved signature
 * image (lives on `doctors.signature_storage_path`) instead of the
 * hospital's seal. */
export interface DoctorSignatureBoxInput {
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FormTemplateFormState {
  error?: string;
}

/**
 * Creates a form template -- or, if a template with the same name
 * already exists, supersedes it as a new version (same convention as
 * createDocumentType in ../actions.ts: the old one is marked inactive,
 * never hard-deleted, since real signed documents may already
 * reference it).
 */
export async function createFormTemplate(
  _prevState: FormTemplateFormState,
  formData: FormData,
): Promise<FormTemplateFormState> {
  const profile = requireActiveTenant(requireRole(await getSessionProfile(), ["HOSPITAL_ADMIN"]));

  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    return { error: "Enter a name." };
  }
  const description = String(formData.get("description") ?? "").trim() || null;

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose the blank form PDF." };
  }

  const rawBuffer = Buffer.from(await file.arrayBuffer());
  const validated = validateFile(rawBuffer);
  if ("error" in validated) {
    return { error: validated.error };
  }
  if (validated.mime !== "application/pdf") {
    return { error: "Form templates must be uploaded as a PDF." };
  }
  if (rawBuffer.byteLength > MAX_FORM_TEMPLATE_BYTES) {
    return {
      error: `This PDF is ${(rawBuffer.byteLength / (1024 * 1024)).toFixed(1)} MB. Form templates must be ${MAX_FORM_TEMPLATE_BYTES / (1024 * 1024)} MB or smaller, because every filled copy of the form repeats the whole file. Re-export or compress the PDF (a lower scan quality is fine) and try again.`,
    };
  }

  let fields: FormTemplateFieldInput[];
  let signature: SignatureBoxInput;
  let seal: SealBoxInput | null;
  let doctorSignature: DoctorSignatureBoxInput | null;
  try {
    const layout = JSON.parse(String(formData.get("layout") ?? "{}"));
    fields = layout.fields;
    signature = layout.signature;
    seal = layout.seal ?? null;
    doctorSignature = layout.doctorSignature ?? null;
    if (!Array.isArray(fields) || fields.length === 0) {
      return { error: "Place at least one field on the form." };
    }
    if (!signature) {
      return { error: "Place the signature box on the form." };
    }
  } catch {
    return { error: "Could not read the field layout. Try again." };
  }

  const { pageWidth, pageHeight } = await readPdfPageSize(rawBuffer);
  const storagePath = `${profile.hospitalId}/form-templates/${randomUUID()}.pdf`;

  const supabase = await createClient();

  const { data: priorVersions } = await supabase
    .from("form_templates")
    .select("id, version")
    .eq("name", name);
  const nextVersion =
    priorVersions && priorVersions.length > 0
      ? Math.max(...priorVersions.map((v) => v.version)) + 1
      : 1;

  const { error: uploadError } = await supabase.storage
    .from("documents")
    .upload(storagePath, rawBuffer, { contentType: "application/pdf", upsert: false });
  if (uploadError) {
    return { error: "Could not upload the form. Try again." };
  }

  const { data: created, error: insertError } = await supabase
    .from("form_templates")
    .insert({
      name,
      description,
      storage_path: storagePath,
      page_width: pageWidth,
      page_height: pageHeight,
      version: nextVersion,
      effective_from: new Date().toISOString().slice(0, 10),
      signature_page: signature.pageNumber,
      signature_x: signature.x,
      signature_y: signature.y,
      signature_width: signature.width,
      signature_height: signature.height,
      seal_page: seal?.pageNumber ?? null,
      seal_x: seal?.x ?? null,
      seal_y: seal?.y ?? null,
      seal_width: seal?.width ?? null,
      seal_height: seal?.height ?? null,
      doctor_signature_page: doctorSignature?.pageNumber ?? null,
      doctor_signature_x: doctorSignature?.x ?? null,
      doctor_signature_y: doctorSignature?.y ?? null,
      doctor_signature_width: doctorSignature?.width ?? null,
      doctor_signature_height: doctorSignature?.height ?? null,
    })
    .select("id")
    .single();

  if (insertError || !created) {
    await supabase.storage.from("documents").remove([storagePath]);
    return { error: "Could not save the form template. Try again." };
  }

  const { error: fieldsError } = await supabase.from("form_template_fields").insert(
    fields.map((f) => ({
      form_template_id: created.id,
      field_key: f.fieldKey,
      label: f.label,
      input_type: f.inputType,
      page_number: f.pageNumber,
      x: f.x,
      y: f.y,
      font_size: f.fontSize,
      display_order: f.displayOrder,
    })),
  );

  if (fieldsError) {
    // The template row exists but its fields don't -- nothing else
    // references it yet (it was just created), so a hard delete here
    // is cleanup of a failed operation, not a rule-6 violation.
    await supabase.from("form_templates").delete().eq("id", created.id);
    await supabase.storage.from("documents").remove([storagePath]);
    return { error: "Could not save the form's fields. Try again." };
  }

  if (priorVersions && priorVersions.length > 0) {
    await supabase
      .from("form_templates")
      .update({ active: false })
      .in(
        "id",
        priorVersions.map((v) => v.id),
      );
  }

  await logAudit({
    action: "form_template.created",
    targetType: "form_template",
    targetId: created.id,
    metadata: { name, version: nextVersion, superseded: priorVersions?.length ?? 0 },
  });
  revalidatePath(SETTINGS_PATH);
  return {};
}

// Returns void (throws on failure) rather than {error?} so this can be
// bound directly as a <form action={...}>, same as setDoctorStatus.
export async function setFormTemplateActive(
  formTemplateId: string,
  active: boolean,
): Promise<void> {
  requireActiveTenant(requireRole(await getSessionProfile(), ["HOSPITAL_ADMIN"]));

  const supabase = await createClient();
  const { error } = await supabase
    .from("form_templates")
    .update({ active })
    .eq("id", formTemplateId);

  if (error) {
    throw new AuthError("Could not update that form.", 403);
  }

  await logAudit({
    action: "form_template.status_changed",
    targetType: "form_template",
    targetId: formTemplateId,
    metadata: { active },
  });
  revalidatePath(SETTINGS_PATH);
}

/**
 * Repositions an existing template's fields/signature/seal in place --
 * unlike createFormTemplate, this never supersedes/creates a new
 * version, because it doesn't touch the underlying PDF. Already-
 * flattened documents are independent baked bytes (see form-flatten.ts),
 * so changing where a field sits on the *blank* template can never
 * retroactively change anything already signed.
 */
export async function updateFormTemplateFields(
  formTemplateId: string,
  _prevState: FormTemplateFormState,
  formData: FormData,
): Promise<FormTemplateFormState> {
  requireActiveTenant(requireRole(await getSessionProfile(), ["HOSPITAL_ADMIN"]));

  let fields: FormTemplateFieldInput[];
  let signature: SignatureBoxInput;
  let seal: SealBoxInput | null;
  let doctorSignature: DoctorSignatureBoxInput | null;
  try {
    const layout = JSON.parse(String(formData.get("layout") ?? "{}"));
    fields = layout.fields;
    signature = layout.signature;
    seal = layout.seal ?? null;
    doctorSignature = layout.doctorSignature ?? null;
    if (!Array.isArray(fields) || fields.length === 0) {
      return { error: "Place at least one field on the form." };
    }
    if (!signature) {
      return { error: "Place the signature box on the form." };
    }
  } catch {
    return { error: "Could not read the field layout. Try again." };
  }

  const supabase = await createClient();

  const { error: updateError } = await supabase
    .from("form_templates")
    .update({
      signature_page: signature.pageNumber,
      signature_x: signature.x,
      signature_y: signature.y,
      signature_width: signature.width,
      signature_height: signature.height,
      seal_page: seal?.pageNumber ?? null,
      seal_x: seal?.x ?? null,
      seal_y: seal?.y ?? null,
      seal_width: seal?.width ?? null,
      seal_height: seal?.height ?? null,
      doctor_signature_page: doctorSignature?.pageNumber ?? null,
      doctor_signature_x: doctorSignature?.x ?? null,
      doctor_signature_y: doctorSignature?.y ?? null,
      doctor_signature_width: doctorSignature?.width ?? null,
      doctor_signature_height: doctorSignature?.height ?? null,
    })
    .eq("id", formTemplateId);
  if (updateError) {
    return { error: "Could not save the signature/seal position. Try again." };
  }

  const { error: deleteError } = await supabase
    .from("form_template_fields")
    .delete()
    .eq("form_template_id", formTemplateId);
  if (deleteError) {
    return { error: "Could not save the fields. Try again." };
  }

  const { error: insertError } = await supabase.from("form_template_fields").insert(
    fields.map((f) => ({
      form_template_id: formTemplateId,
      field_key: f.fieldKey,
      label: f.label,
      input_type: f.inputType,
      page_number: f.pageNumber,
      x: f.x,
      y: f.y,
      font_size: f.fontSize,
      display_order: f.displayOrder,
    })),
  );
  if (insertError) {
    return { error: "Could not save the fields. Try again." };
  }

  await logAudit({
    action: "form_template.fields_updated",
    targetType: "form_template",
    targetId: formTemplateId,
  });
  revalidatePath(SETTINGS_PATH);
  revalidatePath(`${SETTINGS_PATH}/${formTemplateId}/edit`);
  return {};
}
