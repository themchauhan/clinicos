"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { inviteStaff, type InviteStaffState } from "@/app/dashboard/staff/actions";
import { Spinner } from "@/components/spinner";

const initialState: InviteStaffState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center gap-2 rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-700 disabled:opacity-60"
    >
      {pending ? <Spinner /> : null}
      {pending ? "Inviting…" : "Send invite"}
    </button>
  );
}

export function InviteStaffForm() {
  const [state, formAction] = useActionState(inviteStaff, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4 sm:flex-row sm:items-end">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="name" className="text-sm font-medium">
          Name
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
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="role" className="text-sm font-medium">
          Role
        </label>
        <select
          id="role"
          name="role"
          defaultValue="RECEPTIONIST"
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600"
        >
          <option value="RECEPTIONIST">Receptionist</option>
          <option value="HOSPITAL_ADMIN">Admin</option>
        </select>
      </div>

      <SubmitButton />

      {state.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">
          {state.success}
        </p>
      ) : null}
    </form>
  );
}
