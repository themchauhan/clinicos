"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { formatGuardian, type GuardianRelation } from "@/lib/patients/guardian";
import { Spinner } from "@/components/spinner";
import { LinkPendingSpinner } from "@/components/link-pending-spinner";

export interface PatientRowData {
  id: string;
  patient_code: string;
  name: string;
  mobile: string | null;
  guardian_name: string | null;
  guardian_relation: GuardianRelation | null;
}

/**
 * The whole row navigates on click/tap (mobile users don't reliably
 * hit the exact Name text), while patient_code/name stay real <Link>s
 * so keyboard and screen-reader users still get a proper link target.
 */
export function PatientRow({ patient }: { patient: PatientRowData }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const href = `/dashboard/patients/${patient.id}`;

  function handleRowClick() {
    startTransition(() => {
      router.push(href);
    });
  }

  return (
    <tr
      onClick={handleRowClick}
      className={
        "cursor-pointer border-b border-zinc-100 last:border-0 hover:bg-slate-50 dark:border-zinc-900" +
        (pending ? " opacity-60" : "")
      }
    >
      <td className="py-2">
        <Link
          href={href}
          className="font-mono text-zinc-600 hover:underline dark:text-zinc-400"
          onClick={(e) => e.stopPropagation()}
        >
          {patient.patient_code}
          <LinkPendingSpinner />
        </Link>
      </td>
      <td className="py-2">
        <Link href={href} className="hover:underline" onClick={(e) => e.stopPropagation()}>
          {patient.name}
          <LinkPendingSpinner />
        </Link>
        {pending ? <Spinner className="ml-1.5 inline h-3 w-3 align-[-1px]" /> : null}
      </td>
      <td className="py-2 text-zinc-600 dark:text-zinc-400">{patient.mobile ?? "—"}</td>
      <td className="py-2 text-zinc-600 dark:text-zinc-400">
        {formatGuardian(patient.guardian_relation, patient.guardian_name)}
      </td>
    </tr>
  );
}

/** Mobile counterpart to PatientRow — a table row doesn't fit a phone
 * screen usefully, so this renders the same data as a stacked card. */
export function PatientCard({ patient }: { patient: PatientRowData }) {
  return (
    <Link
      href={`/dashboard/patients/${patient.id}`}
      className="block rounded-lg border border-zinc-200 p-4 transition-colors hover:bg-slate-50 dark:border-zinc-800"
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-medium">
          {patient.name}
          <LinkPendingSpinner />
        </p>
        <p className="font-mono text-xs text-zinc-500 dark:text-zinc-400">{patient.patient_code}</p>
      </div>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
        <dt className="text-zinc-400 dark:text-zinc-500">Mobile</dt>
        <dd>{patient.mobile ?? "—"}</dd>
        <dt className="text-zinc-400 dark:text-zinc-500">Guardian</dt>
        <dd>{formatGuardian(patient.guardian_relation, patient.guardian_name)}</dd>
      </dl>
    </Link>
  );
}
