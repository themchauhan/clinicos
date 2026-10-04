import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { ModuleToggle } from "@/components/settings/module-toggle";
import type { ModuleType } from "@/types/database";

export const metadata: Metadata = { title: "Settings — ClinicOS" };

const ALL_MODULES: { module: ModuleType; label: string }[] = [
  { module: "GENERAL_OPD", label: "General OPD" },
  { module: "USG", label: "USG" },
];

export default async function SettingsOverviewPage() {
  const supabase = await createClient();
  const { data: enabledModules } = await supabase.from("hospital_modules").select("module");
  const enabledSet = new Set((enabledModules ?? []).map((m) => m.module));

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <h2 className="text-lg font-semibold">Modules</h2>
      <div className="mt-4 flex flex-wrap gap-3">
        {ALL_MODULES.map(({ module, label }) => (
          <ModuleToggle
            key={module}
            module={module}
            label={label}
            enabled={enabledSet.has(module)}
          />
        ))}
      </div>
    </div>
  );
}
