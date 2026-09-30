import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/auth/session";
import { PrintButton } from "@/components/visits/print-button";
import { ageInYears } from "@/lib/patients/age";

export const metadata: Metadata = { title: "Slip — ClinicOS" };

/**
 * Printable OPD slip: centre header, patient name/code, date, doctor,
 * visit number, and blank space for the doctor to write on paper (per
 * the brief — the image/paper is the source of truth, this just
 * avoids re-writing the header details by hand each time). The nav
 * shell is hidden via `print:hidden` in nav-shell.tsx, not by
 * restructuring the layout tree for one page.
 */
export default async function VisitSlipPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const profile = await getSessionProfile();

  const { data: visit } = await supabase
    .from("visits")
    .select(
      "*, patients(name, patient_code, dob, approximate_age_years), visit_types(name), doctors(name)",
    )
    .eq("id", id)
    .maybeSingle();

  if (!visit) {
    notFound();
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-8 print:py-0">
      <div className="flex items-baseline justify-between gap-4 border-b-2 border-zinc-900 pb-2 dark:border-zinc-100">
        <h1 className="text-lg font-bold">{profile?.hospital?.name ?? "Centre"}</h1>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{visit.visit_date}</p>
      </div>

      {/* One wrapped row instead of a tall label/value grid -- the
          point of this slip is the blank space below it for the
          doctor to write on, so the header should take as little of
          the page as it can while still being legible. */}
      <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        <span>
          <span className="text-zinc-500 dark:text-zinc-400">Patient: </span>
          <span className="font-medium">
            {visit.patients!.name} ({visit.patients!.patient_code})
          </span>
        </span>
        <span>
          <span className="text-zinc-500 dark:text-zinc-400">Visit #: </span>
          <span className="font-medium">{visit.visit_number}</span>
        </span>
        <span>
          <span className="text-zinc-500 dark:text-zinc-400">Type: </span>
          <span className="font-medium">{visit.visit_types!.name}</span>
        </span>
        <span>
          <span className="text-zinc-500 dark:text-zinc-400">Doctor: </span>
          <span className="font-medium">{visit.doctors?.name ?? "—"}</span>
        </span>
      </p>

      {/* Vitals: Age is known from the patient's own record; Temp and
          BP aren't captured anywhere in this app, so they're blank
          lines for whoever takes vitals to fill in by hand, same
          spirit as the writing area below. Its own row, visually
          separated from the identity row above, since it's a
          different kind of information (measurements to be taken,
          not facts already on file). */}
      <p className="mt-2 flex flex-wrap items-baseline gap-x-5 gap-y-1 border-t border-zinc-200 pt-2 text-sm dark:border-zinc-800">
        <span>
          <span className="text-zinc-500 dark:text-zinc-400">Age: </span>
          <span className="font-medium">
            {ageInYears(visit.patients!.dob, visit.patients!.approximate_age_years)}
          </span>
        </span>
        <span className="inline-flex items-baseline gap-1.5">
          <span className="text-zinc-500 dark:text-zinc-400">Temp:</span>
          <span className="inline-block w-20 border-b border-zinc-400 dark:border-zinc-600">
            &nbsp;
          </span>
        </span>
        <span className="inline-flex items-baseline gap-1.5">
          <span className="text-zinc-500 dark:text-zinc-400">BP:</span>
          <span className="inline-block w-24 border-b border-zinc-400 dark:border-zinc-600">
            &nbsp;
          </span>
        </span>
      </p>

      <div className="mt-4 flex-1 border border-dashed border-zinc-300 dark:border-zinc-700" />

      <PrintButton />
    </main>
  );
}
