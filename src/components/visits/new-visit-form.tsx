"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { createVisit, type CreateVisitState } from "@/app/dashboard/visits/actions";

const initialState: CreateVisitState = {};

interface Option {
  id: string;
  name: string;
}

interface VisitTypeOption extends Option {
  defaultFee: number | null;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-fit rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-700 disabled:opacity-60"
    >
      {pending ? "Creating…" : "Create visit"}
    </button>
  );
}

export function NewVisitForm({
  patientId,
  visitTypes,
  doctors,
}: {
  patientId: string;
  visitTypes: VisitTypeOption[];
  doctors: Option[];
}) {
  const action = createVisit.bind(null, patientId);
  const [state, formAction] = useActionState(action, initialState);
  const [feeAmount, setFeeAmount] = useState("0");
  const [feeTouched, setFeeTouched] = useState(false);

  function handleVisitTypeChange(visitTypeId: string) {
    if (feeTouched) return;
    const visitType = visitTypes.find((vt) => vt.id === visitTypeId);
    setFeeAmount(visitType?.defaultFee != null ? String(visitType.defaultFee) : "0");
  }

  return (
    <form action={formAction} className="flex max-w-lg flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="visitTypeId" className="text-sm font-medium">
          Visit type
        </label>
        <select
          id="visitTypeId"
          name="visitTypeId"
          required
          onChange={(e) => handleVisitTypeChange(e.target.value)}
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600"
        >
          <option value="">Choose a visit type</option>
          {visitTypes.map((vt) => (
            <option key={vt.id} value={vt.id}>
              {vt.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="doctorId" className="text-sm font-medium">
          Doctor
        </label>
        <select
          id="doctorId"
          name="doctorId"
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600"
        >
          <option value="">Not specified</option>
          {doctors.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="referredByName" className="text-sm font-medium">
          Referred by (doctor)
        </label>
        <input
          id="referredByName"
          name="referredByName"
          type="text"
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="referredByHospital" className="text-sm font-medium">
          Referring hospital/clinic
        </label>
        <input
          id="referredByHospital"
          name="referredByHospital"
          type="text"
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="feeAmount" className="text-sm font-medium">
          Fee amount (₹)
        </label>
        <input
          id="feeAmount"
          name="feeAmount"
          type="number"
          min={0}
          step="0.01"
          value={feeAmount}
          onChange={(e) => {
            setFeeTouched(true);
            setFeeAmount(e.target.value);
          }}
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="followUpDate" className="text-sm font-medium">
          Follow-up date
        </label>
        <input
          id="followUpDate"
          name="followUpDate"
          type="date"
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="notes" className="text-sm font-medium">
          Notes
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600"
        />
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  );
}
