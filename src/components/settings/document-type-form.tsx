"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import {
  createDocumentType,
  updateDocumentType,
  type DocumentTypeFormState,
} from "@/app/dashboard/settings/actions";
import type { DocumentScope } from "@/types/database";

const initialState: DocumentTypeFormState = {};

export interface DocumentTypeDefaults {
  name?: string;
  description?: string | null;
  scope?: DocumentScope;
  sensitive?: boolean;
  pcPndtForm?: boolean;
  requiresSignature?: boolean;
  active?: boolean;
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-fit rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-700 disabled:opacity-60"
    >
      {pending ? "Saving…" : label}
    </button>
  );
}

export function DocumentTypeForm({
  documentTypeId,
  defaults,
  submitLabel = "Add document type",
  onSaved,
}: {
  documentTypeId?: string;
  defaults?: DocumentTypeDefaults;
  submitLabel?: string;
  onSaved?: () => void;
}) {
  const action = documentTypeId
    ? updateDocumentType.bind(null, documentTypeId)
    : createDocumentType;
  const [state, formAction] = useActionState(action, initialState);
  const idPrefix = documentTypeId ?? "new";

  // See visit-type-form.tsx's identical effect for why this checks
  // object identity against `initialState` rather than a boolean flag.
  useEffect(() => {
    if (state !== initialState && !state.error) {
      onSaved?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`dt-name-${idPrefix}`} className="text-sm font-medium">
            Document type name
          </label>
          <input
            id={`dt-name-${idPrefix}`}
            name="name"
            type="text"
            required
            defaultValue={defaults?.name}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`dt-description-${idPrefix}`} className="text-sm font-medium">
            Document type description
          </label>
          <input
            id={`dt-description-${idPrefix}`}
            name="description"
            type="text"
            defaultValue={defaults?.description ?? ""}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600"
          />
        </div>

        {documentTypeId ? (
          <input type="hidden" name="scope" value={defaults?.scope} />
        ) : (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`dt-scope-${idPrefix}`} className="text-sm font-medium">
              Scope
            </label>
            <select
              id={`dt-scope-${idPrefix}`}
              name="scope"
              required
              defaultValue=""
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600"
            >
              <option value="" disabled>
                Choose a scope
              </option>
              <option value="PATIENT">Patient (captured once, reused)</option>
              <option value="VISIT">Visit (expected fresh each time)</option>
            </select>
          </div>
        )}

        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" name="sensitive" defaultChecked={defaults?.sensitive ?? false} />
          Sensitive
        </label>

        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" name="pcPndtForm" defaultChecked={defaults?.pcPndtForm ?? false} />
          PC-PNDT declaration
        </label>

        <label className="flex items-center gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            name="requiresSignature"
            defaultChecked={defaults?.requiresSignature ?? false}
          />
          Requires signature
        </label>

        {documentTypeId ? (
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input type="checkbox" name="active" defaultChecked={defaults?.active ?? true} />
            Active
          </label>
        ) : (
          <input type="hidden" name="active" value="on" />
        )}

        <SubmitButton label={submitLabel} />
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
