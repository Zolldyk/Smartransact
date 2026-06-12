import { describe, it, expect } from "vitest";
import { computeTip } from "./tip-calculator.js";

const baseGuardrails = {
  maxTipLamports: 1_000_000,
  tipBand: [1_000, 1_000_000] as [number, number],
  maxRetries: 4,
  maxHoldSlots: 64,
  dryRun: true,
};

const baseTipMarket = {
  floorPercentiles: { p25: 1000, p50: 1580, p75: 4458, p95: 100000, p99: 1000000 },
  emaP50: 3822,
  observedRecentTips: [],
};

describe("computeTip", () => {
  it("(a) ceiling clamp: emaP50 above maxTipLamports → returns maxTipLamports", () => {
    const result = computeTip({ ...baseTipMarket, emaP50: 2_000_000 }, baseGuardrails);
    expect(result).toBe(1_000_000n);
  });

  it("(b) floor clamp: emaP50 below tipBand[0] → returns tipBand[0]", () => {
    const result = computeTip({ ...baseTipMarket, emaP50: 500 }, baseGuardrails);
    expect(result).toBe(1_000n);
  });

  it("(c) JITO_MIN_TIP_LAMPORTS respected: emaP50 below JITO_MIN and tipBand[0] also below → returns 1000n", () => {
    const result = computeTip(
      { ...baseTipMarket, emaP50: 500 },
      { ...baseGuardrails, tipBand: [500, 1_000_000] },
    );
    expect(result).toBe(1_000n);
  });
});
