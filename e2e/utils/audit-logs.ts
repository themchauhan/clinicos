import { createClient } from "@supabase/supabase-js";

/**
 * Test-only read of audit_logs via service role (RLS would otherwise
 * require signing in as the acting user, which the assertion doesn't
 * need to do). Used to confirm a sensitive-document view produced
 * exactly one row, per the brief's "every view audit-logged" rule.
 */
export async function countAuditLogs(action: string, targetId: string): Promise<number> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { count, error } = await supabase
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("action", action)
    .eq("target_id", targetId);
  if (error) throw error;
  return count ?? 0;
}

/**
 * Test-only lookup of a just-uploaded document's id by patient + file
 * name, via service role. The UI never renders a document's raw id
 * (nothing needs it), so tests that must reference one directly for
 * an audit_logs assertion look it up this way instead of scraping it
 * out of the DOM.
 */
export async function findDocumentId(patientId: string, fileName: string): Promise<string> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await supabase
    .from("documents")
    .select("id")
    .eq("patient_id", patientId)
    .eq("file_name", fileName)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (error || !data) throw error ?? new Error("document not found");
  return data.id;
}

/** Test-only: how many (non-deleted) documents with this file name the patient has. */
export async function countDocuments(patientId: string, fileName: string): Promise<number> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  }
  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { count, error } = await supabase
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq("patient_id", patientId)
    .eq("file_name", fileName)
    .is("deleted_at", null);
  if (error) throw error;
  return count ?? 0;
}
