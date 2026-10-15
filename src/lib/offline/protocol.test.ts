import { describe, expect, it } from "vitest";
import { MAX_OPS_PER_BATCH, classifyRpcFailure, parseSyncRequest } from "./protocol";

const id = () => crypto.randomUUID();

describe("parseSyncRequest", () => {
  it("accepts a normal batch", () => {
    const r = parseSyncRequest({ ops: [{ op_id: id() }, { op_id: id() }] });
    expect("ops" in r && r.ops).toHaveLength(2);
  });

  it("refuses bad envelopes", () => {
    for (const body of [null, "x", [], {}, { ops: "x" }, { ops: [] }]) {
      expect("error" in parseSyncRequest(body)).toBe(true);
    }
    const tooMany = { ops: Array.from({ length: MAX_OPS_PER_BATCH + 1 }, () => ({ op_id: id() })) };
    expect("error" in parseSyncRequest(tooMany)).toBe(true);
  });

  it("refuses a missing, malformed or repeated op_id", () => {
    expect("error" in parseSyncRequest({ ops: [{}] })).toBe(true);
    expect("error" in parseSyncRequest({ ops: [{ op_id: "not-a-uuid" }] })).toBe(true);
    const same = id();
    expect(
      "error" in parseSyncRequest({ ops: [{ op_id: same }, { op_id: same.toUpperCase() }] }),
    ).toBe(true);
  });
});

describe("classifyRpcFailure", () => {
  it("treats permission errors as auth, bad data as malformed, everything else as retry", () => {
    expect(classifyRpcFailure({ code: "42501" })).toBe("auth");
    expect(classifyRpcFailure({ code: "PGRST301" })).toBe("auth");
    expect(classifyRpcFailure({ code: "22P02" })).toBe("malformed");
    expect(classifyRpcFailure({ code: "22023" })).toBe("malformed");
    expect(classifyRpcFailure({ code: "40P01" })).toBe("retry");
    expect(classifyRpcFailure({ code: "55P03" })).toBe("retry");
    expect(classifyRpcFailure({ code: "57014" })).toBe("retry");
    expect(classifyRpcFailure({ code: "XX000" })).toBe("retry");
    expect(classifyRpcFailure({})).toBe("retry");
    expect(classifyRpcFailure(null)).toBe("retry");
  });
});
