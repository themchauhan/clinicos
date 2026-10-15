"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  clearSession,
  isSessionFresh,
  loadSession,
  saveSession,
  sessionTimeLeftMs,
  type OfflineSession,
} from "@/lib/offline/session";
import { isCloudReachable } from "@/lib/offline/sync";
import { useSyncLoop } from "@/components/offline/use-sync-loop";
import { NewRecordForm } from "@/components/offline/new-record-form";
import { PendingList } from "@/components/offline/pending-list";
import { SlipView } from "@/components/offline/slip-view";
import type { LocalOp } from "@/lib/offline/db";

type View = "home" | "new" | "pending" | "slip";

const BACKUP_NUDGE_MS = 24 * 60 * 60 * 1000;

function readView(): { view: View; op: string | null } {
  const q = new URLSearchParams(window.location.search);
  const v = q.get("view");
  return {
    view: v === "new" || v === "pending" || v === "slip" ? v : "home",
    op: q.get("op"),
  };
}

export function OfflineApp() {
  const [session, setSession] = useState<OfflineSession | null | undefined>(undefined);
  const [view, setView] = useState<View>("home");
  const [slipOp, setSlipOp] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const sync = useSyncLoop(session?.scope ?? null);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      let stored = await loadSession();
      // Online: ask the server who is signed in. A definite "not signed in" (or
      // "offline mode is off for your centre") must not leave the previous
      // person's records reachable from this screen. If the server cannot be
      // reached or is unhealthy, that is the offline case: use what is stored.
      try {
        const res = await fetch("/api/offline/bootstrap", {
          cache: "no-store",
          signal: AbortSignal.timeout(4000),
        });
        if (res.status === 401 || res.status === 403) {
          if (await isCloudReachable()) {
            await clearSession();
            stored = null;
          }
        } else if (res.ok) {
          const body = await res.json();
          if (!body.enabled) {
            await clearSession();
            stored = null;
          } else {
            stored = await saveSession({
              user_id: body.user_id,
              hospital_id: body.hospital_id,
              hospital_name: body.hospital_name,
              user_name: body.user_name,
              role: body.role,
              visit_types: body.visit_types,
              doctors: body.doctors,
              verified_at: Date.now(),
            });
          }
        }
      } catch {
        // offline or server trouble: keep what is already saved
      }
      if (cancelled) return;
      const initial = readView();
      setSession(stored);
      setView(initial.view);
      setSlipOp(initial.op);
    }
    void init();
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      cancelled = true;
      clearInterval(tick);
    };
  }, []);

  const go = useCallback((next: View, op: string | null = null) => {
    setView(next);
    setSlipOp(op);
    const q = next === "home" ? "" : `?view=${next}${op ? `&op=${op}` : ""}`;
    window.history.replaceState(null, "", `/offline${q}`);
  }, []);

  if (session === undefined) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-10 text-sm text-slate-500">Loading…</main>
    );
  }

  if (session === null) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-semibold">Offline mode is not set up on this computer</h1>
        <p className="mt-3 text-sm text-slate-600">
          Open ClinicOS once with the internet connected and signed in. Offline mode then prepares
          itself automatically. If it still does not appear, ask your administrator to switch
          offline mode on for your centre. (Records saved earlier on this computer stay safe and
          reappear after you sign in.)
        </p>
        <Link href="/dashboard" className="mt-4 inline-block text-sm text-teal-700 underline">
          Go to the dashboard
        </Link>
      </main>
    );
  }

  const fresh = isSessionFresh(session, now);
  const hoursLeft = Math.floor(sessionTimeLeftMs(session, now) / 3_600_000);
  const needsBackup = sync.oldestWaitMs !== null && sync.oldestWaitMs > BACKUP_NUDGE_MS;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <p className="text-sm font-medium text-slate-500">{session.hospital_name}</p>
          <h1 className="text-2xl font-semibold tracking-tight">Offline mode</h1>
        </div>
        <ConnectionChip reachable={sync.cloudReachable} />
      </header>

      {!fresh ? (
        <Notice tone="red" title="The offline time limit has been reached.">
          New records can&rsquo;t be saved until you connect to the internet and sign in again.
          Records already saved on this computer are safe and will sync then.
        </Notice>
      ) : (
        <p className="text-sm text-slate-600 print:hidden">
          Records made here are saved on <strong>this computer only</strong> and are{" "}
          <strong>not visible on other computers</strong> until they sync. Offline use stays
          available for about {Math.max(1, hoursLeft)} more hour{hoursLeft === 1 ? "" : "s"} (until
          you sign in online again).
        </p>
      )}

      {sync.authRequired ? (
        <Notice tone="amber" title="Your sign-in has expired.">
          Waiting records can&rsquo;t sync yet. They stay safely saved on this computer.{" "}
          <Link href="/login?next=/offline" className="underline">
            Sign in
          </Link>
          .
        </Notice>
      ) : null}
      {sync.paused ? (
        <Notice tone="amber" title="Syncing is paused for your centre.">
          Records stay saved on this computer and will sync when it is switched back on.
        </Notice>
      ) : null}
      {needsBackup ? (
        <Notice tone="amber" title="Some records have been waiting for over a day.">
          Open &ldquo;Saved on this computer&rdquo; and press &ldquo;Save unsynced records as a
          file&rdquo; to keep a backup copy.
        </Notice>
      ) : null}
      {sync.storage && (sync.storage.low || !sync.storage.persisted) ? (
        <Notice tone="amber" title="Storage on this computer needs attention.">
          {sync.storage.low
            ? "This computer is almost out of storage space. Free some space before saving more records."
            : "This browser has not promised to keep offline records if the computer runs low on space. Save a backup file from the list below now and then."}
        </Notice>
      ) : null}

      {view === "home" ? (
        <nav className="flex flex-col gap-3 print:hidden">
          <button
            type="button"
            disabled={!fresh}
            onClick={() => go("new")}
            className="rounded-lg bg-teal-600 px-5 py-4 text-left text-white transition-colors hover:bg-teal-700 disabled:opacity-50"
          >
            <span className="block text-lg font-medium">New patient + visit</span>
            <span className="block text-sm text-teal-50">
              Register someone and start their visit.
            </span>
          </button>
          <button
            type="button"
            onClick={() => go("pending")}
            className="rounded-lg border border-slate-300 bg-white px-5 py-4 text-left transition-colors hover:bg-slate-50"
          >
            <span className="block text-lg font-medium">
              Saved on this computer
              {sync.waiting + sync.needsReview > 0 ? (
                <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-sm text-amber-900">
                  {sync.waiting + sync.needsReview}
                </span>
              ) : null}
            </span>
            <span className="block text-sm text-slate-500">
              See what is waiting to sync, print slips, and settle anything that needs review.
            </span>
          </button>
          <Link
            href="/dashboard"
            className="rounded-lg border border-slate-200 px-5 py-3 text-sm text-slate-600 hover:bg-slate-50"
          >
            Back to the full app (needs the internet)
          </Link>
        </nav>
      ) : null}

      {view === "new" ? (
        <NewRecordForm
          session={session}
          disabled={!fresh}
          onCancel={() => go("home")}
          onSaved={(op) => {
            void sync.refreshCounts();
            void sync.syncNow(true);
            go("slip", op.op_id);
          }}
        />
      ) : null}

      {view === "pending" ? (
        <PendingList
          session={session}
          sync={sync}
          onBack={() => go("home")}
          onOpenSlip={(op: LocalOp) => go("slip", op.op_id)}
        />
      ) : null}

      {view === "slip" ? (
        <SlipView
          session={session}
          opId={slipOp}
          onBack={() => go("home")}
          onPending={() => go("pending")}
        />
      ) : null}
    </main>
  );
}

function Notice({
  tone,
  title,
  children,
}: {
  tone: "red" | "amber";
  title: string;
  children: React.ReactNode;
}) {
  const cls =
    tone === "red"
      ? "border-red-300 bg-red-50 text-red-900"
      : "border-amber-300 bg-amber-50 text-amber-900";
  return (
    <div role="alert" className={`rounded-md border p-3 text-sm print:hidden ${cls}`}>
      <p className="font-medium">{title}</p>
      <p className="mt-1">{children}</p>
    </div>
  );
}

function ConnectionChip({ reachable }: { reachable: boolean | null }) {
  const cls =
    reachable === null
      ? "bg-slate-100 text-slate-600"
      : reachable
        ? "bg-emerald-100 text-emerald-800"
        : "bg-amber-100 text-amber-900";
  const text =
    reachable === null ? "Checking connection…" : reachable ? "Connected" : "Working offline";
  return <span className={`rounded-full px-3 py-1 text-sm ${cls}`}>{text}</span>;
}
