"use client";

import { useTransition } from "react";
import { setRequirement } from "@/app/dashboard/settings/actions";

interface VisitTypeRow {
  id: string;
  name: string;
  active: boolean;
}

interface DocumentTypeRow {
  id: string;
  name: string;
  active: boolean;
}

interface RequirementRow {
  visit_type_id: string;
  document_type_id: string;
  required: boolean;
}

// Tri-state: not associated at all / associated but optional /
// associated and required. Cycling click order: none -> required ->
// optional -> none, since "required" is the far more common case a
// centre reaches for first.
function nextState(current: boolean | null): boolean | null {
  if (current === null) return true;
  if (current === true) return false;
  return null;
}

function cellLabel(state: boolean | null): string {
  if (state === null) return "—";
  return state ? "Required" : "Optional";
}

function Cell({
  visitTypeId,
  visitTypeName,
  documentTypeId,
  required,
}: {
  visitTypeId: string;
  visitTypeName: string;
  documentTypeId: string;
  required: boolean | null;
}) {
  const [pending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      await setRequirement(visitTypeId, documentTypeId, nextState(required));
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      aria-label={`${visitTypeName}: ${cellLabel(required)}`}
      className={
        required === null
          ? "w-full rounded px-2 py-1 text-zinc-400 hover:bg-zinc-100 disabled:opacity-60 dark:text-zinc-600 dark:hover:bg-zinc-900"
          : required
            ? "w-full rounded bg-amber-100 px-2 py-1 text-amber-800 hover:bg-amber-200 disabled:opacity-60 dark:bg-amber-950 dark:text-amber-300"
            : "w-full rounded bg-zinc-100 px-2 py-1 text-zinc-700 hover:bg-zinc-200 disabled:opacity-60 dark:bg-zinc-900 dark:text-zinc-300"
      }
    >
      {cellLabel(required)}
    </button>
  );
}

export function RequirementsMatrix({
  visitTypes,
  documentTypes,
  requirements,
}: {
  visitTypes: VisitTypeRow[];
  documentTypes: DocumentTypeRow[];
  requirements: RequirementRow[];
}) {
  const activeVisitTypes = visitTypes.filter((vt) => vt.active);
  const activeDocumentTypes = documentTypes.filter((dt) => dt.active);

  if (activeVisitTypes.length === 0 || activeDocumentTypes.length === 0) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Add at least one active visit type and one active document type first.
      </p>
    );
  }

  const requirementByKey = new Map(
    requirements.map((r) => [`${r.visit_type_id}:${r.document_type_id}`, r.required]),
  );

  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <table className="text-left text-sm">
        <thead>
          <tr className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            <th className="py-2 pr-4 font-medium whitespace-nowrap">Document type</th>
            {activeVisitTypes.map((vt) => (
              <th key={vt.id} className="px-2 py-2 font-medium whitespace-nowrap">
                {vt.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {activeDocumentTypes.map((dt) => (
            <tr key={dt.id} className="border-b border-zinc-100 dark:border-zinc-900">
              <td className="py-2 pr-4 whitespace-nowrap">{dt.name}</td>
              {activeVisitTypes.map((vt) => (
                <td key={vt.id} className="px-2 py-2">
                  <Cell
                    visitTypeId={vt.id}
                    visitTypeName={vt.name}
                    documentTypeId={dt.id}
                    required={requirementByKey.get(`${vt.id}:${dt.id}`) ?? null}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
