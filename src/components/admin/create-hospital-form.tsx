"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { createHospital, type CreateHospitalState } from "@/app/admin/actions";
import { Spinner } from "@/components/spinner";

const initialState: CreateHospitalState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex w-fit items-center gap-2 rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-700 disabled:opacity-60"
    >
      {pending ? <Spinner /> : null}
      {pending ? "Creating…" : "Create centre"}
    </button>
  );
}

export function CreateHospitalForm() {
  const [state, formAction] = useActionState(createHospital, initialState);

  return (
    <form action={formAction} className="flex max-w-lg flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="name" className="text-sm font-medium">
          Centre name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="address" className="text-sm font-medium">
          Address
        </label>
        <input
          id="address"
          name="address"
          type="text"
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="phone" className="text-sm font-medium">
          Phone
        </label>
        <input
          id="phone"
          name="phone"
          type="tel"
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-sm font-medium">
          Centre email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600"
        />
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-sm font-medium">Modules</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="modules" value="GENERAL_OPD" />
          General OPD
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="modules" value="USG" />
          USG
        </label>
      </fieldset>

      <div className="mt-2 border-t border-slate-200 pt-4">
        <p className="text-sm font-medium text-slate-500">First admin for this centre</p>

        <div className="mt-3 flex flex-col gap-1.5">
          <label htmlFor="adminName" className="text-sm font-medium">
            Admin name
          </label>
          <input
            id="adminName"
            name="adminName"
            type="text"
            required
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600"
          />
        </div>

        <div className="mt-3 flex flex-col gap-1.5">
          <label htmlFor="adminEmail" className="text-sm font-medium">
            Admin email
          </label>
          <input
            id="adminEmail"
            name="adminEmail"
            type="email"
            required
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600"
          />
        </div>
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  );
}
