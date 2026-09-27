"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";

export interface PatientRowData {
  id: string;
  patient_code: string;
  name: string;
  mobile: string | null;
  guardian_name: string | null;
}

/**
 * The whole row navigates on click/tap (mobile users don't reliably
 * hit the exact Name text), while patient_code/name stay real <Link>s
 * so keyboard and screen-reader users still get a proper link target.
 */
export function PatientRow({ patient }: { patient: PatientRowData }) {
  const router = useRouter();
  const href = `/dashboard/patients/${patient.id}`;

  return (
    <tr
      onClick={() => router.push(href)}
      className="cursor-pointer border-b border-zinc-100 last:border-0 hover:bg-slate-50 dark:border-zinc-900"
    >
      <td className="py-2">
        <Link
          href={href}
          className="font-mono text-zinc-600 hover:underline dark:text-zinc-400"
          onClick={(e) => e.stopPropagation()}
        >
          {patient.patient_code}
        </Link>
      </td>
      <td className="py-2">
        <Link href={href} className="hover:underline" onClick={(e) => e.stopPropagation()}>
          {patient.name}
        </Link>
      </td>
      <td className="py-2 text-zinc-600 dark:text-zinc-400">{patient.mobile ?? "—"}</td>
      <td className="py-2 text-zinc-600 dark:text-zinc-400">{patient.guardian_name ?? "—"}</td>
    </tr>
  );
}
