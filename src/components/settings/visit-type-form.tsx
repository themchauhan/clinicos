"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import {
  createVisitType,
  updateVisitType,
  type VisitTypeFormState,
} from "@/app/dashboard/settings/actions";
import type { ModuleType } from "@/types/database";

const initialState: VisitTypeFormState = {};

export interface VisitTypeDefaults {
  module?: ModuleType;
  name?: string;
  description?: string | null;
  defaultFee?: number | null;
  active?: boolean;
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-fit rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-700 disabled:opacity-60"
    >
      {pending ? "Saving…" : label}
    </button>
  );
}

export function VisitTypeForm({
  visitTypeId,
  defaults,
  submitLabel = "Add visit type",
  onSaved,
}: {
  visitTypeId?: string;
  defaults?: VisitTypeDefaults;
  submitLabel?: string;
  onSaved?: () => void;
}) {
  const action = visitTypeId ? updateVisitType.bind(null, visitTypeId) : createVisitType;
  const [state, formAction] = useActionState(action, initialState);

  // A fresh state object (not === initialState) with no error means
  // the last submission succeeded -- collapse an inline edit row back
  // to the read view rather than leaving it open after a save.
  useEffect(() => {
    if (state !== initialState && !state.error) {
      onSaved?.();
    }
    // onSaved intentionally excluded below: it's a fresh closure from
    // the parent on every render, and including it would refire this
    // on every keystroke-triggered parent re-render, not just a submit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`vt-module-${visitTypeId ?? "new"}`} className="text-sm font-medium">
            Module
          </label>
          <select
            id={`vt-module-${visitTypeId ?? "new"}`}
            name="module"
            required
            defaultValue={defaults?.module ?? ""}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600"
          >
            <option value="" disabled>
              Choose a module
            </option>
            <option value="GENERAL_OPD">General OPD</option>
            <option value="USG">USG</option>
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`vt-name-${visitTypeId ?? "new"}`} className="text-sm font-medium">
            Visit type name
          </label>
          <input
            id={`vt-name-${visitTypeId ?? "new"}`}
            name="name"
            type="text"
            required
            defaultValue={defaults?.name}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`vt-fee-${visitTypeId ?? "new"}`} className="text-sm font-medium">
            Default fee (₹)
          </label>
          <input
            id={`vt-fee-${visitTypeId ?? "new"}`}
            name="defaultFee"
            type="number"
            min={0}
            step="0.01"
            defaultValue={defaults?.defaultFee ?? ""}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`vt-description-${visitTypeId ?? "new"}`} className="text-sm font-medium">
            Visit type description
          </label>
          <input
            id={`vt-description-${visitTypeId ?? "new"}`}
            name="description"
            type="text"
            defaultValue={defaults?.description ?? ""}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600"
          />
        </div>

        {visitTypeId ? (
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input type="checkbox" name="active" defaultChecked={defaults?.active ?? true} />
            Active
          </label>
        ) : (
          <input type="hidden" name="active" value="on" />
        )}

        <SubmitButton label={submitLabel} />
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
