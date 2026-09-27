"use client";

import { useState } from "react";
import { DocumentTypeForm } from "@/components/settings/document-type-form";
import type { DocumentScope } from "@/types/database";

export interface DocumentTypeRow {
  id: string;
  name: string;
  description: string | null;
  scope: DocumentScope;
  sensitive: boolean;
  pc_pndt_form: boolean;
  version: number;
  effective_from: string;
  active: boolean;
}

const SCOPE_LABELS: Record<DocumentScope, string> = { PATIENT: "Patient", VISIT: "Visit" };

export function DocumentTypeList({ documentTypes }: { documentTypes: DocumentTypeRow[] }) {
  const [editingId, setEditingId] = useState<string | null>(null);

  if (documentTypes.length === 0) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">No document types yet.</p>;
  }

  return (
    <>
      <div className="flex flex-col gap-3 sm:hidden">
        {documentTypes.map((dt) =>
          editingId === dt.id ? (
            <div key={dt.id} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <DocumentTypeForm
                documentTypeId={dt.id}
                submitLabel="Save"
                defaults={{
                  name: dt.name,
                  description: dt.description,
                  scope: dt.scope,
                  sensitive: dt.sensitive,
                  pcPndtForm: dt.pc_pndt_form,
                  active: dt.active,
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
            </div>
          ) : (
            <div key={dt.id} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="flex items-start justify-between gap-3">
                <p className="font-medium">
                  {dt.name}
                  {dt.pc_pndt_form ? (
                    <span className="ml-1.5 rounded bg-violet-100 px-1.5 py-0.5 text-xs text-violet-800 dark:bg-violet-950 dark:text-violet-300">
                      PC-PNDT
                    </span>
                  ) : null}
                </p>
                <button
                  type="button"
                  onClick={() => setEditingId(dt.id)}
                  className="shrink-0 text-sm text-teal-700 underline hover:text-teal-800"
                >
                  Edit
                </button>
              </div>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
                <dt className="text-zinc-400 dark:text-zinc-500">Scope</dt>
                <dd>{SCOPE_LABELS[dt.scope]}</dd>
                <dt className="text-zinc-400 dark:text-zinc-500">Sensitive</dt>
                <dd>{dt.sensitive ? "Yes" : "No"}</dd>
                <dt className="text-zinc-400 dark:text-zinc-500">Version</dt>
                <dd>
                  v{dt.version} ({dt.effective_from})
                </dd>
                <dt className="text-zinc-400 dark:text-zinc-500">Status</dt>
                <dd
                  className={
                    dt.active
                      ? "text-emerald-700 dark:text-emerald-400"
                      : "text-zinc-500 dark:text-zinc-500"
                  }
                >
                  {dt.active ? "Active" : "Inactive"}
                </dd>
              </dl>
            </div>
          ),
        )}
      </div>

      <table className="hidden w-full text-left text-sm sm:table">
        <thead>
          <tr className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            <th className="py-2 font-medium">Name</th>
            <th className="py-2 font-medium">Scope</th>
            <th className="py-2 font-medium">Sensitive</th>
            <th className="py-2 font-medium">Version</th>
            <th className="py-2 font-medium">Status</th>
            <th className="py-2 font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {documentTypes.map((dt) =>
            editingId === dt.id ? (
              <tr key={dt.id} className="border-b border-zinc-100 dark:border-zinc-900">
                <td colSpan={6} className="py-3">
                  <DocumentTypeForm
                    documentTypeId={dt.id}
                    submitLabel="Save"
                    defaults={{
                      name: dt.name,
                      description: dt.description,
                      scope: dt.scope,
                      sensitive: dt.sensitive,
                      pcPndtForm: dt.pc_pndt_form,
                      active: dt.active,
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
              <tr key={dt.id} className="border-b border-zinc-100 dark:border-zinc-900">
                <td className="py-2">
                  {dt.name}
                  {dt.pc_pndt_form ? (
                    <span className="ml-1.5 rounded bg-violet-100 px-1.5 py-0.5 text-xs text-violet-800 dark:bg-violet-950 dark:text-violet-300">
                      PC-PNDT
                    </span>
                  ) : null}
                </td>
                <td className="py-2 text-zinc-600 dark:text-zinc-400">{SCOPE_LABELS[dt.scope]}</td>
                <td className="py-2">{dt.sensitive ? "Yes" : "No"}</td>
                <td className="py-2 text-zinc-600 dark:text-zinc-400">
                  v{dt.version} ({dt.effective_from})
                </td>
                <td className="py-2">
                  <span
                    className={
                      dt.active
                        ? "text-emerald-700 dark:text-emerald-400"
                        : "text-zinc-500 dark:text-zinc-500"
                    }
                  >
                    {dt.active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="py-2 text-right">
                  <button
                    type="button"
                    onClick={() => setEditingId(dt.id)}
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
    </>
  );
}
