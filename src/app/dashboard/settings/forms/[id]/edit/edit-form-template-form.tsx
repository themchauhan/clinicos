"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import {
  updateFormTemplateFields,
  type FormTemplateFormState,
  type FormTemplateFieldInput,
  type SignatureBoxInput,
  type SealBoxInput,
} from "@/app/dashboard/settings/forms/actions";
import { FormTemplateDesigner, type FormLayout } from "@/components/settings/forms/form-template-designer";
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
      {pending ? "Saving…" : "Save changes"}
    </button>
  );
}

export function EditFormTemplateForm({
  templateId,
  pdfUrl,
  initialFields,
  initialSignature,
  initialSeal,
}: {
  templateId: string;
  pdfUrl: string;
  initialFields: FormTemplateFieldInput[];
  initialSignature: SignatureBoxInput;
  initialSeal: SealBoxInput | null;
}) {
  const [state, formAction] = useActionState(
    updateFormTemplateFields.bind(null, templateId),
    initialState,
  );
  const [layout, setLayout] = useState<FormLayout>({
    fields: initialFields,
    signature: initialSignature,
    seal: initialSeal,
  });
  const router = useRouter();

  useEffect(() => {
    if (state !== initialState && !state.error) {
      router.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const canSave = layout.fields.length > 0 && Boolean(layout.signature);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
        <FormTemplateDesigner
          file={pdfUrl}
          onLayoutChange={setLayout}
          initialFields={initialFields}
          initialSignature={initialSignature}
          initialSeal={initialSeal}
        />
      </div>

      <input type="hidden" name="layout" value={JSON.stringify(layout)} />

      {state.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
      {!state.error && state !== initialState ? (
        <p className="text-sm text-emerald-700 dark:text-emerald-400">Saved.</p>
      ) : null}

      <SubmitButton disabled={!canSave} />
    </form>
  );
}
