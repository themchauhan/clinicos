"use client";

import { useState, useTransition } from "react";
import { setVisitExaminationStatus } from "@/app/dashboard/visits/actions";
import type { VisitStatus } from "@/types/database";
import { Spinner } from "@/components/spinner";

const NEXT_STATUS: Partial<
  Record<VisitStatus, { next: "IN_PROGRESS" | "COMPLETED"; label: string }>
> = {
  SCHEDULED: { next: "IN_PROGRESS", label: "Start examination" },
  IN_PROGRESS: { next: "COMPLETED", label: "Mark completed" },
};

const STATUS_LABELS: Record<VisitStatus, string> = {
  SCHEDULED: "Waiting",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export function StatusTransitionButtons({
  visitId,
  status,
}: {
  visitId: string;
  status: VisitStatus;
}) {
  const [currentStatus, setCurrentStatus] = useState(status);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const transition = NEXT_STATUS[currentStatus];

  function handleClick() {
    if (!transition) return;
    setError(null);
    startTransition(async () => {
      const result = await setVisitExaminationStatus(visitId, transition.next);
      if (result.error) {
        setError(result.error);
        return;
      }
      setCurrentStatus(transition.next);
    });
  }

  return (
    <span className="inline-flex items-center gap-3">
      <span
        className={
          currentStatus === "COMPLETED"
            ? "text-emerald-700 dark:text-emerald-400"
            : currentStatus === "IN_PROGRESS"
              ? "text-amber-700 dark:text-amber-400"
              : "text-zinc-600 dark:text-zinc-400"
        }
      >
        {STATUS_LABELS[currentStatus]}
      </span>
      {transition ? (
        <button
          type="button"
          onClick={handleClick}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-3 py-1 text-xs transition-colors hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          {pending ? <Spinner className="h-3 w-3" /> : null}
          {pending ? "Saving…" : transition.label}
        </button>
      ) : null}
      {error ? (
        <span role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </span>
      ) : null}
    </span>
  );
}
