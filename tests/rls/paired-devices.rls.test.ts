import { describe, expect, it } from "vitest";
import { SEED_ACCOUNTS, hospitalIdByName, signInAs, serviceRoleClient } from "./helpers";
import { resolvePairedDevice } from "../../src/lib/devices/resolve-device";
import { generateScanToken, hashScanToken } from "../../src/lib/scan/token";

async function pairDevice(staffEmail: string, hospitalName: string) {
  const authed = await signInAs(staffEmail);
  const hospitalId = await hospitalIdByName(hospitalName);
  const rawToken = generateScanToken();

  const { data: device, error } = await authed
    .from("paired_devices")
    .insert({ token_hash: hashScanToken(rawToken) })
    .select()
    .single();
  if (error || !device) throw error ?? new Error("failed to insert paired device");

  return { rawToken, device, hospitalId };
}

describe("paired_devices RLS + resolvePairedDevice", () => {
  it("a HOSPITAL_ADMIN can pair a device for their own hospital", async () => {
    const { device, hospitalId } = await pairDevice(
      SEED_ACCOUNTS.sunrise.admin,
      "Sunrise General Hospital",
    );
    expect(device.hospital_id).toBe(hospitalId);
    expect(device.confirmed_at).toBeNull();
  });

  it("a RECEPTIONIST can pair a device for their own hospital", async () => {
    const { device, hospitalId } = await pairDevice(
      SEED_ACCOUNTS.sunrise.receptionist,
      "Sunrise General Hospital",
    );
    expect(device.hospital_id).toBe(hospitalId);
  });

  it("resolvePairedDevice resolves a freshly paired, unconfirmed device by its raw token", async () => {
    const { rawToken, device } = await pairDevice(
      SEED_ACCOUNTS.sunrise.receptionist,
      "Sunrise General Hospital",
    );
    const resolved = await resolvePairedDevice(serviceRoleClient(), rawToken);
    expect(resolved?.id).toBe(device.id);
  });

  it("resolvePairedDevice returns null for a token that was never paired", async () => {
    const resolved = await resolvePairedDevice(serviceRoleClient(), generateScanToken());
    expect(resolved).toBeNull();
  });

  it("cross-tenant: another hospital's staff cannot SELECT the row directly", async () => {
    const { device } = await pairDevice(SEED_ACCOUNTS.sunrise.receptionist, "Sunrise General Hospital");
    const clarity = await signInAs(SEED_ACCOUNTS.clarity.admin);
    const { data } = await clarity.from("paired_devices").select("*").eq("id", device.id);
    expect(data).toHaveLength(0);
  });

  it("cross-tenant: another hospital's staff cannot DELETE the row", async () => {
    const { device } = await pairDevice(SEED_ACCOUNTS.sunrise.receptionist, "Sunrise General Hospital");
    const clarity = await signInAs(SEED_ACCOUNTS.clarity.admin);
    await clarity.from("paired_devices").delete().eq("id", device.id);
    const stillThere = await serviceRoleClient()
      .from("paired_devices")
      .select("id")
      .eq("id", device.id)
      .maybeSingle();
    expect(stillThere.data).not.toBeNull();
  });

  it("defense in depth: resolvePairedDevice returns null if ever called with a different hospital's session client, even with the correct token", async () => {
    const { rawToken } = await pairDevice(SEED_ACCOUNTS.sunrise.receptionist, "Sunrise General Hospital");
    const clarity = await signInAs(SEED_ACCOUNTS.clarity.admin);
    const resolved = await resolvePairedDevice(clarity, rawToken);
    expect(resolved).toBeNull();
  });

  it("a leaked token never resolves to another hospital's device no matter which hospital's row is looked up", async () => {
    const sunrise = await pairDevice(SEED_ACCOUNTS.sunrise.receptionist, "Sunrise General Hospital");
    const clarity = await pairDevice(SEED_ACCOUNTS.clarity.admin, "Clarity Diagnostics");
    expect(sunrise.device.hospital_id).not.toBe(clarity.device.hospital_id);

    const resolvedForSunriseToken = await resolvePairedDevice(serviceRoleClient(), sunrise.rawToken);
    const resolvedForClarityToken = await resolvePairedDevice(serviceRoleClient(), clarity.rawToken);
    expect(resolvedForSunriseToken?.hospital_id).toBe(sunrise.hospitalId);
    expect(resolvedForClarityToken?.hospital_id).toBe(clarity.hospitalId);
  });

  it("pairing a second device for the same hospital replaces the first (application-level behavior in startDevicePairing, verified here at the data layer)", async () => {
    const authed = await signInAs(SEED_ACCOUNTS.wellspring.admin);
    const hospitalId = await hospitalIdByName("Wellspring Multispecialty");

    const first = await pairDevice(SEED_ACCOUNTS.wellspring.admin, "Wellspring Multispecialty");
    // Mirrors startDevicePairing's own delete-then-insert.
    await authed.from("paired_devices").delete().eq("hospital_id", hospitalId);
    const second = await pairDevice(SEED_ACCOUNTS.wellspring.admin, "Wellspring Multispecialty");

    const firstStillResolves = await resolvePairedDevice(serviceRoleClient(), first.rawToken);
    const secondResolves = await resolvePairedDevice(serviceRoleClient(), second.rawToken);
    expect(firstStillResolves).toBeNull();
    expect(secondResolves?.id).toBe(second.device.id);
  });
});
