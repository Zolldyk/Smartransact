import { describe, it, expect } from "vitest";
import {
  toLamports,
  lamportsToNumber,
  toSlots,
  slotsToNumber,
  serializeBigInt,
} from "./units.js";

describe("units", () => {
  it("toLamports coerces number to bigint", () => {
    expect(toLamports(1000)).toBe(1000n);
  });

  it("toLamports is idempotent on bigint input", () => {
    expect(toLamports(1000n)).toBe(1000n);
  });

  it("lamportsToNumber converts bigint to number", () => {
    expect(lamportsToNumber(1_000_000n)).toBe(1_000_000);
  });

  it("toSlots / slotsToNumber round-trip a real testnet slot number", () => {
    const slot = 414_627_551n;
    expect(toSlots(slot)).toBe(414_627_551n);
    expect(slotsToNumber(slot)).toBe(414_627_551);
  });

  it("serializeBigInt throws for value above MAX_SAFE_INTEGER", () => {
    expect(() => serializeBigInt(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toThrow();
  });
});
