"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateOfflineSync } from "@/app/admin/actions";

export function HospitalOfflineForm({
  hospitalId,
  enabled,
}: {
  hospitalId: string;
  enabled: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle(next: boolean) {
    if (
      !next &&
      !window.confirm(
        "Turn offline mode off for this centre? Records already queued on its computers stay safely queued and sync again when it is turned back on.",
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await updateOfflineSync(hospitalId, next);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={enabled}
          disabled={pending}
          onChange={(e) => toggle(e.target.checked)}
        />
        Offline mode (register patients and visits when the internet is down)
      </label>
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
