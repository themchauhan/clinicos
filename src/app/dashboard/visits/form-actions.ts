"use server";

import { randomUUID, createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getSessionProfile } from "@/lib/auth/session";
import { requireRole, requireActiveTenant } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit/log";
import { flattenFormTemplate } from "@/lib/documents/form-flatten";
import { buildFlattenParts } from "@/lib/documents/form-render";

const SIGNED_URL_TTL_SECONDS = 60;

/** Signed URL for the blank template PDF -- shown to staff/patient
 * during fill+sign, same private-bucket pattern as
 * getDocumentViewUrl. */
export async function getFormTemplateViewUrl(
  formTemplateId: string,
): Promise<{ url: string } | { error: string }> {
  requireActiveTenant(requireRole(await getSessionProfile(), ["HOSPITAL_ADMIN", "RECEPTIONIST"]));

  const supabase = await createClient();
  const { data: template } = await supabase
    .from("form_templates")
    .select("storage_path")
    .eq("id", formTemplateId)
    .maybeSingle();
  if (!template) {
    return { error: "Form not found." };
  }

  const { data: signed, error } = await supabase.storage
    .from("documents")
    .createSignedUrl(template.storage_path, SIGNED_URL_TTL_SECONDS);
  if (error || !signed) {
    return { error: "Could not load the form." };
  }
  return { url: signed.signedUrl };
}

/**
 * Flattens the filled values and signature directly onto the real
 * uploaded template (see form-flatten.ts) and saves the result as a
 * `documents` row -- the flattened PDF is the only record kept; field
 * values themselves aren't persisted anywhere separately.
 */
export async function submitFilledForm(
  target: { patientId: string; visitId?: string; formTemplateId: string; revalidate: string },
  fieldValues: Record<string, string>,
  signatureDataUrl: string,
): Promise<{ error?: string }> {
  const profile = requireActiveTenant(
    requireRole(await getSessionProfile(), ["HOSPITAL_ADMIN", "RECEPTIONIST"]),
  );

  const supabase = await createClient();
  const { data: template } = await supabase
    .from("form_templates")
    .select("*, form_template_fields(*)")
    .eq("id", target.formTemplateId)
    .maybeSingle();

  if (!template) {
    return { error: "Form not found." };
  }

  const { data: blankFile, error: downloadError } = await supabase.storage
    .from("documents")
    .download(template.storage_path);
  if (downloadError || !blankFile) {
    return { error: "Could not load the blank form. Try again." };
  }

  const signatureBase64 = signatureDataUrl.split(",")[1];
  if (!signatureBase64) {
    return { error: "Missing signature." };
  }

  const blankPdf = Buffer.from(await blankFile.arrayBuffer());
  const signaturePng = Buffer.from(signatureBase64, "base64");

  const parts = await buildFlattenParts(supabase, template, fieldValues, {
    hospitalId: profile.hospitalId!,
    visitId: target.visitId,
  });

  const flattened = await flattenFormTemplate({
    blankPdf,
    fields: parts.fields,
    signature: {
      pageNumber: template.signature_page,
      x: template.signature_x,
      y: template.signature_y,
      width: template.signature_width,
      height: template.signature_height,
      signaturePng,
    },
    seals: parts.seals,
    doctorSignatures: parts.doctorSignatures,
  });

  const sha256 = createHash("sha256").update(flattened).digest("hex");
  const storagePath = `${profile.hospitalId}/${target.patientId}/${randomUUID()}.pdf`;

  const { error: uploadError } = await supabase.storage
    .from("documents")
    .upload(storagePath, flattened, { contentType: "application/pdf", upsert: false });
  if (uploadError) {
    return { error: "Could not save the signed form. Try again." };
  }

  const { data: created, error: insertError } = await supabase
    .from("documents")
    .insert({
      patient_id: target.patientId,
      visit_id: target.visitId ?? null,
      form_template_id: target.formTemplateId,
      file_name: `${template.name}.pdf`,
      file_type: "application/pdf",
      storage_path: storagePath,
      file_size: flattened.byteLength,
      sha256,
    })
    .select("id")
    .single();

  if (insertError || !created) {
    await supabase.storage.from("documents").remove([storagePath]);
    return { error: "Could not save the signed form. Try again." };
  }

  await logAudit({
    action: "form.signed",
    targetType: "document",
    targetId: created.id,
    metadata: { form_template_id: target.formTemplateId },
  });

  revalidatePath(target.revalidate);
  return {};
}
