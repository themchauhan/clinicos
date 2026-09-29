"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  startDevicePairing,
  getDevicePairingStatus,
  disconnectDevice,
  type PairedDeviceInfo,
  type StartDevicePairingResult,
} from "@/app/dashboard/devices/actions";
import { Spinner } from "@/components/spinner";

const POLL_INTERVAL_MS = 2500;

/**
 * A paired device (see src/app/device) removes the need to scan a
 * fresh QR every time -- pair once from here, then "Scan/Sign with
 * phone" on any patient/visit page just sends the request straight to
 * that already-open device. Unpaired, those pages behave exactly like
 * before pairing existed: a fresh QR every time.
 */
export function ConnectedDeviceStatus({ pairedDevice }: { pairedDevice: PairedDeviceInfo | null }) {
  const router = useRouter();
  const [pairing, setPairing] = useState<StartDevicePairingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!pairing) return;
    const interval = setInterval(async () => {
      const result = await getDevicePairingStatus(pairing.deviceId);
      if ("error" in result) return;
      if (result.confirmed) {
        setPairing(null);
        router.refresh();
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [pairing, router]);

  async function handleConnect() {
    setBusy(true);
    setError(null);
    const result = await startDevicePairing();
    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setPairing(result);
  }

  async function handleDisconnect() {
    if (!pairedDevice) return;
    setBusy(true);
    await disconnectDevice(pairedDevice.id);
    setBusy(false);
    router.refresh();
  }

  if (pairing) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-md border border-zinc-300 p-4 text-sm dark:border-zinc-700">
        {/* eslint-disable-next-line @next/next/no-img-element -- qrDataUrl
            is a data: URI generated per-pairing, not a static asset
            next/image can optimize. */}
        <img
          src={pairing.qrDataUrl}
          alt="QR code to connect this device"
          width={180}
          height={180}
          className="rounded-md border border-slate-200 bg-white p-2"
        />
        <a
          href={pairing.pairUrl}
          target="_blank"
          rel="noreferrer"
          className="w-fit rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          Open to connect
        </a>
        <p className="text-zinc-500 dark:text-zinc-400">Waiting for the device to connect…</p>
        <button
          type="button"
          onClick={() => setPairing(null)}
          className="text-sm text-teal-700 underline hover:text-teal-800"
        >
          Cancel
        </button>
      </div>
    );
  }

  if (pairedDevice?.confirmedAt) {
    return (
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-emerald-700 dark:text-emerald-400">Device connected</span>
        <button
          type="button"
          onClick={handleDisconnect}
          disabled={busy}
          className="inline-flex items-center gap-1.5 text-zinc-500 underline hover:text-zinc-700 disabled:opacity-60 dark:text-zinc-400"
        >
          {busy ? <Spinner className="h-3.5 w-3.5" /> : null}
          {busy ? "Disconnecting…" : "Disconnect"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-1.5 text-sm">
      <button
        type="button"
        onClick={handleConnect}
        disabled={busy}
        className="inline-flex w-fit items-center gap-2 rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-700 disabled:opacity-60"
      >
        {busy ? <Spinner /> : null}
        {busy ? "Starting…" : "Connect a device"}
      </button>
      {error ? (
        <p role="alert" className="text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
