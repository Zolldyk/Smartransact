import { describe, it, expect } from "vitest";
import {
  generateSessionId,
  buildFailureContext,
  isFaultBundle,
  extractSimulationError,
} from "./orchestrator.js";
import { BundleSubmittedSchema } from "../schemas/evidence-event-schema.js";
import { classifyFailure } from "./lifecycle/failure-classifier.js";

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

  it("supports a multi-fault index list (Story 5.9)", () => {
    expect(isFaultBundle(4, [4, 8])).toBe(true);
    expect(isFaultBundle(8, [4, 8])).toBe(true);
    expect(isFaultBundle(6, [4, 8])).toBe(false);
    expect(isFaultBundle(0, [])).toBe(false);
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

describe("extractSimulationError — fault-bundle pre-flight (Story 5.9 AC3)", () => {
  it("returns null when the simulation would proceed (err: null)", () => {
    expect(extractSimulationError({ err: null, logs: ["Program log: ok"] })).toBeNull();
    expect(extractSimulationError({ err: undefined })).toBeNull();
  });

  it("surfaces a string err verbatim (the real BlockhashNotFound rejection)", () => {
    expect(extractSimulationError({ err: "BlockhashNotFound", logs: null })).toBe(
      "BlockhashNotFound",
    );
  });

  it("appends logs when present (real on-chain reason can live there)", () => {
    const out = extractSimulationError({
      err: "BlockhashNotFound",
      logs: ["Transaction simulation failed: blockhash expired"],
    });
    expect(out).toBe(
      "BlockhashNotFound Transaction simulation failed: blockhash expired",
    );
  });

  it("JSON-stringifies a structured err object (no synthesis)", () => {
    const out = extractSimulationError({ err: { InstructionError: [0, "Custom"] } });
    expect(out).toBe('{"InstructionError":[0,"Custom"]}');
  });

  it("its output feeds classifyFailure → expired_blockhash (the AC3 honest path)", () => {
    // The whole point of the pre-flight: a REAL simulate err string flows through
    // the existing classifier regex to the expired_blockhash classification —
    // never written into the log directly.
    const realErr = extractSimulationError({ err: "BlockhashNotFound", logs: null });
    expect(realErr).not.toBeNull();
    const cf = classifyFailure(realErr);
    expect(cf.classification).toBe("expired_blockhash");
    expect(cf.rawError).toBe("BlockhashNotFound");
  });

  it("a non-blockhash err still classifies honestly (does NOT claim expired)", () => {
    const cf = classifyFailure(
      extractSimulationError({ err: { InstructionError: [0, "Custom"] } }),
    );
    expect(cf.classification).toBe("bundle_failure");
  });
});
