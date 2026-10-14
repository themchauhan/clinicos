"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { createVisit, type CreateVisitState } from "@/app/dashboard/visits/actions";
import { Spinner } from "@/components/spinner";
import { asksPregnancyDetails } from "@/lib/patients/gender";
import type { PatientGender } from "@/types/database";

const initialState: CreateVisitState = {};

interface Option {
  id: string;
  name: string;
}

interface VisitTypeOption extends Option {
  defaultFee: number | null;
  module: "GENERAL_OPD" | "USG";
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex w-fit items-center gap-2 rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-700 disabled:opacity-60"
    >
      {pending ? <Spinner /> : null}
      {pending ? "Creating…" : "Create visit"}
    </button>
  );
}

export function NewVisitForm({
  patientId,
  visitTypes,
  doctors,
  patientGender,
}: {
  patientId: string;
  visitTypes: VisitTypeOption[];
  doctors: Option[];
  patientGender: PatientGender | null;
}) {
  const action = createVisit.bind(null, patientId);
  const [state, formAction] = useActionState(action, initialState);
  const [feeAmount, setFeeAmount] = useState("0");
  const [feeTouched, setFeeTouched] = useState(false);
  const [visitTypeId, setVisitTypeId] = useState("");
  // LMP only for a USG visit by a patient who could be pregnant.
  const isUsg = visitTypes.find((vt) => vt.id === visitTypeId)?.module === "USG";
  const asksLmp = isUsg && asksPregnancyDetails(patientGender);

  function handleVisitTypeChange(selectedId: string) {
    setVisitTypeId(selectedId);
    if (feeTouched) return;
    const visitType = visitTypes.find((vt) => vt.id === selectedId);
    setFeeAmount(visitType?.defaultFee != null ? String(visitType.defaultFee) : "0");
  }

  return (
    <form
      action={formAction}
      className="flex max-w-2xl flex-col gap-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
    >
      <Section title="Visit">
        <div className="flex flex-col gap-1.5 sm:col-span-3">
          <label htmlFor="visitTypeId" className="text-sm font-medium">
            Visit type
          </label>
          <select
            id="visitTypeId"
            name="visitTypeId"
            required
            autoFocus
            onChange={(e) => handleVisitTypeChange(e.target.value)}
            className={INPUT_CLASS}
          >
            <option value="">Choose a visit type</option>
            {visitTypes.map((vt) => (
              <option key={vt.id} value={vt.id}>
                {vt.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5 sm:col-span-3">
          <label htmlFor="doctorId" className="text-sm font-medium">
            Doctor
          </label>
          <select id="doctorId" name="doctorId" className={INPUT_CLASS}>
            <option value="">Not specified</option>
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5 sm:col-span-3">
          <label htmlFor="feeAmount" className="text-sm font-medium">
            Fee amount (₹)
          </label>
          <input
            id="feeAmount"
            name="feeAmount"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={feeAmount}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => {
              setFeeTouched(true);
              setFeeAmount(e.target.value);
            }}
            className={INPUT_CLASS}
          />
        </div>

        {asksLmp ? (
          <div className="flex flex-col gap-1.5 sm:col-span-3">
            <label htmlFor="lmpDate" className="text-sm font-medium">
              Last menstrual period (LMP)
            </label>
            <input id="lmpDate" name="lmpDate" type="date" className={INPUT_CLASS} />
            <p className="text-xs text-slate-500">
              Optional. Gives the weeks of pregnancy on forms.
            </p>
          </div>
        ) : null}
      </Section>

      <Section title="Referral">
        <div className="flex flex-col gap-1.5 sm:col-span-3">
          <label htmlFor="referredByName" className="text-sm font-medium">
            Referred by (doctor)
          </label>
          <input id="referredByName" name="referredByName" type="text" className={INPUT_CLASS} />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-3">
          <label htmlFor="referredByHospital" className="text-sm font-medium">
            Referring hospital/clinic
          </label>
          <input
            id="referredByHospital"
            name="referredByHospital"
            type="text"
            className={INPUT_CLASS}
          />
        </div>
      </Section>

      <Section title="Follow-up & notes">
        <div className="flex flex-col gap-1.5 sm:col-span-3">
          <label htmlFor="followUpDate" className="text-sm font-medium">
            Follow-up date
          </label>
          <input id="followUpDate" name="followUpDate" type="date" className={INPUT_CLASS} />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-6">
          <label htmlFor="notes" className="text-sm font-medium">
            Notes
          </label>
          <textarea id="notes" name="notes" rows={2} className={INPUT_CLASS} />
        </div>
      </Section>

      {state.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}

      <div className="border-t border-slate-100 pt-4">
        <SubmitButton />
      </div>
    </form>
  );
}

const INPUT_CLASS =
  "rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600 user-invalid:border-red-400";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{title}</h2>
      <div className="grid gap-x-4 gap-y-4 sm:grid-cols-6">{children}</div>
    </section>
  );
}
