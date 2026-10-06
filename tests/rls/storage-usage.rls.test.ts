import { describe, expect, it } from "vitest";
import { SEED_ACCOUNTS, hospitalIdByName, serviceRoleClient, signInAs } from "./helpers";

describe("storage_usage_by_hospital", () => {
  it("a platform admin sees per-centre totals that match the documents table", async () => {
    const platform = await signInAs(SEED_ACCOUNTS.platformAdmin);
    const sunriseId = await hospitalIdByName("Sunrise General Hospital");

    const { data, error } = await platform.rpc("storage_usage_by_hospital");
    expect(error).toBeNull();
    const row = data?.find((r) => r.hospital_id === sunriseId);

    const { data: docs } = await serviceRoleClient()
      .from("documents")
      .select("file_size")
      .eq("hospital_id", sunriseId);
    const expectedBytes = (docs ?? []).reduce((sum, d) => sum + Number(d.file_size), 0);
    expect(Number(row?.files ?? 0)).toBe((docs ?? []).length);
    expect(Number(row?.bytes ?? 0)).toBe(expectedBytes);
  });

  it("a hospital user gets nothing, not even their own centre's totals", async () => {
    const admin = await signInAs(SEED_ACCOUNTS.sunrise.admin);
    const { data, error } = await admin.rpc("storage_usage_by_hospital");
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("a signed-out caller cannot call it", async () => {
    const { anonClient } = await import("./helpers");
    const { data, error } = await anonClient().rpc("storage_usage_by_hospital");
    expect(error).not.toBeNull();
    expect(data ?? []).toHaveLength(0);
  });
});
