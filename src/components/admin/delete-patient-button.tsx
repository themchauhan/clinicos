"use client";

import { useState, useTransition } from "react";
import { permanentlyDeletePatient } from "@/app/admin/actions";

export function DeletePatientButton({
  patientId,
  patientName,
}: {
  patientId: string;
  patientName: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const canSubmit = confirmText === patientName && !pending;

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="text-sm text-red-600 underline hover:text-red-700"
      >
        Delete
      </button>
    );
  }

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await permanentlyDeletePatient(patientId);
      if (result?.error) {
        setError(result.error);
      } else {
        setExpanded(false);
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          disabled={pending}
          placeholder={`Type "${patientName}"`}
          className="w-40 rounded-md border border-red-300 bg-white px-2 py-1 text-xs outline-none focus:border-red-600"
        />
        <button
          type="button"
          onClick={handleDelete}
          disabled={!canSubmit}
          className="rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-40"
        >
          {pending ? "Deleting…" : "Confirm delete"}
        </button>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          disabled={pending}
          className="text-xs text-slate-500 underline"
        >
          Cancel
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
