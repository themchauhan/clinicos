"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { createDoctor, type DoctorFormState } from "@/app/dashboard/settings/actions";

const initialState: DoctorFormState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-fit rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-700 disabled:opacity-60"
    >
      {pending ? "Saving…" : "Add doctor"}
    </button>
  );
}

export function DoctorForm() {
  const [state, formAction] = useActionState(createDoctor, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="doctor-name" className="text-sm font-medium">
            Doctor name
          </label>
          <input
            id="doctor-name"
            name="name"
            type="text"
            required
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600"
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
