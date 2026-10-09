"use client";

import { useActionState } from "react";
import { updateVisitLmp, type UpdateLmpState } from "@/app/dashboard/visits/actions";

const initialState: UpdateLmpState = {};

/** Sets or changes a visit's LMP after the fact. Weeks of pregnancy are worked out from it. */
export function LmpForm({ visitId, lmpDate }: { visitId: string; lmpDate: string | null }) {
  const [state, formAction, pending] = useActionState(
    updateVisitLmp.bind(null, visitId),
    initialState,
  );
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input
        type="date"
        name="lmpDate"
        aria-label="Last menstrual period"
        defaultValue={lmpDate ?? ""}
        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm outline-none focus:border-teal-600"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-zinc-300 px-3 py-1 text-sm transition-colors hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-900"
      >
        {pending ? "Saving…" : "Save"}
      </button>
      {state.error ? (
        <span role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </span>
      ) : state.saved ? (
        <span className="text-sm text-emerald-700 dark:text-emerald-400">Saved.</span>
      ) : null}
    </form>
  );
}
