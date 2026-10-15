"use client";

import { useEffect } from "react";
import Link from "next/link";
import { requestPersistentStorage, scopeOf } from "@/lib/offline/db";
import { saveSession } from "@/lib/offline/session";
import { useSyncLoop } from "@/components/offline/use-sync-loop";

const REFRESH_SESSION_EVERY_MS = 10 * 60_000;

async function tearDownShell() {
  try {
    const regs = await navigator.serviceWorker?.getRegistrations();
    await Promise.all((regs ?? []).map((r) => r.unregister()));
    for (const name of await caches.keys()) {
      if (name.startsWith("clinicos-")) await caches.delete(name);
    }
  } catch {
    // best effort; the device's saved records are never touched here
  }
}

/**
 * Mounted on every signed-in dashboard page of a centre that has offline mode
 * switched on. It (1) installs the offline shell, (2) saves who is signed in and
 * the reference lists the offline screens need, (3) keeps the queue syncing in
 * the background, and (4) shows a small pill when records are waiting. When the
 * centre's switch is off it removes the shell again. Records already saved on
 * the device are never deleted by any of this.
 */
export function OfflineSync({
  userId,
  hospitalId,
  enabled,
}: {
  userId: string;
  hospitalId: string;
  enabled: boolean;
}) {
  const scope = enabled ? scopeOf(userId, hospitalId) : null;
  const sync = useSyncLoop(scope);

  useEffect(() => {
    if (!enabled) {
      void tearDownShell();
      return;
    }
    let stopped = false;

    async function refresh() {
      try {
        const res = await fetch("/api/offline/bootstrap", { cache: "no-store" });
        if (!res.ok) return;
        const body = await res.json();
        if (stopped) return;
        if (!body.enabled) {
          await tearDownShell();
          return;
        }
        await saveSession({
          user_id: body.user_id,
          hospital_id: body.hospital_id,
          hospital_name: body.hospital_name,
          user_name: body.user_name,
          role: body.role,
          visit_types: body.visit_types,
          doctors: body.doctors,
          verified_at: Date.now(),
        });
        const reg = await navigator.serviceWorker?.getRegistration();
        reg?.active?.postMessage("refresh-shell");
      } catch {
        // offline or server trouble: keep what is already saved
      }
    }

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
    void requestPersistentStorage();
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_SESSION_EVERY_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [enabled]);

  if (!enabled || (sync.waiting === 0 && sync.needsReview === 0)) return null;

  return (
    <Link
      href="/offline?view=pending"
      className="fixed bottom-4 left-4 z-50 rounded-full border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 shadow-md print:hidden"
    >
      {sync.needsReview > 0
        ? `${sync.needsReview} offline record${sync.needsReview === 1 ? "" : "s"} need review`
        : `${sync.waiting} offline record${sync.waiting === 1 ? "" : "s"} waiting to sync`}
    </Link>
  );
}
