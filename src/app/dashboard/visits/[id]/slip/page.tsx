import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/auth/session";
import { PrintButton } from "@/components/visits/print-button";

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
    .select("*, patients(name, patient_code), visit_types(name), doctors(name)")
    .eq("id", id)
    .maybeSingle();

  if (!visit) {
    notFound();
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-12 print:py-0">
      <div className="border-b-2 border-zinc-900 pb-4 dark:border-zinc-100">
        <h1 className="text-2xl font-bold">{profile?.hospital?.name ?? "Centre"}</h1>
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
        <dt className="text-zinc-500 dark:text-zinc-400">Patient</dt>
        <dd className="font-medium">
          {visit.patients!.name} ({visit.patients!.patient_code})
        </dd>

        <dt className="text-zinc-500 dark:text-zinc-400">Visit #</dt>
        <dd className="font-medium">{visit.visit_number}</dd>

        <dt className="text-zinc-500 dark:text-zinc-400">Date</dt>
        <dd className="font-medium">{visit.visit_date}</dd>

        <dt className="text-zinc-500 dark:text-zinc-400">Visit type</dt>
        <dd className="font-medium">{visit.visit_types!.name}</dd>

        <dt className="text-zinc-500 dark:text-zinc-400">Doctor</dt>
        <dd className="font-medium">{visit.doctors?.name ?? "—"}</dd>
      </dl>

      <div className="mt-10 flex-1 border border-dashed border-zinc-300 dark:border-zinc-700" />

      <PrintButton />
    </main>
  );
}
