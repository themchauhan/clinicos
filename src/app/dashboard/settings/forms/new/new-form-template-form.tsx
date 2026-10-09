"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { createFormTemplate, type FormTemplateFormState } from "../actions";
import {
  FormTemplateDesigner,
  type FormLayout,
} from "@/components/settings/forms/form-template-designer";
import { Spinner } from "@/components/spinner";

const initialState: FormTemplateFormState = {};

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="inline-flex w-fit items-center gap-2 rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-700 disabled:opacity-60"
    >
      {pending ? <Spinner /> : null}
      {pending ? "Saving…" : "Save form template"}
    </button>
  );
}

export function NewFormTemplateForm() {
  const [state, formAction] = useActionState(createFormTemplate, initialState);
  const [file, setFile] = useState<File | null>(null);
  const [layout, setLayout] = useState<FormLayout>({
    fields: [],
    signature: null,
    seal: null,
    doctorSignature: null,
    extraStamps: [],
  });
  const router = useRouter();

  useEffect(() => {
    if (state !== initialState && !state.error) {
      router.push("/dashboard/settings/forms");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const canSave = Boolean(file) && layout.fields.length > 0 && Boolean(layout.signature);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex max-w-sm flex-col gap-1.5">
        <label htmlFor="name" className="text-sm font-medium">
          Form name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600"
        />
      </div>

      <div className="flex max-w-sm flex-col gap-1.5">
        <label htmlFor="description" className="text-sm font-medium">
          Description
        </label>
        <input
          id="description"
          name="description"
          type="text"
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600"
        />
      </div>

      <div className="flex max-w-sm flex-col gap-1.5">
        <label htmlFor="file" className="text-sm font-medium">
          Blank form (PDF)
        </label>
        <input
          id="file"
          name="file"
          type="file"
          accept="application/pdf"
          required
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setLayout({
              fields: [],
              signature: null,
              seal: null,
              doctorSignature: null,
              extraStamps: [],
            });
          }}
          className="text-sm file:mr-3 file:rounded-md file:border file:border-zinc-300 file:bg-transparent file:px-3 file:py-1.5 file:text-sm dark:file:border-zinc-700"
        />
      </div>

      {file ? (
        <div className="rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
          <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
            Click the form below to place each field, then place the signature box. Both are
            required before saving.
          </p>
          <FormTemplateDesigner file={file} onLayoutChange={setLayout} />
        </div>
      ) : null}

      <input type="hidden" name="layout" value={JSON.stringify(layout)} />

      {state.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}

      <SubmitButton disabled={!canSave} />
    </form>
  );
}
