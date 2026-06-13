import { describe, expect, it } from "vitest";
import { AgentObservationSchema } from "../schemas/observation-schema.js";
import { buildObservation, type ObservationInput } from "./observation-builder.js";

/** Realistic baseline drawn from the architecture worked example
 * (architecture.md:184). Per-case tests override only the field under test. */
function baseInput(): ObservationInput {
  return {
    episodeId: "ep-001",
    attempt: 1,
    failure: {
      classification: "expired_blockhash",
      rawError: "Blockhash not found",
      failedAtSlot: 1163,
    },
    blockhashAgeSlots: 163,
    currentSlot: 1163,
    leader: { slotsUntilNextTargetWindow: 2, windowLengthSlots: 4 },
    tipMarket: {
      floorPercentiles: { p25: 1000, p50: 5000, p75: 20000, p95: 80000, p99: 200000 },
      emaP50: 5200,
      observedRecentTips: [4800, 5100, 6000],
    },
    myLastTipLamports: 5000,
    priorAttempts: [],
    guardrails: {
      maxTipLamports: 1_000_000,
      tipBand: [1_000, 1_000_000],
      maxRetries: 4,
      maxHoldSlots: 64,
      dryRun: true,
    },
  };
}

describe("buildObservation", () => {
  // Test (a) — valid observation round-trips through the schema.
  it("produces an observation that round-trips through AgentObservationSchema", () => {
    const result = buildObservation(baseInput());
    expect(AgentObservationSchema.safeParse(result).success).toBe(true);
  });

  // Test (b) — attemptsRemaining = maxRetries - priorAttempts.length.
  it("decrements attemptsRemaining as priorAttempts grows", () => {
    const cases: Array<{ priorCount: number; expected: number }> = [
      { priorCount: 0, expected: 4 },
      { priorCount: 1, expected: 3 },
      { priorCount: 3, expected: 1 },
    ];
    for (const { priorCount, expected } of cases) {
      const input = baseInput();
      input.priorAttempts = Array.from({ length: priorCount }, (_, i) => ({
        action: "adjust_tip" as const,
        tipLamports: 5000 + i,
        outcome: "not_landed" as const,
        slot: 1000 + i,
      }));
      const result = buildObservation(input);
      expect(result.guardrails.attemptsRemaining).toBe(expected);
    }
  });

  // Test (c) — priorAttempts passed through unchanged.
  it("passes priorAttempts through unchanged (length and contents)", () => {
    const input = baseInput();
    input.priorAttempts = [
      { action: "refresh", tipLamports: 5000, outcome: "not_landed", slot: 1000 },
      { action: "adjust_tip", tipLamports: 7000, outcome: "landed", slot: 1004 },
    ];
    const result = buildObservation(input);
    expect(result.priorAttempts.length).toBe(2);
    expect(result.priorAttempts).toEqual(input.priorAttempts);
  });
});
