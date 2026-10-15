"use client";

import { useActionState, useRef, useState } from "react";
import Link from "next/link";
import { useFormStatus } from "react-dom";
import type { PatientFormState } from "@/app/dashboard/patients/actions";
import type { PatientGender } from "@/types/database";
import { Spinner } from "@/components/spinner";
import { GUARDIAN_RELATIONS, type GuardianRelation } from "@/lib/patients/guardian";
import { asksPregnancyDetails } from "@/lib/patients/gender";

const initialState: PatientFormState = {};

export interface PatientFormDefaults {
  name?: string;
  mobile?: string | null;
  dob?: string | null;
  approximateAgeYears?: number | null;
  guardianName?: string | null;
  guardianRelation?: GuardianRelation | null;
  gender?: PatientGender | null;
  address?: string | null;
  livingSons?: number | null;
  livingSonsAges?: string | null;
  livingDaughters?: number | null;
  livingDaughtersAges?: string | null;
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
  cancelHref = "/dashboard/patients",
}: {
  action: (prevState: PatientFormState, formData: FormData) => Promise<PatientFormState>;
  defaults?: PatientFormDefaults;
  submitLabel: string;
  cancelHref?: string;
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

  // Gender and DOB are tracked so the form can react to them: children are
  // only asked for a patient who could be pregnant, and a typed DOB shows
  // the age it gives (and makes "approximate age" unnecessary).
  const [gender, setGender] = useState<PatientGender | "">(defaults?.gender ?? "");
  const [dob, setDob] = useState(defaults?.dob ?? "");
  const showChildren = asksPregnancyDetails(gender || null);
  const dobAge = ageFromDob(dob);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="flex max-w-5xl flex-col gap-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
    >
      <input ref={confirmedInputRef} type="hidden" name="confirmed" defaultValue="false" />

      {/* Three across on a desktop (everything visible without scrolling),
          two on a tablet, one on a phone. */}
      <div key={fieldsKey} className="grid gap-x-4 gap-y-4 sm:grid-cols-6 lg:grid-cols-12">
        <div className="sm:col-span-3 lg:col-span-5">
          <Field
            label="Name"
            name="name"
            required
            autoFocus
            defaultValue={effectiveDefaults?.name}
          />
        </div>
        <div className="sm:col-span-3 lg:col-span-4">
          <Field
            label="Mobile"
            name="mobile"
            type="tel"
            inputMode="tel"
            pattern="\+?[0-9\s\-\(\)]{7,20}"
            title="Enter a valid mobile number (digits only)"
            placeholder="e.g. 9876543210"
            defaultValue={effectiveDefaults?.mobile ?? undefined}
          />
        </div>
        <fieldset className="flex flex-col gap-1.5 sm:col-span-6 lg:col-span-3">
          <legend className="mb-1.5 text-sm font-medium">Gender</legend>
          <div className="flex w-fit overflow-hidden rounded-md border border-slate-300">
            {GENDER_CHOICES.map((choice) => (
              <label
                key={choice.value}
                className="cursor-pointer border-r border-slate-300 px-4 py-2 text-sm transition-colors last:border-r-0 has-checked:bg-teal-600 has-checked:text-white has-focus-visible:ring-2 has-focus-visible:ring-teal-600"
              >
                <input
                  type="radio"
                  name="gender"
                  value={choice.value}
                  checked={gender === choice.value}
                  onChange={() => setGender(choice.value)}
                  className="sr-only"
                />
                {choice.label}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="sm:col-span-3 lg:col-span-3">
          <Field
            label="Date of birth"
            name="dob"
            type="date"
            value={dob}
            onValueChange={setDob}
            hint={dobAge ? `Age: ${dobAge}` : undefined}
          />
        </div>
        <div className="sm:col-span-3 lg:col-span-3">
          <Field
            label="Approximate age (years) — only if DOB is unknown"
            displayLabel="Approx. age (years)"
            name="approximateAgeYears"
            type="number"
            min={0}
            placeholder="If DOB unknown"
            disabled={Boolean(dobAge)}
            defaultValue={effectiveDefaults?.approximateAgeYears ?? undefined}
          />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-2">
          <label htmlFor="guardianRelation" className="text-sm font-medium">
            Relationship
          </label>
          <select
            id="guardianRelation"
            name="guardianRelation"
            defaultValue={effectiveDefaults?.guardianRelation ?? ""}
            className={INPUT_CLASS}
          >
            <option value="">Not specified</option>
            {GUARDIAN_RELATIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-4 lg:col-span-4">
          <Field
            label="Guardian name"
            name="guardianName"
            placeholder="Printed on forms, e.g. W/O Anand"
            defaultValue={effectiveDefaults?.guardianName ?? undefined}
          />
        </div>

        <div className="sm:col-span-6 lg:col-span-12">
          <Field
            label="Address"
            name="address"
            multiline
            defaultValue={effectiveDefaults?.address ?? undefined}
          />
        </div>

        {/* Hidden, not removed, for a male patient: the fields stay in the
            form, so saving never wipes children recorded earlier. */}
        <div
          hidden={!showChildren}
          className="grid gap-x-4 gap-y-4 border-t border-slate-100 pt-4 sm:col-span-6 sm:grid-cols-6 lg:col-span-12 lg:grid-cols-12"
        >
          <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase sm:col-span-6 lg:col-span-12">
            Children (asked on PC-PNDT Form F)
          </p>
          <div className="sm:col-span-2 lg:col-span-2">
            <Field
              label="Living sons"
              name="livingSons"
              type="number"
              min={0}
              defaultValue={effectiveDefaults?.livingSons ?? undefined}
            />
          </div>
          <div className="sm:col-span-4 lg:col-span-4">
            <Field
              label="Age of each son"
              name="livingSonsAges"
              placeholder="e.g. 6 years"
              defaultValue={effectiveDefaults?.livingSonsAges ?? undefined}
            />
          </div>
          <div className="sm:col-span-2 lg:col-span-2">
            <Field
              label="Living daughters"
              name="livingDaughters"
              type="number"
              min={0}
              defaultValue={effectiveDefaults?.livingDaughters ?? undefined}
            />
          </div>
          <div className="sm:col-span-4 lg:col-span-4">
            <Field
              label="Age of each daughter"
              name="livingDaughtersAges"
              placeholder="e.g. 4 years, 8 months"
              defaultValue={effectiveDefaults?.livingDaughtersAges ?? undefined}
            />
          </div>
        </div>
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

      <div className="flex items-center gap-3 border-t border-slate-100 pt-4">
        <SubmitButton label={submitLabel} />
        <Link
          href={cancelHref}
          className="rounded-md px-3 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
        >
          Cancel
        </Link>
      </div>
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
  displayLabel,
  placeholder,
  multiline,
  defaultValue,
  value,
  onValueChange,
  hint,
  disabled,
  autoFocus,
  inputMode,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  min?: number;
  pattern?: string;
  title?: string;
  displayLabel?: string;
  placeholder?: string;
  multiline?: boolean;
  defaultValue?: string | number;
  /** Controlled mode (with onValueChange), for fields the form reacts to. */
  value?: string;
  onValueChange?: (value: string) => void;
  hint?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  inputMode?: "tel" | "numeric" | "text";
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={name}
        className={`text-sm font-medium${required ? "after:ml-0.5 after:text-red-500 after:content-['*']" : ""}`}
      >
        {displayLabel ?? label}
      </label>
      {multiline ? (
        <textarea
          id={name}
          name={name}
          rows={2}
          placeholder={placeholder}
          defaultValue={defaultValue}
          className={INPUT_CLASS}
        />
      ) : (
        <input
          id={name}
          name={name}
          type={type}
          placeholder={placeholder}
          required={required}
          min={min}
          pattern={pattern}
          title={title}
          disabled={disabled}
          autoFocus={autoFocus}
          inputMode={inputMode}
          {...(onValueChange
            ? { value, onChange: (e) => onValueChange(e.target.value) }
            : { defaultValue })}
          className={`${INPUT_CLASS} disabled:bg-slate-50 disabled:text-slate-400`}
        />
      )}
      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

const INPUT_CLASS =
  "rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600 user-invalid:border-red-400 user-invalid:focus:border-red-400";

const GENDER_CHOICES: { value: PatientGender; label: string }[] = [
  { value: "FEMALE", label: "Female" },
  { value: "MALE", label: "Male" },
  { value: "OTHER", label: "Other" },
];

/** "45 years" for a DOB in the past; null for an empty or impossible date. */
function ageFromDob(dob: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
  const birth = new Date(`${dob}T00:00:00`);
  const now = new Date();
  if (Number.isNaN(birth.getTime()) || birth > now) return null;
  let years = now.getFullYear() - birth.getFullYear();
  if (
    now.getMonth() < birth.getMonth() ||
    (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())
  ) {
    years--;
  }
  if (years >= 1) return `${years} year${years === 1 ? "" : "s"}`;
  const months = (now.getFullYear() - birth.getFullYear()) * 12 + now.getMonth() - birth.getMonth();
  return `${Math.max(0, months)} month${months === 1 ? "" : "s"}`;
}
