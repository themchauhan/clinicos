"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { recordPayment, type RecordPaymentState } from "@/app/dashboard/visits/actions";

const initialState: RecordPaymentState = {};

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-fit rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-700 disabled:opacity-60"
    >
      {pending ? "Recording…" : label}
    </button>
  );
}

export function PaymentForm({ visitId, balanceDue }: { visitId: string; balanceDue: number }) {
  const action = recordPayment.bind(null, visitId);
  const [state, formAction] = useActionState(action, initialState);
  const [amount, setAmount] = useState(balanceDue > 0 ? String(balanceDue) : "");

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="amount" className="text-sm font-medium">
            Amount (₹)
          </label>
          <input
            id="amount"
            name="amount"
            type="number"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
            className="w-32 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="mode" className="text-sm font-medium">
            Mode
          </label>
          <select
            id="mode"
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

        {balanceDue > 0 ? (
          <button
            type="button"
            onClick={() => setAmount(String(balanceDue))}
            className="h-fit rounded-md border border-zinc-300 px-3 py-2 text-sm transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            Received in full (₹{balanceDue.toFixed(2)})
          </button>
        ) : null}

        <SubmitButton label="Record payment" />
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
