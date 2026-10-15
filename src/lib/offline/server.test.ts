// @vitest-environment node
import { describe, expect, it } from "vitest";
import { withHash } from "./canonical";
import { processSyncBatch, type RpcCall } from "./server";

const op = (extra: Record<string, unknown> = {}) =>
  withHash({ op_id: crypto.randomUUID(), op_type: "create_visit", schema_version: 1, ...extra });

const ok =
  (status = "applied"): RpcCall =>
  async (o) => ({
    data: {
      status,
      op_id: o.op_id,
      payload_hash: o.payload_hash,
      result: { visit_id: "v" },
      replayed: false,
    },
    error: null,
  });

describe("processSyncBatch", () => {
  it("returns the database's answer, with the recorded hash, for each operation", async () => {
    const a = await op();
    const b = await op();
    const r = await processSyncBatch(ok(), [a, b]);
    expect(r.authFailed).toBe(false);
    expect(r.outcomes.map((o) => o.status)).toEqual(["applied", "applied"]);
    expect(r.outcomes[0]).toMatchObject({ payload_hash: a.payload_hash });
  });

  it("refuses an operation whose content no longer matches its hash, without calling the database", async () => {
    let calls = 0;
    const tampered = { ...(await op()), visit: { fee_amount: 999 } };
    const r = await processSyncBatch(async () => {
      calls++;
      return { data: null, error: null };
    }, [tampered]);
    expect(calls).toBe(0);
    expect(r.outcomes[0]).toMatchObject({ status: "malformed", reason: "hash_mismatch" });
  });

  it("refuses an operation with no hash", async () => {
    const { payload_hash, ...bare } = await op();
    void payload_hash;
    const r = await processSyncBatch(ok(), [bare]);
    expect(r.outcomes[0]).toMatchObject({ status: "malformed" });
  });

  it("stops at the first operation it cannot judge and leaves the rest untouched", async () => {
    const ops = [await op(), await op(), await op()];
    let n = 0;
    const rpc: RpcCall = async (o) => {
      n++;
      if (n === 2) return { data: null, error: { code: "57014" } };
      return ok()(o);
    };
    const r = await processSyncBatch(rpc, ops);
    expect(r.outcomes.map((o) => o.status)).toEqual(["applied", "retry", "skipped"]);
    expect(n).toBe(2);
  });

  it("treats a thrown error and an unrecognised answer as 'retry', never as success", async () => {
    const a = await op();
    expect(
      (await processSyncBatch(async () => Promise.reject(new Error("socket")), [a])).outcomes[0],
    ).toMatchObject({ status: "retry" });
    expect(
      (await processSyncBatch(async () => ({ data: { status: "applied?" }, error: null }), [a]))
        .outcomes[0],
    ).toMatchObject({ status: "retry", reason: "unexpected_response" });
    expect(
      (await processSyncBatch(async () => ({ data: null, error: null }), [a])).outcomes[0],
    ).toMatchObject({ status: "retry" });
  });

  it("reports an auth failure without guessing about the operation", async () => {
    const r = await processSyncBatch(
      async () => ({ data: null, error: { code: "42501" } }),
      [await op()],
    );
    expect(r.authFailed).toBe(true);
    expect(r.outcomes).toHaveLength(0);
  });

  it("holds malformed operations for a person and keeps going", async () => {
    const ops = [await op(), await op()];
    let n = 0;
    const r = await processSyncBatch(async (o) => {
      n++;
      return n === 1 ? { data: null, error: { code: "22P02" } } : ok()(o);
    }, ops);
    expect(r.outcomes.map((o) => o.status)).toEqual(["malformed", "applied"]);
  });

  it("a paused centre pauses the rest of the batch", async () => {
    const r = await processSyncBatch(ok("paused"), [await op(), await op()]);
    expect(r.outcomes.map((o) => o.status)).toEqual(["paused", "skipped"]);
  });
});
