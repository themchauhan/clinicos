"use server";

import { randomUUID, createHash } from "node:crypto";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { resolveScanSession } from "@/lib/scan/resolve-session";
import { validateFile } from "@/lib/documents/file-validation";
import { stripExifIfImage } from "@/lib/documents/strip-exif";
import { logAuditFromServiceRole } from "@/lib/audit/log";
import { compositeSignatureWithDeclaration } from "@/lib/documents/signature-composite";

// Nothing in this file trusts a Supabase Auth session — there isn't
// one. The raw token from the QR/link is the only credential; every
// action here starts by re-resolving it and treats any failure to
// resolve (wrong token, expired, already completed/cancelled) the
// same way, so a stale link can't be used to distinguish *why* it no
// longer works.

const MAX_PAGES_PER_SESSION = 20;

export type ScanSessionInfoResult =
  | {
      hospitalName: string;
      patientName: string;
      documentTypeName: string;
      documentTypeDescription: string | null;
      requiresSignature: boolean;
      existingPages: { id: string; pageNo: number }[];
    }
  | { error: "invalid" | "expired" | "completed" };

export async function getScanSessionInfo(rawToken: string): Promise<ScanSessionInfoResult> {
  const supabase = createServiceRoleClient();
  const session = await resolveScanSession(supabase, rawToken);
  if (!session) {
    return { error: await classifyUnresolvedToken(rawToken) };
  }

  const [{ data: hospital }, { data: patient }, { data: documentType }, { data: pages }] =
    await Promise.all([
      supabase.from("hospitals").select("name").eq("id", session.hospital_id).single(),
      supabase.from("patients").select("name").eq("id", session.patient_id).single(),
      supabase
        .from("document_types")
        .select("name, description, requires_signature")
        .eq("id", session.document_type_id)
        .single(),
      supabase
        .from("documents")
        .select("id, page_no")
        .eq("scan_session_id", session.id)
        .is("deleted_at", null)
        .order("page_no", { ascending: true }),
    ]);

  return {
    hospitalName: hospital?.name ?? "—",
    patientName: patient?.name ?? "—",
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
      .eq("id", session.document_type_id)
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
