"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateHospitalPlan } from "@/app/admin/actions";
import { Spinner } from "@/components/spinner";

export function HospitalPlanForm({
  hospitalId,
  currentPlan,
}: {
  hospitalId: string;
  currentPlan: string;
}) {
  const router = useRouter();
  // Only the in-progress edit lives in local state; once saved, the
  // input reverts to reflecting the (now-updated) `currentPlan` prop
  // via router.refresh(), same reasoning as HospitalStatusForm.
  const [draft, setDraft] = useState(currentPlan);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await updateHospitalPlan(hospitalId, draft);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-3">
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        disabled={pending}
        className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600 disabled:opacity-60"
      />
      <button
        type="submit"
        disabled={pending || draft.trim() === currentPlan.trim()}
        className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60"
      >
        {pending ? <Spinner /> : null}
        {pending ? "Saving…" : "Save"}
      </button>
      {error ? (
        <span role="alert" className="text-sm text-red-600">
          {error}
        </span>
      ) : null}
    </form>
  );
}
