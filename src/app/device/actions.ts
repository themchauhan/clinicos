"use server";

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { resolvePairedDevice } from "@/lib/devices/resolve-device";
// generateScanToken/hashScanToken are generic (random 256-bit token,
// SHA-256 hash) despite the name -- reused here rather than
// duplicated.
import { generateScanToken, hashScanToken } from "@/lib/scan/token";

// Nothing in this file trusts a Supabase Auth session — there isn't
// one, same as src/app/scan/actions.ts. The raw device token is the
// only credential.

export type DevicePairingInfo =
  { hospitalName: string; alreadyConfirmed: boolean } | { error: string };

export async function getDevicePairingInfo(rawToken: string): Promise<DevicePairingInfo> {
  const supabase = createServiceRoleClient();
  const device = await resolvePairedDevice(supabase, rawToken);
  if (!device) {
    return { error: "This pairing link is no longer valid. Ask reception for a fresh one." };
  }

  const { data: hospital } = await supabase
    .from("hospitals")
    .select("name")
    .eq("id", device.hospital_id)
    .single();

  return { hospitalName: hospital?.name ?? "—", alreadyConfirmed: device.confirmed_at !== null };
}

export async function confirmDevicePairing(rawToken: string): Promise<{ error?: string }> {
  const supabase = createServiceRoleClient();
  const device = await resolvePairedDevice(supabase, rawToken);
  if (!device) {
    return { error: "This pairing link is no longer valid. Ask reception for a fresh one." };
  }

  const now = new Date().toISOString();
  await supabase
    .from("paired_devices")
    .update({ confirmed_at: now, last_seen_at: now })
    .eq("id", device.id);

  return {};
}

export type AssignedScanSession =
  | { session: { sessionId: string; patientName: string; documentTypeName: string } | null }
  | { error: string };

/**
 * Polled by /device every ~2.5s. Doubles as the device's heartbeat
 * (last_seen_at) — never returns a usable scan token, only display
 * metadata, so the device learns "a request is waiting" without ever
 * being handed a credential for it until the human actually taps to
 * open it (see claimAssignedScanSession).
 */
export async function getAssignedScanSession(rawToken: string): Promise<AssignedScanSession> {
  const supabase = createServiceRoleClient();
  const device = await resolvePairedDevice(supabase, rawToken);
  if (!device) {
    return { error: "This device is no longer connected." };
  }

  await supabase
    .from("paired_devices")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", device.id);

  const { data: session } = await supabase
    .from("scan_sessions")
    .select("id, patient_id, document_type_id")
    .eq("paired_device_id", device.id)
    .eq("status", "PENDING")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!session) {
    return { session: null };
  }

  const [{ data: patient }, { data: documentType }] = await Promise.all([
    supabase.from("patients").select("name").eq("id", session.patient_id).single(),
    supabase.from("document_types").select("name").eq("id", session.document_type_id).single(),
  ]);

  return {
    session: {
      sessionId: session.id,
      patientName: patient?.name ?? "—",
      documentTypeName: documentType?.name ?? "—",
    },
  };
}

/**
 * The one and only place a device-assigned session's raw scan token is
 * ever handed out — generated fresh right here, at the moment a human
 * actually taps to open it, exactly like createScanSession does for a
 * fresh QR. The device never sees a usable token before this.
 */
export async function claimAssignedScanSession(
  rawToken: string,
  sessionId: string,
): Promise<{ scanToken: string } | { error: string }> {
  const supabase = createServiceRoleClient();
  const device = await resolvePairedDevice(supabase, rawToken);
  if (!device) {
    return { error: "This device is no longer connected." };
  }

  const { data: session } = await supabase
    .from("scan_sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("paired_device_id", device.id)
    .eq("status", "PENDING")
    .maybeSingle();

  if (!session) {
    return { error: "That request is no longer available." };
  }

  const scanToken = generateScanToken();
  const { error } = await supabase
    .from("scan_sessions")
    .update({
      token_hash: hashScanToken(scanToken),
      expires_at: new Date(Date.now() + 12 * 60 * 1000).toISOString(),
    })
    .eq("id", session.id);

  if (error) {
    return { error: "Could not open that request. Try again." };
  }

  return { scanToken };
}
