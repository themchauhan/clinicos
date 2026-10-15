import type { Metadata } from "next";
import { getSessionProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Offline — ClinicOS" };

const EXPLANATIONS: Record<string, string> = {
  possible_duplicate:
    "Looked like an existing patient; waiting for staff to decide on that computer.",
  visit_type_inactive: "The visit type was switched off before the record synced.",
  doctor_inactive: "The doctor was switched off before the record synced.",
  visit_date_out_of_window: "The visit date was too old to be added automatically.",
  unsupported_schema_version: "Made by an older version of the app.",
  op_id_reused: "A different record tried to reuse an existing record's id.",
  unknown_resolves_op: "A decision pointed at a record that is not waiting for review.",
  resolution_mismatch: "A decision did not match the record it was about.",
  already_resolved: "Someone had already settled this record.",
};

interface LedgerPayload {
  patient?: { name?: string; mobile?: string | null };
  visit?: { visit_date?: string };
}

/**
 * Offline records that reached the server but were not accepted, so nothing is
 * ever lost without anyone knowing -- plus a check that the offline ledger has
 * not been altered. Read-only; the records themselves are settled on the
 * computer that saved them (or re-entered by hand from here).
 */
export default async function OfflineAttentionPage() {
  const profile = await getSessionProfile();
  const supabase = await createClient();
  const enabled = Boolean(profile?.hospital?.offlineSyncEnabled);

  const [{ data: rows }, { data: verified }, { count: appliedCount }] = await Promise.all([
    supabase
      .from("offline_operations")
      .select("op_id, seq, status, error_code, op_type, device_id, created_at, payload")
      .neq("status", "applied")
      .order("seq", { ascending: false })
      .limit(100),
    supabase.rpc("verify_offline_ledger"),
    supabase
      .from("offline_operations")
      .select("op_id", { count: "exact", head: true })
      .eq("status", "applied"),
  ]);

  const ids = (rows ?? []).map((r) => r.op_id);
  const { data: settledBy } = ids.length
    ? await supabase
        .from("offline_operations")
        .select("resolves_op_id")
        .in("resolves_op_id", ids)
        .eq("status", "applied")
    : { data: [] };
  const settled = new Set((settledBy ?? []).map((r) => r.resolves_op_id));
  const open = (rows ?? []).filter((r) => !settled.has(r.op_id));

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">Offline mode</h2>
        <p className="mt-1 text-sm text-slate-600">
          {enabled
            ? "Offline mode is on for your centre."
            : "Offline mode is off for your centre. Ask your platform administrator to switch it on."}{" "}
          {appliedCount ?? 0} offline record{appliedCount === 1 ? "" : "s"} have synced so far.
        </p>
      </div>

      <div
        className={`rounded-md border p-3 text-sm ${
          verified?.ok === false
            ? "border-red-300 bg-red-50 text-red-900"
            : "border-emerald-300 bg-emerald-50 text-emerald-900"
        }`}
      >
        {verified?.ok === false
          ? `Integrity check FAILED at record ${verified.first_bad_seq}: the offline ledger does not match its own checksums. Do not change anything and contact support.`
          : `Integrity check passed: ${verified?.checked ?? 0} ledger record${verified?.checked === 1 ? "" : "s"} are intact and in order.`}
      </div>

      <div>
        <h3 className="font-medium">Needs attention ({open.length})</h3>
        {open.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">
            Nothing — every offline record that reached the server was accepted.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {open.map((r) => {
              const p = r.payload as LedgerPayload;
              return (
                <li key={r.op_id} className="rounded-lg border border-slate-200 p-4 text-sm">
                  <p className="font-medium">
                    {p.patient?.name ?? "Visit for an existing patient"}
                    {p.patient?.mobile ? ` · ${p.patient.mobile}` : ""}
                    <span className="ml-2 text-slate-500">
                      visit {p.visit?.visit_date ?? "—"} · #{r.seq}
                    </span>
                  </p>
                  <p className="mt-1 text-slate-600">
                    {r.status === "needs_review" ? "Held for review" : "Not accepted"}:{" "}
                    {EXPLANATIONS[r.error_code ?? ""] ?? r.error_code ?? "unknown reason"}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
