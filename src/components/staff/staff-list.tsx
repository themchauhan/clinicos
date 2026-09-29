"use client";

import { useFormStatus } from "react-dom";
import { setStaffStatus } from "@/app/dashboard/staff/actions";
import type { ProfileStatus, StaffRole } from "@/types/database";
import { Spinner } from "@/components/spinner";

export interface StaffRow {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
  status: ProfileStatus;
}

const ROLE_LABELS: Record<StaffRole, string> = {
  SUPER_ADMIN: "Platform admin",
  HOSPITAL_ADMIN: "Admin",
  RECEPTIONIST: "Receptionist",
};

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

export function StaffList({ staff, currentUserId }: { staff: StaffRow[]; currentUserId: string }) {
  if (staff.length === 0) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">No staff yet.</p>;
  }

  return (
    <>
      <div className="flex flex-col gap-3 sm:hidden">
        {staff.map((member) => (
          <div
            key={member.id}
            className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">{member.name}</p>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">{member.email}</p>
              </div>
              <span
                className={
                  member.status === "ACTIVE"
                    ? "shrink-0 text-sm text-emerald-700 dark:text-emerald-400"
                    : "shrink-0 text-sm text-zinc-500 dark:text-zinc-500"
                }
              >
                {member.status === "ACTIVE" ? "Active" : "Deactivated"}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3">
              <p className="text-sm text-zinc-500 dark:text-zinc-500">{ROLE_LABELS[member.role]}</p>
              {member.id === currentUserId ? null : (
                <form
                  action={setStaffStatus.bind(
                    null,
                    member.id,
                    member.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
                  )}
                >
                  <StatusToggleButton
                    label={member.status === "ACTIVE" ? "Deactivate" : "Reactivate"}
                  />
                </form>
              )}
            </div>
          </div>
        ))}
      </div>

      <table className="hidden w-full text-left text-sm sm:table">
        <thead>
          <tr className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            <th className="py-2 font-medium">Name</th>
            <th className="py-2 font-medium">Email</th>
            <th className="py-2 font-medium">Role</th>
            <th className="py-2 font-medium">Status</th>
            <th className="py-2 font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {staff.map((member) => (
            <tr key={member.id} className="border-b border-zinc-100 dark:border-zinc-900">
              <td className="py-2">{member.name}</td>
              <td className="py-2 text-zinc-600 dark:text-zinc-400">{member.email}</td>
              <td className="py-2">{ROLE_LABELS[member.role]}</td>
              <td className="py-2">
                <span
                  className={
                    member.status === "ACTIVE"
                      ? "text-emerald-700 dark:text-emerald-400"
                      : "text-zinc-500 dark:text-zinc-500"
                  }
                >
                  {member.status === "ACTIVE" ? "Active" : "Deactivated"}
                </span>
              </td>
              <td className="py-2 text-right">
                {member.id === currentUserId ? null : (
                  <form
                    action={setStaffStatus.bind(
                      null,
                      member.id,
                      member.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
                    )}
                  >
                    <StatusToggleButton
                      label={member.status === "ACTIVE" ? "Deactivate" : "Reactivate"}
                    />
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
