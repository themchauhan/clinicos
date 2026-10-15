"use client";

import { useCallback, useEffect, useState } from "react";
import type { LocalOp } from "@/lib/offline/db";
import type { OfflineSession } from "@/lib/offline/session";
import {
  discardOp,
  exportUnsynced,
  listOps,
  resolveAsNew,
  resolveUseExisting,
} from "@/lib/offline/queue";
import type { SyncState } from "@/components/offline/use-sync-loop";

interface Candidate {
  id: string;
  name: string;
  patient_code: string;
  mobile: string | null;
  dob: string | null;
  guardian_name: string | null;
  address: string | null;
}

const REASONS: Record<string, string> = {
  possible_duplicate: "This looks like a patient who is already registered.",
  visit_type_inactive: "The visit type is no longer available.",
  doctor_inactive: "The doctor is no longer available.",
  visit_date_out_of_window: "The visit date is too old to be added automatically.",
  unsupported_schema_version: "This record was made by an older version of the app.",
  ack_mismatch: "The server's answer did not match this record.",
  local_corruption: "The copy on this computer no longer matches what was saved. It was not sent.",
  hash_mismatch: "The record kept arriving altered. It was not accepted.",
  already_resolved: "This record was already settled.",
};

function statusText(op: LocalOp): { text: string; tone: string } {
  switch (op.status) {
    case "pending":
    case "syncing":
    case "retryable_error":
      return { text: "Waiting to sync", tone: "bg-amber-100 text-amber-900" };
    case "synced":
      return { text: "Synced", tone: "bg-emerald-100 text-emerald-800" };
    case "needs_review":
      return { text: "Needs review", tone: "bg-red-100 text-red-800" };
    case "resolved":
      return { text: "Settled", tone: "bg-slate-100 text-slate-600" };
    default:
      return { text: "Set aside", tone: "bg-slate-100 text-slate-600" };
  }
}

/** Details of the possible matches, read live (they are never stored on the device). */
function useCandidates(op: LocalOp): { list: Candidate[] | null; unavailable: boolean } {
  const ids = ((op.result?.candidates as { id: string }[] | undefined) ?? []).map((c) => c.id);
  const wanted = op.status === "needs_review" && op.review_reason === "possible_duplicate";
  const key = ids.join(",");
  const [state, setState] = useState<{ list: Candidate[] | null; unavailable: boolean }>({
    list: null,
    unavailable: false,
  });
  useEffect(() => {
    if (!wanted || !key) return;
    let cancelled = false;
    fetch(`/api/offline/candidates?ids=${key}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("unavailable"))))
      .then(
        (body) =>
          !cancelled && setState({ list: body.patients as Candidate[], unavailable: false }),
      )
      .catch(() => !cancelled && setState({ list: null, unavailable: true }));
    return () => {
      cancelled = true;
    };
  }, [wanted, key]);
  return state;
}

function HeldRecord({
  op,
  busy,
  run,
}: {
  op: LocalOp;
  busy: boolean;
  run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const { list, unavailable } = useCandidates(op);
  const isDup = op.review_reason === "possible_duplicate";
  return (
    <div className="mt-2 text-sm">
      <p className="text-red-800">
        {REASONS[op.review_reason ?? ""] ??
          `The server could not accept this record (${op.review_reason ?? "unknown"}).`}
      </p>
      {isDup ? (
        <div className="mt-2 flex flex-col gap-2">
          {unavailable ? (
            <p className="text-slate-600">
              Connect to the internet to compare this record with the existing patients.
            </p>
          ) : null}
          {list === null && !unavailable ? <p className="text-slate-500">Loading…</p> : null}
          {(list ?? []).map((c) => (
            <div
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-slate-50 p-2"
            >
              <span>
                {c.name} ({c.patient_code}){c.mobile ? ` · ${c.mobile}` : ""}
                {c.dob ? ` · DOB ${c.dob}` : ""}
                {c.guardian_name ? ` · ${c.guardian_name}` : ""}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => resolveUseExisting(op.op_id, c.id))}
                className="rounded-md border border-slate-300 px-2.5 py-1 hover:bg-white"
              >
                Same person — use this patient
              </button>
            </div>
          ))}
          {list !== null ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => resolveAsNew(op.op_id))}
              className="w-fit rounded-md border border-amber-700 px-3 py-1.5 text-amber-900 hover:bg-amber-50"
            >
              A different person — register as new
            </button>
          ) : null}
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => {
          if (
            window.confirm(
              "Set this record aside? It stays on this computer and in the saved file, but will not be sent.",
            )
          ) {
            void run(() => discardOp(op.op_id));
          }
        }}
        className="mt-2 block text-slate-500 underline"
      >
        Set aside
      </button>
    </div>
  );
}

export function PendingList({
  session,
  sync,
  onBack,
  onOpenSlip,
}: {
  session: OfflineSession;
  sync: SyncState;
  onBack: () => void;
  onOpenSlip: (op: LocalOp) => void;
}) {
  const [ops, setOps] = useState<LocalOp[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setOps((await listOps(session.scope)).reverse());
    await sync.refreshCounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.scope]);

  useEffect(() => {
    const load = () =>
      void listOps(session.scope).then((all) => {
        setOps(all.reverse());
        void sync.refreshCounts();
      });
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.scope]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      await reload();
      await sync.syncNow(true);
      await reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    const text = await exportUnsynced(session.scope);
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `clinicos-unsynced-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const visible = (ops ?? []).filter((o) => o.status !== "resolved");

  return (
    <section className="flex flex-col gap-4 print:hidden">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={onBack} className="text-sm text-teal-700 underline">
          ← Back
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => run(() => Promise.resolve())}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-60"
        >
          {busy ? "Working…" : "Sync now"}
        </button>
        <button
          type="button"
          onClick={() => void download()}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
        >
          Save unsynced records as a file
        </button>
      </div>
      {message ? (
        <p role="alert" className="text-sm text-red-600">
          {message}
        </p>
      ) : null}

      {ops && visible.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing saved on this computer.</p>
      ) : null}

      <ul className="flex flex-col gap-3">
        {visible.map((op) => {
          const s = statusText(op);
          return (
            <li key={op.op_id} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">
                  {op.display_name ??
                    (op.result?.patient_code
                      ? `Patient ${String(op.result.patient_code)}`
                      : "Record")}
                  <span className="ml-2 text-sm text-slate-500">no. {op.label}</span>
                </p>
                <span className={`rounded-full px-2.5 py-0.5 text-xs ${s.tone}`}>{s.text}</span>
              </div>

              {op.status === "synced" && op.result ? (
                <p className="mt-1 text-sm text-slate-600">
                  Patient {String(op.result.patient_code ?? "")} · token{" "}
                  {String(op.result.token_number ?? "")}
                </p>
              ) : null}
              {op.status === "retryable_error" ? (
                <p className="mt-1 text-sm text-slate-500">Will try again automatically.</p>
              ) : null}
              {op.status === "needs_review" ? <HeldRecord op={op} busy={busy} run={run} /> : null}

              <button
                type="button"
                onClick={() => onOpenSlip(op)}
                className="mt-2 text-sm text-teal-700 underline"
              >
                View / print slip
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
