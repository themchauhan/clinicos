"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createScanSession,
  getScanSessionStatus,
  type CreateScanSessionResult,
} from "@/app/dashboard/scans/actions";

const POLL_INTERVAL_MS = 2500;

interface DocumentTypeOption {
  id: string;
  name: string;
}

export function ScanWithPhoneButton({
  patientId,
  visitId,
  documentTypes,
}: {
  patientId: string;
  visitId?: string;
  documentTypes: DocumentTypeOption[];
}) {
  const router = useRouter();
  const [documentTypeId, setDocumentTypeId] = useState("");
  const [session, setSession] = useState<CreateScanSessionResult | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const lastPageCount = useRef(0);

  useEffect(() => {
    if (!session || done) return;
    const interval = setInterval(async () => {
      const result = await getScanSessionStatus(session.sessionId);
      if ("error" in result) return;
      if (result.pageCount !== lastPageCount.current) {
        lastPageCount.current = result.pageCount;
        setPageCount(result.pageCount);
        router.refresh();
      }
      if (result.status === "COMPLETED") {
        setDone(true);
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [session, done, router]);

  async function handleStart() {
    if (!documentTypeId) {
      setError("Choose a document type first.");
      return;
    }
    setError(null);
    setStarting(true);
    const result = await createScanSession({ patientId, visitId, documentTypeId });
    setStarting(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    lastPageCount.current = 0;
    setPageCount(0);
    setDone(false);
    setSession(result);
  }

  if (session && !done) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-md border border-zinc-300 p-4 text-sm dark:border-zinc-700">
        <p className="font-medium">Scan with phone</p>
        {/* eslint-disable-next-line @next/next/no-img-element -- qrDataUrl
            is a data: URI generated per-session, not a static asset
            next/image can optimize. */}
        <img
          src={session.qrDataUrl}
          alt="QR code to open the scan page on a phone"
          width={180}
          height={180}
          className="rounded-md border border-slate-200 bg-white p-2"
        />
        <p className="text-zinc-500 dark:text-zinc-400">
          Or open this link on the phone directly:{" "}
          <a href={session.scanUrl} className="underline" target="_blank" rel="noreferrer">
            {session.scanUrl}
          </a>
        </p>
        <p className="text-zinc-500 dark:text-zinc-400">
          {pageCount > 0
            ? `${pageCount} page${pageCount === 1 ? "" : "s"} uploaded so far…`
            : "Waiting for a page…"}
        </p>
        <button
          type="button"
          onClick={() => setSession(null)}
          className="text-sm text-teal-700 underline hover:text-teal-800"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="scanDocumentTypeId" className="text-sm font-medium">
            Scan document type
          </label>
          <select
            id="scanDocumentTypeId"
            value={documentTypeId}
            onChange={(e) => setDocumentTypeId(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600"
          >
            <option value="">Choose a type</option>
            {documentTypes.map((dt) => (
              <option key={dt.id} value={dt.id}>
                {dt.name}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={handleStart}
          disabled={starting}
          className="w-fit rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          {starting ? "Starting…" : done ? "Scan another" : "Scan with phone"}
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
      {done ? (
        <p className="text-sm text-emerald-700 dark:text-emerald-400">
          Scan finished — {pageCount} page{pageCount === 1 ? "" : "s"} added.
        </p>
      ) : null}
    </div>
  );
}
