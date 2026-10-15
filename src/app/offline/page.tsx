import type { Metadata } from "next";
import { OfflineApp } from "@/components/offline/offline-app";

export const metadata: Metadata = { title: "Offline mode — ClinicOS" };

/**
 * The offline screens. Everything on this page runs in the browser against the
 * device's own store, so the cached copy of this one page keeps working when
 * the internet, the hosted app or the database is down. It carries no patient
 * data itself, which is why it is reachable without a session.
 */
export default function OfflinePage() {
  return <OfflineApp />;
}
