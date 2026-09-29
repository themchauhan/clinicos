"use server";

import QRCode from "qrcode";
import { getSessionProfile } from "@/lib/auth/session";
import { requireRole, requireActiveTenant } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
// generateScanToken/hashScanToken are generic (random 256-bit token,
// SHA-256 hash) despite the name -- reused here rather than
// duplicated, aliased for clarity at these call sites.
import {
  generateScanToken as generateDeviceToken,
  hashScanToken as hashDeviceToken,
} from "@/lib/scan/token";

export interface StartDevicePairingResult {
  deviceId: string;
  pairUrl: string;
  qrDataUrl: string;
}

/**
 * One paired device per hospital: starting a new pairing replaces
 * whatever was there before (simpler than a partial unique index, and
 * pairing a replacement device is exactly the "disconnect the old one"
 * action anyway).
 */
export async function startDevicePairing(): Promise<StartDevicePairingResult | { error: string }> {
  const profile = requireActiveTenant(
    requireRole(await getSessionProfile(), ["HOSPITAL_ADMIN", "RECEPTIONIST"]),
  );

  const supabase = await createClient();
  await supabase.from("paired_devices").delete().eq("hospital_id", profile.hospitalId!);

  const rawToken = generateDeviceToken();
  const tokenHash = hashDeviceToken(rawToken);

  const { data: created, error } = await supabase
    .from("paired_devices")
    .insert({ token_hash: tokenHash })
    .select("id")
    .single();

  if (error || !created) {
    return { error: "Could not start pairing. Try again." };
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const pairUrl = `${appUrl}/device/connect#${rawToken}`;
  const qrDataUrl = await QRCode.toDataURL(pairUrl);

  return { deviceId: created.id, pairUrl, qrDataUrl };
}

export async function getDevicePairingStatus(
  deviceId: string,
): Promise<{ confirmed: boolean } | { error: string }> {
  requireActiveTenant(requireRole(await getSessionProfile(), ["HOSPITAL_ADMIN", "RECEPTIONIST"]));

  const supabase = await createClient();
  const { data } = await supabase
    .from("paired_devices")
    .select("confirmed_at")
    .eq("id", deviceId)
    .maybeSingle();

  if (!data) {
    return { error: "Pairing was cancelled or replaced." };
  }
  return { confirmed: data.confirmed_at !== null };
}

export interface PairedDeviceInfo {
  id: string;
  confirmedAt: string | null;
  lastSeenAt: string | null;
}

/** Fetched alongside document_types on the patient/visit pages. */
export async function getPairedDevice(): Promise<PairedDeviceInfo | null> {
  requireActiveTenant(requireRole(await getSessionProfile(), ["HOSPITAL_ADMIN", "RECEPTIONIST"]));

  const supabase = await createClient();
  const { data } = await supabase
    .from("paired_devices")
    .select("id, confirmed_at, last_seen_at")
    .maybeSingle();

  if (!data) return null;
  return { id: data.id, confirmedAt: data.confirmed_at, lastSeenAt: data.last_seen_at };
}

export async function disconnectDevice(deviceId: string): Promise<{ error?: string }> {
  requireActiveTenant(requireRole(await getSessionProfile(), ["HOSPITAL_ADMIN", "RECEPTIONIST"]));

  const supabase = await createClient();
  const { error } = await supabase.from("paired_devices").delete().eq("id", deviceId);
  if (error) {
    return { error: "Could not disconnect that device." };
  }
  return {};
}
