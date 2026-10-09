import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { logAuditFromServiceRole } from "@/lib/audit/log";
import { mergeIdSides } from "@/lib/documents/optimize-image";
import { safeFileLabel } from "@/lib/documents/prepare-upload";

type Session = {
  id: string;
  hospital_id: string;
  patient_id: string;
  visit_id: string | null;
  document_type_id: string | null;
  created_by: string;
};

const SIDE_NAME = /^(front|back)\./;

/**
 * Called when a phone finishes scanning a TWO-SIDED document type (an ID).
 * The phone uploaded the sides one at a time as working pages named
 * `front.jpg` / `back.jpg`; this turns them into the ONE document staff
 * will see:
 *
 *  - both sides  -> merged into a single image (front above back), saved as
 *    a new document; the two working pages are retired -- their rows stay,
 *    marked deleted (patient data is never hard-deleted), but the stored
 *    working files are removed, because the merged image already holds
 *    exactly their content and keeping both would double the storage.
 *  - one side    -> that page is simply renamed "<type> (front|back)".
 *
 * Idempotent: with no working pages left (already finished) it does nothing.
 */
export async function finalizeIdSides(
  supabase: SupabaseClient<Database>,
  session: Session,
): Promise<{ error?: string }> {
  if (!session.document_type_id) return {};

  const [{ data: documentType }, { data: pages }] = await Promise.all([
    supabase.from("document_types").select("name").eq("id", session.document_type_id).single(),
    supabase
      .from("documents")
      .select("id, file_name, page_no, storage_path")
      .eq("scan_session_id", session.id)
      .is("deleted_at", null)
      .order("page_no", { ascending: true }),
  ]);
  const typeName = safeFileLabel(documentType?.name ?? "ID");

  const working = (pages ?? []).filter((p) => SIDE_NAME.test(p.file_name));
  if (working.length === 0) return {};

  const front = working.find((p) => p.file_name.startsWith("front."));
  const back = working.find((p) => p.file_name.startsWith("back."));

  if (working.length === 1) {
    const only = working[0];
    const side = front ? "front" : "back";
    const { error } = await supabase
      .from("documents")
      .update({ file_name: `${typeName} (${side}).jpg`, page_no: null })
      .eq("id", only.id);
    return error ? { error: "Could not save that scan. Try again." } : {};
  }
  if (!front || !back) return { error: "Could not match the front and back sides." };

  const [frontFile, backFile] = await Promise.all([
    supabase.storage.from("documents").download(front.storage_path),
    supabase.storage.from("documents").download(back.storage_path),
  ]);
  if (frontFile.error || backFile.error || !frontFile.data || !backFile.data) {
    return { error: "Could not read the scanned sides. Try again." };
  }

  const merged = await mergeIdSides(
    Buffer.from(await frontFile.data.arrayBuffer()),
    Buffer.from(await backFile.data.arrayBuffer()),
  );
  const storagePath = `${session.hospital_id}/${session.patient_id}/${randomUUID()}.${merged.ext}`;

  const { error: uploadError } = await supabase.storage
    .from("documents")
    .upload(storagePath, merged.buffer, { contentType: merged.mime, upsert: false });
  if (uploadError) return { error: "Could not save the merged ID. Try again." };

  const { data: created, error: insertError } = await supabase
    .from("documents")
    .insert({
      hospital_id: session.hospital_id,
      patient_id: session.patient_id,
      visit_id: session.visit_id,
      document_type_id: session.document_type_id,
      file_name: `${typeName} (front + back).${merged.ext}`,
      file_type: merged.mime,
      storage_path: storagePath,
      file_size: merged.buffer.byteLength,
      sha256: createHash("sha256").update(merged.buffer).digest("hex"),
      page_no: null,
      scan_session_id: session.id,
      uploaded_by: session.created_by,
    })
    .select("id")
    .single();
  if (insertError || !created) {
    await supabase.storage.from("documents").remove([storagePath]);
    return { error: "Could not save the merged ID. Try again." };
  }

  // Retire the working pages (rows kept, files removed).
  await supabase
    .from("documents")
    .update({ deleted_at: new Date().toISOString() })
    .in("id", [front.id, back.id]);
  await supabase.storage.from("documents").remove([front.storage_path, back.storage_path]);

  await logAuditFromServiceRole({
    hospitalId: session.hospital_id,
    userId: session.created_by,
    action: "document.uploaded",
    targetType: "document",
    targetId: created.id,
    metadata: {
      document_type_id: session.document_type_id,
      via: "phone_scan",
      sides: "front + back",
    },
  });
  return {};
}
