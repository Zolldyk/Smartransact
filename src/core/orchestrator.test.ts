import { describe, it, expect } from "vitest";
import { generateSessionId, buildFailureContext, isFaultBundle } from "./orchestrator.js";
import { BundleSubmittedSchema } from "../schemas/evidence-event-schema.js";

describe("generateSessionId", () => {
  it("contains only safe-alphabet characters [A-Za-z0-9-]", () => {
    for (let i = 0; i < 50; i++) {
      const id = generateSessionId();
      expect(id).toMatch(/^[A-Za-z0-9-]+$/);
    }
  });

  it("is unique across successive calls", () => {
    const ids = new Set(Array.from({ length: 20 }, () => generateSessionId()));
    expect(ids.size).toBe(20);
  });

  it("is non-empty", () => {
    expect(generateSessionId().length).toBeGreaterThan(0);
  });
});

describe("buildFailureContext — ClassifiedFailure → FailureContext bridge", () => {
  it("maps classification, rawError, and failedAtSlot correctly", () => {
    const ctx = buildFailureContext(
      { classification: "expired_blockhash", rawError: "BlockhashNotFound" },
      305,
    );
    expect(ctx.classification).toBe("expired_blockhash");
    expect(ctx.rawError).toBe("BlockhashNotFound");
    expect(ctx.failedAtSlot).toBe(305);
  });

  it("preserves all four classification values", () => {
    const classes = [
      "expired_blockhash",
      "fee_too_low",
      "compute_exceeded",
      "bundle_failure",
    ] as const;
    for (const classification of classes) {
      const ctx = buildFailureContext({ classification, rawError: "err" }, 0);
      expect(ctx.classification).toBe(classification);
    }
  });
});

describe("isFaultBundle — fault-schedule predicate", () => {
  it("returns true only when bundleIndex === atBundle", () => {
    expect(isFaultBundle(3, 3)).toBe(true);
    expect(isFaultBundle(0, 0)).toBe(true);
  });

  it("returns false for non-matching indices", () => {
    expect(isFaultBundle(0, 3)).toBe(false);
    expect(isFaultBundle(5, 3)).toBe(false);
  });
});

describe("BundleSubmittedSchema — optional leaderWindow field (Task 3 schema addition)", () => {
  it("accepts a bundleSubmitted event without leaderWindow", () => {
    const event = {
      event: "bundleSubmitted" as const,
      at: new Date().toISOString(),
      bundleId: "abc123",
      slot: 1_000n,
      tipLamports: 5_000n,
    };
    expect(() => BundleSubmittedSchema.parse(event)).not.toThrow();
  });

  it("accepts a bundleSubmitted event with leaderWindow (round-trip)", () => {
    const event = {
      event: "bundleSubmitted" as const,
      at: new Date().toISOString(),
      bundleId: "abc123",
      slot: 1_000n,
      tipLamports: 5_000n,
      leaderWindow: { startSlot: 1_001n, endSlot: 1_004n },
    };
    const parsed = BundleSubmittedSchema.parse(event);
    expect(parsed.leaderWindow?.startSlot).toBe(1_001n);
    expect(parsed.leaderWindow?.endSlot).toBe(1_004n);
  });
});
