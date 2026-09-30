"use server";

import { randomUUID, createHash } from "node:crypto";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { resolveScanSession } from "@/lib/scan/resolve-session";
import { validateFile } from "@/lib/documents/file-validation";
import { stripExifIfImage } from "@/lib/documents/strip-exif";
import { logAuditFromServiceRole } from "@/lib/audit/log";
import { compositeSignatureWithDeclaration } from "@/lib/documents/signature-composite";
import { flattenFormTemplate, type SealPlacement } from "@/lib/documents/form-flatten";

// Nothing in this file trusts a Supabase Auth session — there isn't
// one. The raw token from the QR/link is the only credential; every
// action here starts by re-resolving it and treats any failure to
// resolve (wrong token, expired, already completed/cancelled) the
// same way, so a stale link can't be used to distinguish *why* it no
// longer works.

const MAX_PAGES_PER_SESSION = 20;

export type ScanSessionInfoResult =
  | {
      kind: "document";
      hospitalName: string;
      patientName: string;
      documentTypeName: string;
      documentTypeDescription: string | null;
      requiresSignature: boolean;
      existingPages: { id: string; pageNo: number }[];
    }
  | {
      kind: "form";
      hospitalName: string;
      patientName: string;
      formTemplateName: string;
      formTemplateDescription: string | null;
      fields: { label: string; value: string }[];
    }
  | { error: "invalid" | "expired" | "completed" };

export async function getScanSessionInfo(rawToken: string): Promise<ScanSessionInfoResult> {
  const supabase = createServiceRoleClient();
  const session = await resolveScanSession(supabase, rawToken);
  if (!session) {
    return { error: await classifyUnresolvedToken(rawToken) };
  }

  const [{ data: hospital }, { data: patient }] = await Promise.all([
    supabase.from("hospitals").select("name").eq("id", session.hospital_id).single(),
    supabase.from("patients").select("name").eq("id", session.patient_id).single(),
  ]);
  const hospitalName = hospital?.name ?? "—";
  const patientName = patient?.name ?? "—";

  if (session.form_template_id) {
    const [{ data: template }, { data: templateFields }] = await Promise.all([
      supabase
        .from("form_templates")
        .select("name, description")
        .eq("id", session.form_template_id)
        .single(),
      supabase
        .from("form_template_fields")
        .select("field_key, label, display_order")
        .eq("form_template_id", session.form_template_id)
        .order("display_order", { ascending: true }),
    ]);
    const values = (session.field_values ?? {}) as Record<string, string>;

    return {
      kind: "form",
      hospitalName,
      patientName,
      formTemplateName: template?.name ?? "—",
      formTemplateDescription: template?.description ?? null,
      fields: (templateFields ?? []).map((f) => ({
        label: f.label,
        value: values[f.field_key] ?? "",
      })),
    };
  }

  const [{ data: documentType }, { data: pages }] = await Promise.all([
    supabase
      .from("document_types")
      .select("name, description, requires_signature")
      .eq("id", session.document_type_id!)
      .single(),
    supabase
      .from("documents")
      .select("id, page_no")
      .eq("scan_session_id", session.id)
      .is("deleted_at", null)
      .order("page_no", { ascending: true }),
  ]);

  return {
    kind: "document",
    hospitalName,
    patientName,
    documentTypeName: documentType?.name ?? "—",
    documentTypeDescription: documentType?.description ?? null,
    requiresSignature: documentType?.requires_signature ?? false,
    existingPages: (pages ?? []).map((p) => ({ id: p.id, pageNo: p.page_no ?? 0 })),
  };
}

/**
 * A resolved-to-null token is either wrong, expired, or belongs to an
 * already-finished session — distinguish those only for the UI's
 * benefit (better UX), by re-looking the row up without the
 * PENDING/expiry filter. Never used to make an authorization
 * decision; resolveScanSession() already made that call.
 */
