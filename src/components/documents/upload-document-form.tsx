"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { uploadDocument, type UploadDocumentState } from "@/app/dashboard/documents/actions";

const initialState: UploadDocumentState = {};

interface DocumentTypeOption {
  id: string;
  name: string;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-fit rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-700 disabled:opacity-60"
    >
      {pending ? "Uploading…" : "Upload"}
    </button>
  );
}

export function UploadDocumentForm({
  patientId,
  visitId,
  revalidate,
  documentTypes,
}: {
  patientId: string;
  visitId?: string;
  revalidate: string;
  documentTypes: DocumentTypeOption[];
}) {
  const action = uploadDocument.bind(null, { patientId, visitId, revalidate });
  const [state, formAction] = useActionState(action, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="documentTypeId" className="text-sm font-medium">
            Document type
          </label>
          <select
            id="documentTypeId"
            name="documentTypeId"
            required
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600"
          >
            <option value="">Choose a type</option>
            {documentTypes.map((dt) => (
              <option key={dt.id} value={dt.id}>
                {dt.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="file" className="text-sm font-medium">
            File (JPEG, PNG, or PDF)
          </label>
          <input
            id="file"
            name="file"
            type="file"
            accept="image/jpeg,image/png,application/pdf"
            required
            className="text-sm file:mr-3 file:rounded-md file:border file:border-zinc-300 file:bg-transparent file:px-3 file:py-1.5 file:text-sm dark:file:border-zinc-700"
          />
        </div>

        <SubmitButton />
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
