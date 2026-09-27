"use client";

import { useEffect, useRef, useState } from "react";
import {
  getScanSessionInfo,
  submitScanPage,
  submitScanSignature,
  deleteScanPage,
  reorderScanPage,
  finishScanSession,
  type ScanSessionInfoResult,
} from "@/app/scan/actions";
import { SignaturePad } from "@/components/scans/signature-pad";

interface Page {
  id: string;
  pageNo: number;
  previewUrl?: string;
}

const ERROR_MESSAGES: Record<string, string> = {
  invalid: "This link isn't valid. Ask reception for a fresh QR code.",
  expired: "This link has expired. Ask reception for a fresh QR code.",
  completed: "This scan session is already finished. Ask reception for a fresh QR code.",
};

export default function ScanPage() {
  const [token, setToken] = useState<string | null>(null);
  const [info, setInfo] = useState<ScanSessionInfoResult | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [preview, setPreview] = useState<{ file: File; url: string } | null>(null);
  const [finished, setFinished] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const rawToken = window.location.hash.slice(1);
      if (!rawToken) {
        if (!cancelled) setInfo({ error: "invalid" });
        return;
      }
      setToken(rawToken);
      const result = await getScanSessionInfo(rawToken);
      if (cancelled) return;
      setInfo(result);
      if (!("error" in result)) {
        setPages(result.existingPages.map((p) => ({ id: p.id, pageNo: p.pageNo })));
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPreview({ file, url: URL.createObjectURL(file) });
    e.target.value = "";
  }

  async function handleConfirm() {
    if (!preview || !token) return;
    setBusy(true);
    setError(null);
    const formData = new FormData();
    formData.set("file", preview.file);
    const result = await submitScanPage(token, formData);
    setBusy(false);
    if (result.error || !result.documentId) {
      setError(result.error ?? "Could not upload that photo.");
      return;
    }
    setPages((prev) => [
      ...prev,
      { id: result.documentId!, pageNo: prev.length + 1, previewUrl: preview.url },
    ]);
    setPreview(null);
  }

  function handleRetake() {
    if (preview) URL.revokeObjectURL(preview.url);
    setPreview(null);
    fileInputRef.current?.click();
  }

  async function handleDelete(pageId: string) {
    if (!token) return;
    setBusy(true);
    await deleteScanPage(token, pageId);
    setBusy(false);
    setPages((prev) => prev.filter((p) => p.id !== pageId));
  }

  async function handleReorder(pageId: string, direction: "up" | "down") {
    if (!token) return;
    setBusy(true);
    await reorderScanPage(token, pageId, direction);
    setPages((prev) => {
      const index = prev.findIndex((p) => p.id === pageId);
      const swapWith = direction === "up" ? index - 1 : index + 1;
      if (index === -1 || swapWith < 0 || swapWith >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[swapWith]] = [next[swapWith], next[index]];
      return next;
    });
    setBusy(false);
  }

  async function handleSignatureSubmit(dataUrl: string) {
    if (!token) return;
    setBusy(true);
    setError(null);
    const result = await submitScanSignature(token, dataUrl);
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setFinished(true);
  }

  async function handleFinish() {
    if (!token) return;
    setBusy(true);
    const result = await finishScanSession(token);
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setFinished(true);
  }

  if (!info) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-16 sm:px-6">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>
      </main>
    );
  }

  if ("error" in info) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-16 sm:px-6">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{ERROR_MESSAGES[info.error]}</p>
      </main>
    );
  }

  if (finished) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-16 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">Done</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          {info.requiresSignature
            ? `Signature captured for ${info.patientName} (${info.documentTypeName}).`
            : `${pages.length} page${pages.length === 1 ? "" : "s"} uploaded for ${info.patientName} (${info.documentTypeName}).`}{" "}
          You can close this tab.
        </p>
      </main>
    );
  }

  if (info.requiresSignature) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-16 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">{info.documentTypeName}</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {info.patientName} — {info.hospitalName}
        </p>
        <div className="mt-6">
          <SignaturePad
            declarationText={info.documentTypeDescription}
            busy={busy}
            onSubmit={handleSignatureSubmit}
          />
        </div>
        {error ? (
          <p role="alert" className="mt-4 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : null}
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-16 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">{info.documentTypeName}</h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        {info.patientName} — {info.hospitalName}
      </p>

      {pages.length > 0 ? (
        <ul className="mt-6 flex flex-col gap-3">
          {pages.map((page, i) => (
            <li
              key={page.id}
              className="flex items-center gap-3 rounded-md border border-zinc-200 p-2 text-sm dark:border-zinc-800"
            >
              {page.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- transient local object URL, not a static asset next/image can optimize.
                <img
                  src={page.previewUrl}
                  alt={`Page ${page.pageNo}`}
                  className="h-16 w-16 rounded object-cover"
                />
              ) : (
                <span className="flex h-16 w-16 items-center justify-center rounded bg-zinc-100 dark:bg-zinc-900">
                  Page {page.pageNo}
                </span>
              )}
              <span className="flex-1">Page {i + 1}</span>
              <button
                type="button"
                disabled={busy || i === 0}
                onClick={() => handleReorder(page.id, "up")}
                className="disabled:opacity-30"
                aria-label="Move up"
              >
                ↑
              </button>
              <button
                type="button"
                disabled={busy || i === pages.length - 1}
                onClick={() => handleReorder(page.id, "down")}
                className="disabled:opacity-30"
                aria-label="Move down"
              >
                ↓
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => handleDelete(page.id)}
                className="text-red-600 dark:text-red-400"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-6">
        {preview ? (
          <div className="flex flex-col items-start gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- a
                transient local object URL for the photo about to be
                confirmed, not a static asset next/image can optimize. */}
            <img
              src={preview.url}
              alt="Preview"
              className="max-h-64 rounded-md border border-zinc-200 dark:border-zinc-800"
            />
            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleConfirm}
                disabled={busy}
                className="rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-700 disabled:opacity-60"
              >
                {busy ? "Uploading…" : "Use this photo"}
              </button>
              <button
                type="button"
                onClick={handleRetake}
                disabled={busy}
                className="rounded-md border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700"
              >
                Retake
              </button>
            </div>
          </div>
        ) : (
          <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-md border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700">
            {pages.length > 0 ? "Add another page" : "Take a photo"}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFileSelected}
              className="hidden"
            />
          </label>
        )}
      </div>

      {error ? (
        <p role="alert" className="mt-4 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}

      {pages.length > 0 && !preview ? (
        <button
          type="button"
          onClick={handleFinish}
          disabled={busy}
          className="mt-8 w-fit rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-700 disabled:opacity-60"
        >
          Finish
        </button>
      ) : null}
    </main>
  );
}
