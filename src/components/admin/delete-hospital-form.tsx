"use client";

import { useState, useTransition } from "react";
import { permanentlyDeleteHospital } from "@/app/admin/actions";

export function DeleteHospitalForm({
  hospitalId,
  hospitalName,
}: {
  hospitalId: string;
  hospitalName: string;
}) {
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const canSubmit = confirmText === hospitalName && !pending;

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await permanentlyDeleteHospital(hospitalId);
      // On success this never returns -- permanentlyDeleteHospital ends
      // with redirect("/admin"), which surfaces as navigation, not a
      // resolved value.
      if (result?.error) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-red-700">
        This permanently deletes <span className="font-semibold">{hospitalName}</span> and
        everything in it — patients, visits, documents, and staff accounts. This cannot be undone.
      </p>
      <label className="flex flex-col gap-1.5 text-sm">
        Type <span className="font-semibold">{hospitalName}</span> to confirm
        <input
          type="text"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          disabled={pending}
          className="rounded-md border border-red-300 bg-white px-3 py-2 text-sm outline-none focus:border-red-600"
        />
      </label>
      <button
        type="button"
        onClick={handleDelete}
        disabled={!canSubmit}
        className="w-fit rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-40"
      >
        {pending ? "Deleting…" : "Permanently delete this centre"}
      </button>
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
