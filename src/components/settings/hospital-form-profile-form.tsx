"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  saveHospitalFormProfile,
  getHospitalSealViewUrl,
  type HospitalFormProfileState,
} from "@/app/dashboard/settings/actions";
import { Spinner } from "@/components/spinner";

const initialState: HospitalFormProfileState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex w-fit items-center gap-2 rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-700 disabled:opacity-60"
    >
      {pending ? <Spinner /> : null}
      {pending ? "Saving…" : "Save details"}
    </button>
  );
}

export function HospitalFormProfileForm({
  hospitalName,
  hospitalAddress,
  centreName,
  centreAddress,
  registrationNo,
  hasSeal,
}: {
  /** The hospital's own registered name/address -- shown as
   * placeholder text so staff know what a blank override falls back
   * to, not a value in its own right. */
  hospitalName: string;
  hospitalAddress: string;
  centreName: string | null;
  centreAddress: string | null;
  registrationNo: string | null;
  hasSeal: boolean;
}) {
  const [state, formAction] = useActionState(saveHospitalFormProfile, initialState);
  const [sealPreviewUrl, setSealPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!hasSeal) return;
    void getHospitalSealViewUrl().then((result) => {
      if ("url" in result) setSealPreviewUrl(result.url);
    });
  }, [hasSeal, state]);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="centreName" className="text-sm font-medium">
            Centre name (if different from &ldquo;{hospitalName}&rdquo;)
          </label>
          <input
            id="centreName"
            name="centreName"
            type="text"
            defaultValue={centreName ?? ""}
            placeholder={hospitalName}
            className="w-64 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="centreAddress" className="text-sm font-medium">
            Centre address (if different)
          </label>
          <input
            id="centreAddress"
            name="centreAddress"
            type="text"
            defaultValue={centreAddress ?? ""}
            placeholder={hospitalAddress}
            className="w-64 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="registrationNo" className="text-sm font-medium">
            PC&amp;PNDT registration number
          </label>
          <input
            id="registrationNo"
            name="registrationNo"
            type="text"
            defaultValue={registrationNo ?? ""}
            className="w-64 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="seal" className="text-sm font-medium">
            Clinic seal/stamp (PNG or JPEG)
          </label>
          <input
            id="seal"
            name="seal"
            type="file"
            accept="image/png,image/jpeg"
            className="text-sm file:mr-3 file:rounded-md file:border file:border-zinc-300 file:bg-transparent file:px-3 file:py-1.5 file:text-sm dark:file:border-zinc-700"
          />
          {sealPreviewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- sealPreviewUrl is a short-lived signed URL, not a static asset next/image can optimize.
            <img
              src={sealPreviewUrl}
              alt="Currently saved seal"
              className="mt-1 h-16 w-16 rounded border border-zinc-200 object-contain dark:border-zinc-800"
            />
          ) : null}
        </div>
      </div>

      <SubmitButton />

      {state.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
