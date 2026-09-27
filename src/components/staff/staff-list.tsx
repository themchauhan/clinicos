import { setStaffStatus } from "@/app/dashboard/staff/actions";
import type { ProfileStatus, StaffRole } from "@/types/database";

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

export function StaffList({ staff, currentUserId }: { staff: StaffRow[]; currentUserId: string }) {
  if (staff.length === 0) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">No staff yet.</p>;
  }

  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <table className="w-full min-w-[560px] text-left text-sm sm:min-w-0">
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
                    <button
                      type="submit"
                      className="rounded-md border border-zinc-300 px-3 py-1 text-xs transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
                    >
                      {member.status === "ACTIVE" ? "Deactivate" : "Reactivate"}
                    </button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
