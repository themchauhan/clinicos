"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getAssignedScanSession, claimAssignedScanSession } from "@/app/device/actions";

const DEVICE_TOKEN_KEY = "clinicos_device_token";
const POLL_INTERVAL_MS = 2500;

interface AssignedRequest {
  sessionId: string;
  patientName: string;
  documentTypeName: string;
}

export default function DevicePage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [request, setRequest] = useState<AssignedRequest | null>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    async function load() {
      let stored: string | null = null;
      try {
        stored = window.localStorage.getItem(DEVICE_TOKEN_KEY);
      } catch {
        // Private browsing / blocked storage.
      }
      tokenRef.current = stored;
      setToken(stored);
    }
    void load();
  }, []);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    async function poll() {
      const result = await getAssignedScanSession(tokenRef.current!);
      if (cancelled) return;
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setError(null);
      setRequest(result.session);
    }

    void poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [token]);

  async function handleOpen() {
    if (!token || !request) return;
    setOpening(true);
    setError(null);
    const result = await claimAssignedScanSession(token, request.sessionId);
    if ("error" in result) {
      setOpening(false);
      setError(result.error);
      return;
    }
    router.push(`/scan#${result.scanToken}`);
  }

  if (token === undefined) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-16 sm:px-6">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>
      </main>
    );
  }

  if (!token) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-16 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">Not connected</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          This device hasn&apos;t been connected yet. Ask reception to send a pairing link.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-16 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Connected</h1>

      {request ? (
        <div className="mt-6 flex flex-col items-start gap-3 rounded-md border border-teal-300 bg-teal-50 p-4 dark:border-teal-800 dark:bg-teal-950">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">New request:</p>
          <p className="text-lg font-medium">
            {request.documentTypeName} — {request.patientName}
          </p>
          <button
            type="button"
            onClick={handleOpen}
            disabled={opening}
            className="w-fit rounded-md bg-teal-600 px-6 py-3 text-base font-medium text-white transition-colors hover:bg-teal-700 disabled:opacity-60"
          >
            {opening ? "Opening…" : "Open"}
          </button>
        </div>
      ) : (
        <p className="mt-6 text-sm text-zinc-500 dark:text-zinc-400">Waiting for a request…</p>
      )}

      {error ? (
        <p role="alert" className="mt-4 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </main>
  );
}
