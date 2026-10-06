"use server";

import { randomUUID, createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getSessionProfile } from "@/lib/auth/session";
import { requireRole, requireActiveTenant } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit/log";
import { validateFile } from "@/lib/documents/file-validation";
import { optimizeDocumentFile } from "@/lib/documents/optimize-image";

const SIGNED_URL_TTL_SECONDS = 60;

export interface UploadDocumentState {
  error?: string;
  /** Informational, not a failure (e.g. the file was already attached). */
  notice?: string;
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

  // Bounded + recompressed (and metadata-stripped); PDFs pass through.
  const stored = await optimizeDocumentFile(rawBuffer, validated.mime);
  const finalBuffer = stored.buffer;
  const sha256 = createHash("sha256").update(finalBuffer).digest("hex");
  const storagePath = `${profile.hospitalId}/${target.patientId}/${randomUUID()}.${stored.ext}`;
  // An image is stored as JPEG whatever it arrived as, so its name's
  // extension has to follow.
  const fileName =
    stored.mime === validated.mime
      ? file.name
      : file.name.replace(/\.[^.]+$/, "") + "." + stored.ext;

  const supabase = await createClient();

  // The same file, in the same slot (patient + visit + document type), is
  // not stored twice -- staff re-upload by habit and a retry after a
  // flaky network is common. Compared on the stored bytes' hash.
  const duplicateQuery = supabase
    .from("documents")
    .select("id")
    .eq("patient_id", target.patientId)
    .eq("document_type_id", documentTypeId)
    .eq("sha256", sha256)
    .is("deleted_at", null);
  const { data: duplicate } = await (
    target.visitId
      ? duplicateQuery.eq("visit_id", target.visitId)
      : duplicateQuery.is("visit_id", null)
  )
    .limit(1)
    .maybeSingle();
  if (duplicate) {
    return { notice: "That exact file is already attached here, so nothing new was stored." };
  }

  const { error: uploadError } = await supabase.storage
    .from("documents")
    .upload(storagePath, finalBuffer, { contentType: stored.mime, upsert: false });
  if (uploadError) {
    return { error: "Could not upload the file. Try again." };
  }

  const { data: created, error: insertError } = await supabase
    .from("documents")
    .insert({
      patient_id: target.patientId,
      visit_id: target.visitId ?? null,
      document_type_id: documentTypeId,
      file_name: fileName,
      file_type: stored.mime,
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
