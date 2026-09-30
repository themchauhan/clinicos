"use client";

import { useFormStatus } from "react-dom";
import { setDoctorStatus, updateDoctorRegistrationNo } from "@/app/dashboard/settings/actions";
import { Spinner } from "@/components/spinner";

export interface DoctorRow {
  id: string;
  name: string;
  registrationNo: string | null;
  active: boolean;
}

function StatusToggleButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-3 py-1 text-xs transition-colors hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-900"
    >
      {pending ? <Spinner className="h-3 w-3" /> : null}
      {label}
    </button>
  );
}

function SaveRegistrationNoButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-3 py-1 text-xs transition-colors hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-900"
    >
      {pending ? <Spinner className="h-3 w-3" /> : null}
      Save
    </button>
  );
}

function RegistrationNoField({ doctorId, registrationNo }: { doctorId: string; registrationNo: string | null }) {
  return (
    <form
      action={updateDoctorRegistrationNo.bind(null, doctorId)}
      className="flex items-center gap-1.5"
    >
      <input
        name="registrationNo"
        type="text"
        defaultValue={registrationNo ?? ""}
        placeholder="Registration number"
        className="w-40 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs outline-none focus:border-teal-600"
      />
      <SaveRegistrationNoButton />
    </form>
  );
}

export function DoctorList({ doctors }: { doctors: DoctorRow[] }) {
  if (doctors.length === 0) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">No doctors yet.</p>;
  }

  return (
    <>
      <div className="flex flex-col gap-3 sm:hidden">
        {doctors.map((doctor) => (
          <div
            key={doctor.id}
            className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
          >
            <div className="flex items-start justify-between gap-3">
              <p className="font-medium">{doctor.name}</p>
              <span
                className={
                  doctor.active
                    ? "shrink-0 text-sm text-emerald-700 dark:text-emerald-400"
                    : "shrink-0 text-sm text-zinc-500 dark:text-zinc-500"
                }
              >
                {doctor.active ? "Active" : "Inactive"}
              </span>
            </div>
            <div className="mt-2">
              <RegistrationNoField doctorId={doctor.id} registrationNo={doctor.registrationNo} />
            </div>
            <div className="mt-2 flex justify-end">
              <form action={setDoctorStatus.bind(null, doctor.id, !doctor.active)}>
                <StatusToggleButton label={doctor.active ? "Deactivate" : "Reactivate"} />
              </form>
            </div>
          </div>
        ))}
      </div>

      <table className="hidden w-full text-left text-sm sm:table">
        <thead>
          <tr className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            <th className="py-2 font-medium">Name</th>
            <th className="py-2 font-medium">Registration number</th>
            <th className="py-2 font-medium">Status</th>
            <th className="py-2 font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {doctors.map((doctor) => (
            <tr key={doctor.id} className="border-b border-zinc-100 dark:border-zinc-900">
              <td className="py-2">{doctor.name}</td>
              <td className="py-2">
                <RegistrationNoField doctorId={doctor.id} registrationNo={doctor.registrationNo} />
              </td>
              <td className="py-2">
                <span
                  className={
                    doctor.active
                      ? "text-emerald-700 dark:text-emerald-400"
                      : "text-zinc-500 dark:text-zinc-500"
                  }
                >
                  {doctor.active ? "Active" : "Inactive"}
                </span>
              </td>
              <td className="py-2 text-right">
                <form action={setDoctorStatus.bind(null, doctor.id, !doctor.active)}>
                  <StatusToggleButton label={doctor.active ? "Deactivate" : "Reactivate"} />
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
