"use server";

import { randomUUID, createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getSessionProfile } from "@/lib/auth/session";
import { requireRole, requireActiveTenant } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit/log";
import { validateFile } from "@/lib/documents/file-validation";
import { stripExifIfImage } from "@/lib/documents/strip-exif";

const SIGNED_URL_TTL_SECONDS = 60;

export interface UploadDocumentState {
  error?: string;
}

export async function uploadDocument(
  target: { patientId: string; visitId?: string; revalidate: string },
  _prevState: UploadDocumentState,
  formData: FormData,
): Promise<UploadDocumentState> {
  const profile = requireActiveTenant(
    requireRole(await getSessionProfile(), ["HOSPITAL_ADMIN", "RECEPTIONIST"]),
  );

  const documentTypeId = String(formData.get("documentTypeId") ?? "").trim();
  if (!documentTypeId) {
    return { error: "Choose a document type." };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a file to upload." };
  }

  const rawBuffer = Buffer.from(await file.arrayBuffer());
  const validated = validateFile(rawBuffer);
  if ("error" in validated) {
    return { error: validated.error };
  }

  const finalBuffer = await stripExifIfImage(rawBuffer, validated.mime);
  const sha256 = createHash("sha256").update(finalBuffer).digest("hex");
  const storagePath = `${profile.hospitalId}/${target.patientId}/${randomUUID()}.${validated.ext}`;

  const supabase = await createClient();

  const { error: uploadError } = await supabase.storage
    .from("documents")
    .upload(storagePath, finalBuffer, { contentType: validated.mime, upsert: false });
  if (uploadError) {
    return { error: "Could not upload the file. Try again." };
  }

  const { data: created, error: insertError } = await supabase
    .from("documents")
    .insert({
      patient_id: target.patientId,
      visit_id: target.visitId ?? null,
      document_type_id: documentTypeId,
      file_name: file.name,
      file_type: validated.mime,
      storage_path: storagePath,
      file_size: finalBuffer.byteLength,
      sha256,
    })
    .select("id")
    .single();

  if (insertError || !created) {
    // Best-effort cleanup so a failed insert doesn't leave an orphaned
    // object with no corresponding row / RLS-visible metadata.
    await supabase.storage.from("documents").remove([storagePath]);
    return { error: "Could not save the document. Try again." };
  }

  await logAudit({
    action: "document.uploaded",
    targetType: "document",
    targetId: created.id,
    metadata: { document_type_id: documentTypeId },
  });

  revalidatePath(target.revalidate);
  return {};
}

export async function getDocumentViewUrl(
  documentId: string,
): Promise<{ url: string } | { error: string }> {
  requireActiveTenant(requireRole(await getSessionProfile(), ["HOSPITAL_ADMIN", "RECEPTIONIST"]));

  const supabase = await createClient();
  const { data: doc } = await supabase
    .from("documents")
    .select("storage_path, document_types(sensitive), form_templates(sensitive)")
    .eq("id", documentId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!doc) {
    return { error: "Document not found." };
  }

  const { data: signed, error } = await supabase.storage
    .from("documents")
    .createSignedUrl(doc.storage_path, SIGNED_URL_TTL_SECONDS);

  if (error || !signed) {
    return { error: "Could not generate a view link." };
  }

  if (doc.document_types?.sensitive || doc.form_templates?.sensitive) {
    await logAudit({ action: "document.viewed", targetType: "document", targetId: documentId });
  }

  return { url: signed.signedUrl };
}
