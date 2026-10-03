import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { ConnectedDeviceStatus } from "@/components/devices/connected-device-status";

export const metadata: Metadata = { title: "Connect a device — ClinicOS" };

/**
 * dashboard/layout.tsx already restricts /dashboard/* to HOSPITAL_ADMIN
 * and RECEPTIONIST, exactly the roles allowed to pair a device -- no
 * narrower guard needed here, unlike e.g. dashboard/settings which is
 * HOSPITAL_ADMIN-only.
 */
export default async function DevicesPage() {
  const supabase = await createClient();
  const { data: pairedDeviceRow } = await supabase
    .from("paired_devices")
    .select("id, confirmed_at, last_seen_at")
    .maybeSingle();
  const pairedDevice = pairedDeviceRow
    ? {
        id: pairedDeviceRow.id,
        confirmedAt: pairedDeviceRow.confirmed_at,
        lastSeenAt: pairedDeviceRow.last_seen_at,
      }
    : null;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-16 sm:px-6">
      <div className="max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight">Connect a device</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Pair a phone or tablet once, and every &quot;Scan with phone&quot; / &quot;Sign on
          phone&quot; request on any patient or visit page goes straight to it — no need to scan a
          fresh QR code each time. One device at a time; connecting a new one replaces whatever was
          paired before.
        </p>

        <div className="mt-8 rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <ConnectedDeviceStatus pairedDevice={pairedDevice} />
        </div>
      </div>
    </main>
  );
}
