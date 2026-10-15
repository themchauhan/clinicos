"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { onChange, storageReport, type StorageReport } from "@/lib/offline/db";
import { countOpen, oldestUnsyncedAge } from "@/lib/offline/queue";
import {
  isCloudReachable,
  recoverStuckSyncing,
  syncNow,
  type SyncReport,
} from "@/lib/offline/sync";

const SYNC_EVERY_MS = 30_000;
const COUNT_EVERY_MS = 4_000;

/**
 * Another sync (this tab or another) may be mid-flight and may have started
 * before the latest record was saved; look once more shortly rather than
 * waiting for the next 30 s round.
 */
async function syncWithOneRetry(scope: string, force: boolean): Promise<SyncReport> {
  const first = await syncNow(scope, undefined, { force });
  if (first.reason !== "already_running") return first;
  await new Promise((resolve) => setTimeout(resolve, 1500));
  return syncNow(scope, undefined, { force });
}

export interface SyncState {
  waiting: number;
  needsReview: number;
  /** How long the oldest unsynced record has been waiting (ms), or null. */
  oldestWaitMs: number | null;
  storage: StorageReport | null;
  /** The cloud answered a real health check (not just "the network card is on"). */
  cloudReachable: boolean | null;
  authRequired: boolean;
  paused: boolean;
  /** `force`: ignore the retry wait (used by the manual "Sync now" button). */
  syncNow: (force?: boolean) => Promise<SyncReport | null>;
  refreshCounts: () => Promise<void>;
}

/**
 * Keeps one computer's queue moving: tries to sync on load, every 30 s, when
 * the browser says it is back online, and when the tab becomes visible. Safe in
 * several tabs -- syncNow is single-flight across them, and tabs tell each
 * other when something changed.
 */
export function useSyncLoop(scope: string | null): SyncState {
  const [counts, setCounts] = useState({ waiting: 0, needsReview: 0 });
  const [oldestWaitMs, setOldestWaitMs] = useState<number | null>(null);
  const [storage, setStorage] = useState<StorageReport | null>(null);
  const [cloudReachable, setCloudReachable] = useState<boolean | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [paused, setPaused] = useState(false);
  const scopeRef = useRef(scope);
  useEffect(() => {
    scopeRef.current = scope;
  }, [scope]);

  const refreshCounts = useCallback(async () => {
    const s = scopeRef.current;
    if (!s) return;
    setCounts(await countOpen(s));
    setOldestWaitMs(await oldestUnsyncedAge(s));
  }, []);

  const runSync = useCallback(
    async (force = false): Promise<SyncReport | null> => {
      const s = scopeRef.current;
      if (!s) return null;
      const report = await syncWithOneRetry(s, force);
      if (report.reason === "cloud_unreachable") setCloudReachable(false);
      else if (report.ran || report.reason === "nothing_to_send")
        setCloudReachable((v) => v ?? true);
      setAuthRequired(report.reason === "auth_required");
      setPaused(report.reason === "paused");
      await refreshCounts();
      return report;
    },
    [refreshCounts],
  );

  useEffect(() => {
    if (!scope) return;
    let cancelled = false;
    (async () => {
      await recoverStuckSyncing(scope);
      if (cancelled) return;
      await refreshCounts();
      setStorage(await storageReport());
      await runSync();
    })();
    const sync = setInterval(() => void runSync(), SYNC_EVERY_MS);
    const count = setInterval(() => void refreshCounts(), COUNT_EVERY_MS);
    const ping = setInterval(
      async () => setCloudReachable(await isCloudReachable()),
      SYNC_EVERY_MS / 2,
    );
    const onOnline = () => void runSync();
    const onVisible = () => {
      if (document.visibilityState === "visible") void runSync();
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    const stopListening = onChange(() => void refreshCounts());
    void isCloudReachable().then((ok) => !cancelled && setCloudReachable(ok));
    return () => {
      cancelled = true;
      clearInterval(sync);
      clearInterval(count);
      clearInterval(ping);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
      stopListening();
    };
  }, [scope, runSync, refreshCounts]);

  return {
    ...counts,
    oldestWaitMs,
    storage,
    cloudReachable,
    authRequired,
    paused,
    syncNow: runSync,
    refreshCounts,
  };
}
