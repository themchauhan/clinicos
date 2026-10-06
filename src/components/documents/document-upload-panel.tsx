"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { uploadDocument, type UploadDocumentState } from "@/app/dashboard/documents/actions";
import {
  createScanSession,
  getScanSessionStatus,
  type CreateScanSessionResult,
} from "@/app/dashboard/scans/actions";
import type { PairedDeviceInfo } from "@/app/dashboard/devices/actions";
import { Spinner } from "@/components/spinner";

const POLL_INTERVAL_MS = 2500;
const uploadInitialState: UploadDocumentState = {};

interface DocumentTypeOption {
  id: string;
  name: string;
  requires_signature: boolean;
}

function UploadSubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="inline-flex w-fit items-center gap-2 rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-700 disabled:opacity-60"
    >
      {pending ? <Spinner /> : null}
      {pending ? "Uploading…" : "Upload"}
    </button>
  );
}

/**
 * One shared "Document type" choice feeds both ways of capturing a
 * document -- uploading a file directly, or handing a phone/tablet to
 * the patient via the scan/sign flow -- instead of asking the same
 * question twice.
 */
export function DocumentUploadPanel({
  patientId,
  visitId,
  revalidate,
  documentTypes,
  pairedDevice,
}: {
  patientId: string;
  visitId?: string;
  revalidate: string;
  documentTypes: DocumentTypeOption[];
  pairedDevice: PairedDeviceInfo | null;
}) {
  const [documentTypeId, setDocumentTypeId] = useState("");
  const selectedType = documentTypes.find((dt) => dt.id === documentTypeId);

  const uploadAction = uploadDocument.bind(null, { patientId, visitId, revalidate });
  const [uploadState, uploadFormAction] = useActionState(uploadAction, uploadInitialState);

  const router = useRouter();
  const [session, setSession] = useState<CreateScanSessionResult | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [done, setDone] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [sessionRequiresSignature, setSessionRequiresSignature] = useState(false);
  const lastPageCount = useRef(0);

  const deviceIsConnected = Boolean(pairedDevice?.confirmedAt);

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

  async function handleStart(useConnectedDevice: boolean) {
    if (!documentTypeId) {
      setScanError("Choose a document type first.");
      return;
    }
    setScanError(null);
    setStarting(true);
    const result = await createScanSession({
      patientId,
      visitId,
      documentTypeId,
      pairedDeviceId: useConnectedDevice && pairedDevice ? pairedDevice.id : undefined,
    });
    setStarting(false);
    if ("error" in result) {
      setScanError(result.error);
      return;
    }
    lastPageCount.current = 0;
    setPageCount(0);
    setDone(false);
    setSessionRequiresSignature(selectedType?.requires_signature ?? false);
    setSession(result);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="documentTypeId" className="text-sm font-medium">
          Document type
        </label>
        <select
          id="documentTypeId"
          value={documentTypeId}
          onChange={(e) => setDocumentTypeId(e.target.value)}
          className="w-fit rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600"
        >
          <option value="">Choose a type</option>
          {documentTypes.map((dt) => (
            <option key={dt.id} value={dt.id}>
              {dt.name}
            </option>
          ))}
        </select>
      </div>

      {session && !done ? (
        session.pairedDevice ? (
          <div className="flex flex-col items-start gap-3 rounded-md border border-zinc-300 p-4 text-sm dark:border-zinc-700">
            <p className="font-medium">
              {sessionRequiresSignature ? "Sign on phone" : "Scan with phone"}
            </p>
            <p className="text-zinc-500 dark:text-zinc-400">
              Sent to your connected device — waiting…
            </p>
            <button
              type="button"
              onClick={() => setSession(null)}
              className="text-sm text-teal-700 underline hover:text-teal-800"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-start gap-3 rounded-md border border-zinc-300 p-4 text-sm dark:border-zinc-700">
            <p className="font-medium">
              {sessionRequiresSignature ? "Sign on phone" : "Scan with phone"}
            </p>
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
              Already on the phone or tablet? Open it directly instead of scanning:
            </p>
            <a
              href={session.scanUrl}
              target="_blank"
              rel="noreferrer"
              className="w-fit rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              {sessionRequiresSignature ? "Open to sign" : "Open to scan"}
            </a>
            <p className="text-zinc-500 dark:text-zinc-400">
              {sessionRequiresSignature
                ? "Waiting for signature…"
                : pageCount > 0
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
        )
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <form action={uploadFormAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="documentTypeId" value={documentTypeId} />
            <div className="flex flex-col gap-1.5">
              <label htmlFor="file" className="text-sm font-medium">
                File (JPEG, PNG, or PDF)
              </label>
              <input
                id="file"
                name="file"
                type="file"
                accept="image/jpeg,image/png,application/pdf"
                required
                className="text-sm file:mr-3 file:rounded-md file:border file:border-zinc-300 file:bg-transparent file:px-3 file:py-1.5 file:text-sm dark:file:border-zinc-700"
              />
            </div>
            <UploadSubmitButton disabled={!documentTypeId} />
          </form>

          <div className="flex flex-col items-start gap-1.5">
            <button
              type="button"
              onClick={() => handleStart(true)}
              disabled={starting || !documentTypeId}
              className="inline-flex w-fit items-center gap-2 rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              {starting ? <Spinner /> : null}
              {starting
                ? "Starting…"
                : done
                  ? "Scan another"
                  : selectedType?.requires_signature
                    ? "Sign on phone"
                    : "Scan with phone"}
            </button>
            {deviceIsConnected ? (
              <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                <button
                  type="button"
                  onClick={() => handleStart(false)}
                  disabled={starting || !documentTypeId}
                  className="underline hover:text-zinc-700 disabled:opacity-60"
                >
                  Use a QR instead
                </button>
                <span>·</span>
                <Link href="/dashboard/devices" className="underline hover:text-zinc-700">
                  Manage connected device
                </Link>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {uploadState.notice ? (
        <p role="status" className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
          {uploadState.notice}
        </p>
      ) : null}
      {uploadState.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {uploadState.error}
        </p>
      ) : null}
      {scanError ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {scanError}
        </p>
      ) : null}
      {done ? (
        <p className="text-sm text-emerald-700 dark:text-emerald-400">
          {sessionRequiresSignature
            ? "Signature captured."
            : `Scan finished — ${pageCount} page${pageCount === 1 ? "" : "s"} added.`}
        </p>
      ) : null}
    </div>
  );
}
