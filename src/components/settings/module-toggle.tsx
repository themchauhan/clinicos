"use client";

import { useTransition } from "react";
import { enableModule, disableModule } from "@/app/dashboard/settings/actions";
import type { ModuleType } from "@/types/database";
import { Spinner } from "@/components/spinner";

export function ModuleToggle({
  module,
  label,
  enabled,
}: {
  module: ModuleType;
  label: string;
  enabled: boolean;
}) {
  const [pending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      await (enabled ? disableModule(module) : enableModule(module));
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className={
        enabled
          ? "inline-flex items-center gap-2 rounded-md border border-emerald-600 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-800 transition-colors disabled:opacity-60 dark:border-emerald-500 dark:bg-emerald-950 dark:text-emerald-300"
          : "inline-flex items-center gap-2 rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-500 transition-colors hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
      }
    >
      {pending ? <Spinner /> : null}
      {label} — {enabled ? "Enabled" : "Disabled"}
    </button>
  );
}
