"use client";

import Link from "next/link";
import { useFormStatus } from "react-dom";
import { setFormTemplateActive } from "@/app/dashboard/settings/forms/actions";
import { Spinner } from "@/components/spinner";

export interface FormTemplateRow {
  id: string;
  name: string;
  description: string | null;
  version: number;
  effective_from: string;
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

export function FormTemplateList({ templates }: { templates: FormTemplateRow[] }) {
  if (templates.length === 0) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">No form templates yet.</p>;
  }

  return (
    <>
      <div className="flex flex-col gap-3 sm:hidden">
        {templates.map((t) => (
          <div key={t.id} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <div className="flex items-start justify-between gap-3">
              <p className="font-medium">{t.name}</p>
              <span
                className={
                  t.active
                    ? "shrink-0 text-sm text-emerald-700 dark:text-emerald-400"
                    : "shrink-0 text-sm text-zinc-500 dark:text-zinc-500"
                }
              >
                {t.active ? "Active" : "Inactive"}
              </span>
            </div>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
              <dt className="text-zinc-400 dark:text-zinc-500">Version</dt>
              <dd>
                v{t.version} ({t.effective_from})
              </dd>
            </dl>
            <div className="mt-2 flex items-center justify-end gap-3">
              <Link
                href={`/dashboard/settings/forms/${t.id}/edit`}
                className="text-xs text-teal-700 underline hover:text-teal-800"
              >
                Edit fields
              </Link>
              <form action={setFormTemplateActive.bind(null, t.id, !t.active)}>
                <StatusToggleButton label={t.active ? "Deactivate" : "Reactivate"} />
              </form>
            </div>
          </div>
        ))}
      </div>

      <table className="hidden w-full text-left text-sm sm:table">
        <thead>
          <tr className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            <th className="py-2 font-medium">Name</th>
            <th className="py-2 font-medium">Version</th>
            <th className="py-2 font-medium">Status</th>
            <th className="py-2 font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {templates.map((t) => (
            <tr key={t.id} className="border-b border-zinc-100 dark:border-zinc-900">
              <td className="py-2">
                {t.name}
                {t.description ? (
                  <span className="ml-1.5 text-zinc-500 dark:text-zinc-400">— {t.description}</span>
                ) : null}
              </td>
              <td className="py-2 text-zinc-600 dark:text-zinc-400">
                v{t.version} ({t.effective_from})
              </td>
              <td className="py-2">
                <span
                  className={
                    t.active
                      ? "text-emerald-700 dark:text-emerald-400"
                      : "text-zinc-500 dark:text-zinc-500"
                  }
                >
                  {t.active ? "Active" : "Inactive"}
                </span>
              </td>
              <td className="py-2 text-right">
                <div className="flex items-center justify-end gap-3">
                  <Link
                    href={`/dashboard/settings/forms/${t.id}/edit`}
                    className="text-xs text-teal-700 underline hover:text-teal-800"
                  >
                    Edit fields
                  </Link>
                  <form action={setFormTemplateActive.bind(null, t.id, !t.active)}>
                    <StatusToggleButton label={t.active ? "Deactivate" : "Reactivate"} />
                  </form>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
