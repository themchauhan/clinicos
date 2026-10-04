"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Spinner } from "@/components/spinner";
import { ordinal } from "@/lib/visits/ordinal";
import { LinkPendingSpinner } from "@/components/link-pending-spinner";

export interface VisitRowData {
  id: string;
  visitDate: string;
  tokenNumber: number;
  /** This patient's nth visit overall (1 = first ever). Only passed on
   * the patient profile, where it's meaningful; the cross-patient list
   * leaves it out. */
  patientVisitNumber?: number;
  visitTypeName: string;
  paymentLabel: string;
  /** Omitted on the patient profile page, where the patient is already
   * implied by context; shown as its own column (and its own link,
   * separate from the row's own visit-detail destination) on the
   * cross-patient Visits list. */
  patient?: { id: string; name: string; patientCode: string };
}

/**
 * A whole clickable/hoverable table row for a visit -- mirrors
 * PatientRow's pattern (imperative row-level navigation via
 * useTransition, real inner <Link>s with stopPropagation so keyboard
 * and screen-reader users still get a proper link target, a pending
 * spinner either way). Used by both the Visits list and the patient
 * profile page's own Visits table, which previously only made the
 * bare "#123" text clickable.
 */
export function VisitRow({
  visit,
  hideDate = false,
}: {
  visit: VisitRowData;
  /** The Today tab already says which day it is. */
  hideDate?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const href = `/dashboard/visits/${visit.id}`;

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
      {hideDate ? null : (
        <td className="py-2 text-zinc-600 dark:text-zinc-400">{visit.visitDate}</td>
      )}
      {visit.patientVisitNumber !== undefined ? (
        <td className="py-2">{ordinal(visit.patientVisitNumber)}</td>
      ) : null}
      {visit.patient ? (
        <td className="py-2">
          <Link
            href={`/dashboard/patients/${visit.patient.id}`}
            className="hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {visit.patient.name} ({visit.patient.patientCode})
            <LinkPendingSpinner />
          </Link>
        </td>
      ) : null}
      <td className="py-2">
        <Link href={href} className="hover:underline" onClick={(e) => e.stopPropagation()}>
          #{visit.tokenNumber}
          <LinkPendingSpinner />
        </Link>
        {pending ? <Spinner className="ml-1.5 inline h-3 w-3 align-[-1px]" /> : null}
      </td>
      <td className="py-2">{visit.visitTypeName}</td>
      <td className="py-2 text-zinc-600 dark:text-zinc-400">{visit.paymentLabel}</td>
    </tr>
  );
}