async function classifyUnresolvedToken(
  rawToken: string,
): Promise<"invalid" | "expired" | "completed"> {
  const supabase = createServiceRoleClient();
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const { data } = await supabase
    .from("scan_sessions")
    .select("status, expires_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (!data) return "invalid";
  if (data.status !== "PENDING") return "completed";
  if (new Date(data.expires_at) <= new Date()) return "expired";
  return "invalid";
}

export interface SubmitScanPageResult {
  documentId?: string;
  error?: string;
}

export async function submitScanPage(
  rawToken: string,
  formData: FormData,
): Promise<SubmitScanPageResult> {
  const supabase = createServiceRoleClient();
  const session = await resolveScanSession(supabase, rawToken);
  if (!session) {
    return { error: "This scan session is no longer active." };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a photo to upload." };
  }

  const rawBuffer = Buffer.from(await file.arrayBuffer());
  const validated = validateFile(rawBuffer);
  if ("error" in validated) {
    return { error: validated.error };
  }

  const { count: existingCount } = await supabase
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq("scan_session_id", session.id)
    .is("deleted_at", null);

  if ((existingCount ?? 0) >= MAX_PAGES_PER_SESSION) {
    return { error: `A single scan session can hold at most ${MAX_PAGES_PER_SESSION} pages.` };
  }

  const finalBuffer = await stripExifIfImage(rawBuffer, validated.mime);
  const sha256 = createHash("sha256").update(finalBuffer).digest("hex");
  const storagePath = `${session.hospital_id}/${session.patient_id}/${randomUUID()}.${validated.ext}`;

  const { error: uploadError } = await supabase.storage
    .from("documents")
    .upload(storagePath, finalBuffer, { contentType: validated.mime, upsert: false });
  if (uploadError) {
    return { error: "Could not upload the photo. Try again." };
  }

  const { data: created, error: insertError } = await supabase
    .from("documents")
    .insert({
      hospital_id: session.hospital_id,
      patient_id: session.patient_id,
      visit_id: session.visit_id,
      document_type_id: session.document_type_id,
      file_name: file.name || `page-${(existingCount ?? 0) + 1}.${validated.ext}`,
      file_type: validated.mime,
      storage_path: storagePath,
      file_size: finalBuffer.byteLength,
      sha256,
      page_no: (existingCount ?? 0) + 1,
      scan_session_id: session.id,
      uploaded_by: session.created_by,
    })
    .select("id")
    .single();

  if (insertError || !created) {
    await supabase.storage.from("documents").remove([storagePath]);
    return { error: "Could not save the photo. Try again." };
  }

  await logAuditFromServiceRole({
    hospitalId: session.hospital_id,
    userId: session.created_by,
    action: "document.uploaded",
    targetType: "document",
    targetId: created.id,
    metadata: { document_type_id: session.document_type_id, via: "phone_scan" },
  });

  return { documentId: created.id };
}

export async function submitScanSignature(
  rawToken: string,
  signatureDataUrl: string,
): Promise<SubmitScanPageResult> {
  const supabase = createServiceRoleClient();
  const session = await resolveScanSession(supabase, rawToken);
  if (!session) {
    return { error: "This scan session is no longer active." };
  }

  const match = /^data:image\/png;base64,(.+)$/.exec(signatureDataUrl);
  if (!match) {
    return { error: "Invalid signature data." };
  }
  const rawSignature = Buffer.from(match[1], "base64");

  const [{ data: documentType }, { data: patient }] = await Promise.all([
    supabase
      .from("document_types")
      .select("name, description")
      .eq("id", session.document_type_id!)
      .single(),
    supabase.from("patients").select("name").eq("id", session.patient_id).single(),
  ]);

  const compositeBuffer = await compositeSignatureWithDeclaration({
    signaturePng: rawSignature,
    documentTypeName: documentType?.name ?? "Signature",
    declarationText: documentType?.description ?? null,
    patientName: patient?.name ?? "Patient",
  });

  const validated = validateFile(compositeBuffer);
  if ("error" in validated) {
    return { error: validated.error };
  }

  const sha256 = createHash("sha256").update(compositeBuffer).digest("hex");
  const storagePath = `${session.hospital_id}/${session.patient_id}/${randomUUID()}.png`;

  const { error: uploadError } = await supabase.storage
    .from("documents")
    .upload(storagePath, compositeBuffer, { contentType: "image/png", upsert: false });
  if (uploadError) {
    return { error: "Could not upload the signature. Try again." };
  }

  const { data: created, error: insertError } = await supabase
    .from("documents")
    .insert({
      hospital_id: session.hospital_id,
      patient_id: session.patient_id,
      visit_id: session.visit_id,
      document_type_id: session.document_type_id,
      file_name: `signature-${randomUUID()}.png`,
      file_type: "image/png",
      storage_path: storagePath,
      file_size: compositeBuffer.byteLength,
      sha256,
      page_no: 1,
      scan_session_id: session.id,
      uploaded_by: session.created_by,
    })
    .select("id")
    .single();

  if (insertError || !created) {
    await supabase.storage.from("documents").remove([storagePath]);
    return { error: "Could not save the signature. Try again." };
  }

  await logAuditFromServiceRole({
    hospitalId: session.hospital_id,
    userId: session.created_by,
    action: "document.uploaded",
    targetType: "document",
    targetId: created.id,
    metadata: { document_type_id: session.document_type_id, via: "phone_signature" },
  });

  await supabase
    .from("scan_sessions")
    .update({ status: "COMPLETED", completed_at: new Date().toISOString() })
    .eq("id", session.id);

  return { documentId: created.id };
}

/**
 * Same idea as submitScanSignature, for a filled form template
 * instead of a document-type declaration -- flattens the field
 * values + signature directly onto the real uploaded PDF (the same
 * flattenFormTemplate() the same-device path in
 * src/app/dashboard/visits/form-actions.ts uses), via the
 * service-role client since the phone has no session.
 */
export async function submitFormSignSignature(
  rawToken: string,
  signatureDataUrl: string,
): Promise<SubmitScanPageResult> {
  const supabase = createServiceRoleClient();
  const session = await resolveScanSession(supabase, rawToken);
  if (!session || !session.form_template_id) {
    return { error: "This signing session is no longer active." };
  }

  const signatureBase64 = signatureDataUrl.split(",")[1];
  if (!signatureBase64) {
    return { error: "Invalid signature data." };
  }

  const { data: template } = await supabase
    .from("form_templates")
    .select("*, form_template_fields(*)")
    .eq("id", session.form_template_id)
    .single();
  if (!template) {
    return { error: "Form not found." };
  }

  const { data: blankFile, error: downloadError } = await supabase.storage
    .from("documents")
    .download(template.storage_path);
  if (downloadError || !blankFile) {
    return { error: "Could not load the blank form. Try again." };
  }

  const blankPdf = Buffer.from(await blankFile.arrayBuffer());
  const signaturePng = Buffer.from(signatureBase64, "base64");
  const values = (session.field_values ?? {}) as Record<string, string>;

  // Optional: same graceful-skip rule as the same-device path in
  // src/app/dashboard/visits/form-actions.ts -- only drawn when both
  // the template has a seal box and the hospital has uploaded a seal.
  let seal: SealPlacement | undefined;
  if (template.seal_page) {
    const { data: hospitalProfile } = await supabase
      .from("hospital_form_profile")
      .select("seal_storage_path")
      .eq("hospital_id", session.hospital_id)
      .maybeSingle();
    if (hospitalProfile?.seal_storage_path) {
      const { data: sealFile } = await supabase.storage
        .from("documents")
        .download(hospitalProfile.seal_storage_path);
      if (sealFile) {
        seal = {
          pageNumber: template.seal_page,
          x: template.seal_x!,
          y: template.seal_y!,
          width: template.seal_width!,
          height: template.seal_height!,
          sealImage: Buffer.from(await sealFile.arrayBuffer()),
        };
      }
    }
  }

  const flattened = await flattenFormTemplate({
    blankPdf,
    fields: (template.form_template_fields ?? []).map((f) => ({
      pageNumber: f.page_number,
      x: f.x,
      y: f.y,
      fontSize: f.font_size,
      multiline: f.input_type === "textarea",
      value: values[f.field_key] ?? "",
    })),
    signature: {
      pageNumber: template.signature_page,
      x: template.signature_x,
      y: template.signature_y,
      width: template.signature_width,
      height: template.signature_height,
      signaturePng,
    },
    seal,
  });

  const sha256 = createHash("sha256").update(flattened).digest("hex");
  const storagePath = `${session.hospital_id}/${session.patient_id}/${randomUUID()}.pdf`;

  const { error: uploadError } = await supabase.storage
    .from("documents")
    .upload(storagePath, flattened, { contentType: "application/pdf", upsert: false });
  if (uploadError) {
    return { error: "Could not save the signed form. Try again." };
  }

  const { data: created, error: insertError } = await supabase
    .from("documents")
    .insert({
      hospital_id: session.hospital_id,
      patient_id: session.patient_id,
      visit_id: session.visit_id,
      form_template_id: session.form_template_id,
      file_name: `${template.name}.pdf`,
      file_type: "application/pdf",
      storage_path: storagePath,
      file_size: flattened.byteLength,
      sha256,
      scan_session_id: session.id,
      uploaded_by: session.created_by,
    })
    .select("id")
    .single();

  if (insertError || !created) {
    await supabase.storage.from("documents").remove([storagePath]);
    return { error: "Could not save the signed form. Try again." };
  }

  await logAuditFromServiceRole({
    hospitalId: session.hospital_id,
    userId: session.created_by,
    action: "form.signed",
    targetType: "document",
    targetId: created.id,
    metadata: { form_template_id: session.form_template_id, via: "phone_signature" },
  });

  await supabase
    .from("scan_sessions")
    .update({ status: "COMPLETED", completed_at: new Date().toISOString() })
    .eq("id", session.id);

  return { documentId: created.id };
}

export async function deleteScanPage(
  rawToken: string,
  documentId: string,
): Promise<{ error?: string }> {
  const supabase = createServiceRoleClient();
  const session = await resolveScanSession(supabase, rawToken);
  if (!session) {
    return { error: "This scan session is no longer active." };
  }

  const { error } = await supabase
    .from("documents")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", documentId)
    .eq("scan_session_id", session.id);

  if (error) {
    return { error: "Could not remove that page." };
  }
  return {};
}

export async function reorderScanPage(
  rawToken: string,
  documentId: string,
  direction: "up" | "down",
): Promise<{ error?: string }> {
  const supabase = createServiceRoleClient();
  const session = await resolveScanSession(supabase, rawToken);
  if (!session) {
    return { error: "This scan session is no longer active." };
  }

  const { data: pages } = await supabase
    .from("documents")
    .select("id, page_no")
    .eq("scan_session_id", session.id)
    .is("deleted_at", null)
    .order("page_no", { ascending: true });

  const ordered = pages ?? [];
  const index = ordered.findIndex((p) => p.id === documentId);
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (index === -1 || swapWith < 0 || swapWith >= ordered.length) {
    return {};
  }

  const a = ordered[index];
  const b = ordered[swapWith];
  await Promise.all([
    supabase.from("documents").update({ page_no: b.page_no }).eq("id", a.id),
    supabase.from("documents").update({ page_no: a.page_no }).eq("id", b.id),
  ]);
  return {};
}

export async function finishScanSession(rawToken: string): Promise<{ error?: string }> {
  const supabase = createServiceRoleClient();
  const session = await resolveScanSession(supabase, rawToken);
  if (!session) {
    return { error: "This scan session is no longer active." };
  }

  const { error } = await supabase
    .from("scan_sessions")
    .update({ status: "COMPLETED", completed_at: new Date().toISOString() })
    .eq("id", session.id);

  if (error) {
    return { error: "Could not finish this session." };
  }
  return {};
}
