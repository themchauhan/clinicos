// @vitest-environment node
import { describe, expect, it } from "vitest";
import { canonicalJson, hashMatches, operationHash, sha256Hex, withHash } from "./canonical";

describe("canonicalJson", () => {
  it("sorts keys, drops undefined, and has no whitespace", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: undefined }], c: null } })).toBe(
      '{"a":{"c":null,"d":[3,{"z":1}]},"b":1}',
    );
  });

  it("is independent of key order", () => {
    expect(canonicalJson({ x: 1, y: 2 })).toBe(canonicalJson({ y: 2, x: 1 }));
  });

  it("survives a JSON round trip (what the network does to an operation)", () => {
    const op = { op_id: "a", n: 100, f: 12.5, s: 'é ñ   "q"', nil: null, arr: [1, "2"] };
    expect(canonicalJson(JSON.parse(JSON.stringify(op)))).toBe(canonicalJson(op));
  });

  it("refuses values that JSON cannot carry faithfully", () => {
    expect(() => canonicalJson(NaN)).toThrow();
    expect(() => canonicalJson(Infinity)).toThrow();
    expect(() => canonicalJson(() => 1)).toThrow();
    expect(() => canonicalJson(BigInt(10))).toThrow();
  });
});

describe("hashing", () => {
  it("matches the published SHA-256 test vector", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("ignores the operation's own payload_hash field", async () => {
    const op = { op_id: "1", visit: { fee_amount: 100 } };
    const hashed = await withHash(op);
    expect(hashed.payload_hash).toBe(await operationHash(op));
    expect(await hashMatches(hashed)).toBe(true);
  });

  it("detects any change, however small", async () => {
    const hashed = await withHash({
      op_id: "1",
      visit: { fee_amount: 100 },
      patient: { name: "A" },
    });
    expect(await hashMatches({ ...hashed, patient: { name: "B" } })).toBe(false);
    expect(await hashMatches({ ...hashed, visit: { fee_amount: 101 } })).toBe(false);
    expect(await hashMatches({ ...hashed, extra: 1 })).toBe(false);
    expect(await hashMatches({ ...hashed, payload_hash: "0".repeat(64) })).toBe(false);
    const { payload_hash, ...without } = hashed;
    void payload_hash;
    expect(await hashMatches(without)).toBe(false);
  });
});
