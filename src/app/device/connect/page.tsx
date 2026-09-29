"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getDevicePairingInfo,
  confirmDevicePairing,
  type DevicePairingInfo,
} from "@/app/device/actions";
import { Spinner } from "@/components/spinner";

const DEVICE_TOKEN_KEY = "clinicos_device_token";

export default function DeviceConnectPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [info, setInfo] = useState<DevicePairingInfo | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const rawToken = window.location.hash.slice(1);
      if (!rawToken) {
        if (!cancelled) setInfo({ error: "This pairing link isn't valid." });
        return;
      }
      setToken(rawToken);
      const result = await getDevicePairingInfo(rawToken);
      if (!cancelled) setInfo(result);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleConnect() {
    if (!token) return;
    setConnecting(true);
    setError(null);
    const result = await confirmDevicePairing(token);
    if (result.error) {
      setConnecting(false);
      setError(result.error);
      return;
    }
    try {
      window.localStorage.setItem(DEVICE_TOKEN_KEY, token);
    } catch {
      // Private browsing / blocked storage -- the page still works for
      // this one pairing, it just won't survive a reload.
    }
    router.push("/device");
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
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{info.error}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-16 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Connect this device</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        {info.alreadyConfirmed
          ? `This device is already connected to ${info.hospitalName}.`
          : `Connect this phone or tablet to ${info.hospitalName}? Scan and sign requests will show up here instead of a new QR code each time.`}
      </p>
      {info.alreadyConfirmed ? (
        <button
          type="button"
          onClick={() => router.push("/device")}
          className="mt-6 w-fit rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-700"
        >
          Go to waiting room
        </button>
      ) : (
        <button
          type="button"
          onClick={handleConnect}
          disabled={connecting}
          className="mt-6 inline-flex w-fit items-center gap-2 rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-700 disabled:opacity-60"
        >
          {connecting ? <Spinner /> : null}
          {connecting ? "Connecting…" : "Connect this device"}
        </button>
      )}
      {error ? (
        <p role="alert" className="mt-4 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </main>
  );
}
