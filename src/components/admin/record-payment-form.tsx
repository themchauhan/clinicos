"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { recordSubscriptionPayment, type RecordPaymentState } from "@/app/admin/actions";

const initialState: RecordPaymentState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-fit rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-700 disabled:opacity-60"
    >
      {pending ? "Recording…" : "Record payment"}
    </button>
  );
}

export function RecordPaymentForm({ hospitalId }: { hospitalId: string }) {
  const action = recordSubscriptionPayment.bind(null, hospitalId);
  const [state, formAction] = useActionState(action, initialState);

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
            min={0.01}
            step="0.01"
            required
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="paymentMethod" className="text-sm font-medium">
            Payment method
          </label>
          <input
            id="paymentMethod"
            name="paymentMethod"
            type="text"
            placeholder="UPI, bank transfer, cheque…"
            required
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="referenceNumber" className="text-sm font-medium">
            Reference number
          </label>
          <input
            id="referenceNumber"
            name="referenceNumber"
            type="text"
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="periodStart" className="text-sm font-medium">
            Period start
          </label>
          <input
            id="periodStart"
            name="periodStart"
            type="date"
            required
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="periodEnd" className="text-sm font-medium">
            Period end
          </label>
          <input
            id="periodEnd"
            name="periodEnd"
            type="date"
            required
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="notes" className="text-sm font-medium">
            Notes
          </label>
          <input
            id="notes"
            name="notes"
            type="text"
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600"
          />
        </div>

        <SubmitButton />
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
