"use client";

import { useState, useTransition } from "react";
import { disableMfa } from "@/app/account/security/actions";
import { Spinner } from "@/components/spinner";

export function DisableMfaButton() {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await disableMfa();
      if (result?.error) {
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60"
      >
        {pending ? <Spinner /> : null}
        {pending ? "Disabling…" : "Disable two-factor authentication"}
      </button>
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
