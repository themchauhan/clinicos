import { setDoctorStatus } from "@/app/dashboard/settings/actions";

export interface DoctorRow {
  id: string;
  name: string;
  active: boolean;
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
            <div className="mt-2 flex justify-end">
              <form action={setDoctorStatus.bind(null, doctor.id, !doctor.active)}>
                <button
                  type="submit"
                  className="rounded-md border border-zinc-300 px-3 py-1 text-xs transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
                >
                  {doctor.active ? "Deactivate" : "Reactivate"}
                </button>
              </form>
            </div>
          </div>
        ))}
      </div>

      <table className="hidden w-full text-left text-sm sm:table">
        <thead>
          <tr className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            <th className="py-2 font-medium">Name</th>
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
                  <button
                    type="submit"
                    className="rounded-md border border-zinc-300 px-3 py-1 text-xs transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
                  >
                    {doctor.active ? "Deactivate" : "Reactivate"}
                  </button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
