"use client";

import { useState } from "react";
import { VisitTypeForm } from "@/components/settings/visit-type-form";
import type { ModuleType } from "@/types/database";

export interface VisitTypeRow {
  id: string;
  module: ModuleType;
  name: string;
  description: string | null;
  default_fee: number | null;
  active: boolean;
}

const MODULE_LABELS: Record<ModuleType, string> = { GENERAL_OPD: "General OPD", USG: "USG" };

export function VisitTypeList({ visitTypes }: { visitTypes: VisitTypeRow[] }) {
  const [editingId, setEditingId] = useState<string | null>(null);

  if (visitTypes.length === 0) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">No visit types yet.</p>;
  }

  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <table className="w-full min-w-[560px] text-left text-sm sm:min-w-0">
        <thead>
          <tr className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            <th className="py-2 font-medium">Name</th>
            <th className="py-2 font-medium">Module</th>
            <th className="py-2 font-medium">Default fee</th>
            <th className="py-2 font-medium">Status</th>
            <th className="py-2 font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {visitTypes.map((vt) =>
            editingId === vt.id ? (
              <tr key={vt.id} className="border-b border-zinc-100 dark:border-zinc-900">
                <td colSpan={5} className="py-3">
                  <VisitTypeForm
                    visitTypeId={vt.id}
                    submitLabel="Save"
                    defaults={{
                      module: vt.module,
                      name: vt.name,
                      description: vt.description,
                      defaultFee: vt.default_fee,
                      active: vt.active,
                    }}
                    onSaved={() => setEditingId(null)}
                  />
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="mt-2 text-sm text-zinc-500 underline dark:text-zinc-400"
                  >
                    Cancel
                  </button>
                </td>
              </tr>
            ) : (
              <tr key={vt.id} className="border-b border-zinc-100 dark:border-zinc-900">
                <td className="py-2">{vt.name}</td>
                <td className="py-2 text-zinc-600 dark:text-zinc-400">
                  {MODULE_LABELS[vt.module]}
                </td>
                <td className="py-2 text-zinc-600 dark:text-zinc-400">
                  {vt.default_fee != null ? `₹${Number(vt.default_fee).toFixed(2)}` : "—"}
                </td>
                <td className="py-2">
                  <span
                    className={
                      vt.active
                        ? "text-emerald-700 dark:text-emerald-400"
                        : "text-zinc-500 dark:text-zinc-500"
                    }
                  >
                    {vt.active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="py-2 text-right">
                  <button
                    type="button"
                    onClick={() => setEditingId(vt.id)}
                    className="text-sm text-teal-700 underline hover:text-teal-800"
                  >
                    Edit
                  </button>
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}
