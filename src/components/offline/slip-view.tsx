"use client";

import { useEffect, useState } from "react";
import type { LocalOp } from "@/lib/offline/db";
import { getOp } from "@/lib/offline/queue";
import type { OfflineSession } from "@/lib/offline/session";

function ageText(dob: string | null | undefined, approx: number | null | undefined): string {
  if (dob) {
    const years = Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 3600 * 1000));
    return String(years);
  }
  return approx != null ? `~${approx}` : "—";
}

/**
 * The slip for an offline record, printed from the device's own copy. Its
 * number is PROVISIONAL (the real token is given when the record syncs) and the
 * slip says so.
 */
export function SlipView({
  session,
  opId,
  onBack,
  onPending,
}: {
  session: OfflineSession;
  opId: string | null;
  onBack: () => void;
  onPending: () => void;
}) {
  const [op, setOp] = useState<LocalOp | null | undefined>(undefined);

  useEffect(() => {
    if (!opId) return;
    void getOp(opId).then((o) => setOp(o && o.scope === session.scope ? o : null));
  }, [opId, session.scope]);

  if (op === undefined && opId) return null;
  if (!op) {
    return (
      <p className="text-sm text-slate-600 print:hidden">
        That record could not be found.{" "}
        <button onClick={onBack} className="text-teal-700 underline">
          Back
        </button>
      </p>
    );
  }

  const synced = op.status === "synced";
  const visitTypeId =
    op.op?.visit.visit_type_id ?? (op.result?.visit_type_id as string | undefined);
  const visitType = session.visit_types.find((t) => t.id === visitTypeId);
  const doctor = session.doctors.find((d) => d.id === op.op?.visit.doctor_id);
  const patient = op.op?.patient;
  const visitDate = op.op?.visit.visit_date ?? (op.result?.visit_date as string | undefined) ?? "";

  return (
    <section className="flex flex-col gap-4">
      <div className="rounded-md border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900 print:hidden">
        <p className="font-medium">
          {synced
            ? `Synced. Patient ${String(op.result?.patient_code ?? "")}, token ${String(op.result?.token_number ?? "")}.`
            : `Saved on this computer — provisional no. ${op.label}.`}
        </p>
        {!synced ? (
          <p className="mt-1">
            It is <strong>not in the cloud yet</strong> and other computers can&rsquo;t see it. It
            will sync by itself when the connection is back; the real patient ID and token are given
            then.
          </p>
        ) : null}
      </div>

      <article className="rounded-lg border border-slate-300 bg-white p-6 print:border-0 print:p-0">
        <header className="flex items-baseline justify-between gap-4 border-b-2 border-slate-900 pb-2">
          <h2 className="text-lg font-bold">{session.hospital_name}</h2>
          <span className="text-sm text-slate-500">{visitDate}</span>
        </header>
        <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
          <span>
            <span className="text-slate-500">Patient: </span>
            <b>{patient?.name ?? (synced ? String(op.result?.patient_code ?? "") : "")}</b>
          </span>
          <span>
            <span className="text-slate-500">{synced ? "Token #: " : "Provisional no.: "}</span>
            <b>{synced ? String(op.result?.token_number ?? "") : op.label}</b>
          </span>
          <span>
            <span className="text-slate-500">Type: </span>
            <b>{visitType?.name ?? "—"}</b>
          </span>
          <span>
            <span className="text-slate-500">Doctor: </span>
            <b>{doctor?.name ?? "—"}</b>
          </span>
        </p>
        <p className="mt-2 flex flex-wrap items-baseline gap-x-5 gap-y-1 border-t border-slate-200 pt-2 text-sm">
          <span>
            <span className="text-slate-500">Age: </span>
            <b>{ageText(patient?.dob, patient?.approximate_age_years)}</b>
          </span>
          <span className="inline-flex items-baseline gap-1.5">
            <span className="text-slate-500">Temp:</span>
            <span className="inline-block w-20 border-b border-slate-400">&nbsp;</span>
          </span>
          <span className="inline-flex items-baseline gap-1.5">
            <span className="text-slate-500">BP:</span>
            <span className="inline-block w-24 border-b border-slate-400">&nbsp;</span>
          </span>
        </p>
        {!synced ? (
          <p className="mt-2 text-xs text-slate-500">
            Offline slip — the number above is provisional; the official token is assigned when this
            record is synced.
          </p>
        ) : null}
        <div className="mt-4 h-64 border border-dashed border-slate-300" />
      </article>

      <div className="flex flex-wrap gap-3 print:hidden">
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700"
        >
          Print slip
        </button>
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
        >
          Done
        </button>
        <button
          type="button"
          onClick={onPending}
          className="rounded-md px-3 py-2 text-sm text-teal-700 underline"
        >
          Saved on this computer
        </button>
      </div>
    </section>
  );
}
