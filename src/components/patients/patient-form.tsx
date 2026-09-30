"use client";

import { useActionState, useRef } from "react";
import { useFormStatus } from "react-dom";
import type { PatientFormState } from "@/app/dashboard/patients/actions";
import type { PatientGender } from "@/types/database";
import { Spinner } from "@/components/spinner";

const initialState: PatientFormState = {};

export interface PatientFormDefaults {
  name?: string;
  mobile?: string | null;
  dob?: string | null;
  approximateAgeYears?: number | null;
  guardianName?: string | null;
  gender?: PatientGender | null;
  address?: string | null;
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex w-fit items-center gap-2 rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-700 disabled:opacity-60"
    >
      {pending ? <Spinner /> : null}
      {pending ? "Saving…" : label}
    </button>
  );
}

export function PatientForm({
  action,
  defaults,
  submitLabel,
}: {
  action: (prevState: PatientFormState, formData: FormData) => Promise<PatientFormState>;
  defaults?: PatientFormDefaults;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState(action, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const confirmedInputRef = useRef<HTMLInputElement>(null);

  // Deliberately the SAME <form> (and its already-typed field values)
  // on both the first submit and the "create anyway" resubmit — only
  // the hidden `confirmed` field changes, set imperatively via ref
  // rather than by unmounting/remounting a second form. That avoids a
  // version of this that re-renders a fresh form from `defaults` on
  // confirm, which would silently discard whatever the user actually
  // typed in favor of the original defaults.
  function handleCreateAnyway() {
    if (confirmedInputRef.current) {
      confirmedInputRef.current.value = "true";
    }
    formRef.current?.requestSubmit();
  }

  // The action's round-trip (e.g. the duplicate-check step) re-renders
  // this form, and the uncontrolled fields below were observed to
  // reset to blank rather than keep what the user typed — Next's
  // server action round-trip doesn't preserve that DOM state the way
  // a plain client-side re-render would. state.values echoes back
  // exactly what was submitted, and the `key` forces the fields to
  // remount with THOSE as their defaultValue the one time it matters
  // (the first transition into a duplicates/error state), instead of
  // silently reverting to the original (usually empty) `defaults`.
  const effectiveDefaults = state.values ?? defaults;
  const fieldsKey = state.values ? "restored" : "initial";

  return (
    <form ref={formRef} action={formAction} className="flex max-w-lg flex-col gap-4">
      <input ref={confirmedInputRef} type="hidden" name="confirmed" defaultValue="false" />

      <div key={fieldsKey} className="contents">
        <Field label="Name" name="name" required defaultValue={effectiveDefaults?.name} />
        <Field
          label="Mobile"
          name="mobile"
          type="tel"
          pattern="\+?[0-9\s\-\(\)]{7,20}"
          title="Enter a valid mobile number (digits only)"
          hint="Digits only, e.g. 9876543210"
          defaultValue={effectiveDefaults?.mobile ?? undefined}
        />
        <Field
          label="Date of birth"
          name="dob"
          type="date"
          defaultValue={effectiveDefaults?.dob ?? undefined}
        />
        <Field
          label="Approximate age (years) — only if DOB is unknown"
          name="approximateAgeYears"
          type="number"
          min={0}
          defaultValue={effectiveDefaults?.approximateAgeYears ?? undefined}
        />
        <Field
          label="Guardian name"
          name="guardianName"
          defaultValue={effectiveDefaults?.guardianName ?? undefined}
        />

        <div className="flex flex-col gap-1.5">
          <label htmlFor="gender" className="text-sm font-medium">
            Gender
          </label>
          <select
            id="gender"
            name="gender"
            defaultValue={effectiveDefaults?.gender ?? ""}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600"
          >
            <option value="">Not specified</option>
            <option value="MALE">Male</option>
            <option value="FEMALE">Female</option>
            <option value="OTHER">Other</option>
          </select>
        </div>

        <Field
          label="Address"
          name="address"
          defaultValue={effectiveDefaults?.address ?? undefined}
        />
      </div>

      {state.duplicates && state.duplicates.length > 0 ? (
        <div className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <p className="font-medium">This might already be an existing patient:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {state.duplicates.map((d) => (
              <li key={d.id}>
                {d.name} ({d.patient_code}){d.mobile ? ` · ${d.mobile}` : ""}
                {d.dob ? ` · DOB ${d.dob}` : ""}
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={handleCreateAnyway}
            className="mt-3 rounded-md border border-amber-700 px-3 py-1.5 text-sm transition-colors hover:bg-amber-100 dark:border-amber-400 dark:hover:bg-amber-900"
          >
            This is a different person — create anyway
          </button>
        </div>
      ) : null}

      {state.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}

      <SubmitButton label={submitLabel} />
    </form>
  );
}

function Field({
  label,
  name,
  type = "text",
  required,
  min,
  pattern,
  title,
  hint,
  defaultValue,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  min?: number;
  pattern?: string;
  title?: string;
  hint?: string;
  defaultValue?: string | number;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        min={min}
        pattern={pattern}
        title={title}
        defaultValue={defaultValue}
        className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600 user-invalid:border-red-400 user-invalid:focus:border-red-400"
      />
      {hint ? <p className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</p> : null}
    </div>
  );
}
