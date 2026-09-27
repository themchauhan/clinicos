"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { recordPayment, type RecordPaymentState } from "@/app/dashboard/visits/actions";

const initialState: RecordPaymentState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-fit rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-700 transition-colors hover:bg-red-50 disabled:opacity-60 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
    >
      {pending ? "Recording…" : "Record reversal"}
    </button>
  );
}

/** HOSPITAL_ADMIN only — the corresponding page only renders this for that role, and the server action independently enforces it via RLS + an app-level check. */
export function ReversalForm({ visitId }: { visitId: string }) {
  const action = recordPayment.bind(null, visitId);
  const [state, formAction] = useActionState(action, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="isReversal" value="true" />

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="reversal-amount" className="text-sm font-medium">
            Reversal amount (₹, negative)
          </label>
          <input
            id="reversal-amount"
            name="amount"
            type="number"
            step="0.01"
            max={0}
            required
            className="w-40 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="reversal-mode" className="text-sm font-medium">
            Mode
          </label>
          <select
            id="reversal-mode"
            name="mode"
            defaultValue="CASH"
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600"
          >
            <option value="CASH">Cash</option>
            <option value="UPI">UPI</option>
            <option value="CARD">Card</option>
            <option value="OTHER">Other</option>
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="reversal-note" className="text-sm font-medium">
            Reason
          </label>
          <input
            id="reversal-note"
            name="note"
            type="text"
            required
            className="w-56 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600"
          />
        </div>

        <SubmitButton />
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
