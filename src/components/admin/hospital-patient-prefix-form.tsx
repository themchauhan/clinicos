"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updatePatientIdPrefix } from "@/app/admin/actions";
import { Spinner } from "@/components/spinner";

/** Patient-ID prefix (CLC in CLC001). Changeable exactly once; after
 * that it is shown read-only. */
export function HospitalPatientPrefixForm({
  hospitalId,
  currentPrefix,
  locked,
}: {
  hospitalId: string;
  currentPrefix: string;
  locked: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(currentPrefix);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (locked) {
    return (
      <p className="pt-2">
        <span className="font-mono font-medium">{currentPrefix}</span>
        <span className="ml-2 text-slate-500">locked — it has already been changed once</span>
      </p>
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const next = draft.trim().toUpperCase();
    if (
      !window.confirm(
        `Change the patient ID prefix from ${currentPrefix} to ${next}? This can only be done once, and every existing patient ID in this centre will be relabelled (e.g. ${currentPrefix}001 → ${next}001).`,
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await updatePatientIdPrefix(hospitalId, next);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-3">
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value.toUpperCase())}
        maxLength={6}
        disabled={pending}
        aria-label="Patient ID prefix"
        className="w-28 rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm outline-none focus:border-teal-600 disabled:opacity-60"
      />
      <button
        type="submit"
        disabled={pending || draft.trim().toUpperCase() === currentPrefix}
        className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60"
      >
        {pending ? <Spinner /> : null}
        {pending ? "Saving…" : "Change once"}
      </button>
      <span className="text-xs text-slate-500">
        e.g. {currentPrefix}001 — editable one time only
      </span>
      {error ? (
        <span role="alert" className="text-sm text-red-600">
          {error}
        </span>
      ) : null}
    </form>
  );
}
