import { describe, it, expect } from "vitest";
import { applyGuardrails } from "./guardrails.js";
import type { Guardrails } from "../../schemas/config-schema.js";

const G: Guardrails = {
  maxTipLamports: 1_000_000,
  tipBand: [1_000, 1_000_000],
  maxRetries: 4,
  maxHoldSlots: 64,
  dryRun: true,
};

const BASE_DECISION = {
  diagnosis: "blockhash expired",
  rationale: "retry with fresh blockhash",
};

describe("applyGuardrails", () => {
  it("(a) tip below floor → clamped to tipBand[0]", () => {
    const { decision, clamped } = applyGuardrails(
      { ...BASE_DECISION, action: "adjust_tip", newTipLamports: 500 },
      G,
      2,
    );
    expect(decision.newTipLamports).toBe(1_000);
    expect(clamped).toBe(true);
  });

  it("(b) tip above ceiling → clamped to tipBand[1]", () => {
    const { decision, clamped } = applyGuardrails(
      { ...BASE_DECISION, action: "adjust_tip", newTipLamports: 2_000_000 },
      G,
      2,
    );
    expect(decision.newTipLamports).toBe(1_000_000);
    expect(clamped).toBe(true);
  });

  it("(c) holdSlots above max → clamped to maxHoldSlots", () => {
    const { decision, clamped } = applyGuardrails(
      { ...BASE_DECISION, action: "hold", holdSlots: 200 },
      G,
      2,
    );
    expect(decision.holdSlots).toBe(64);
    expect(clamped).toBe(true);
  });

  it("(d) attemptsRemaining === 0 + refresh → override to abort", () => {
    const { decision, clamped } = applyGuardrails(
      { ...BASE_DECISION, action: "refresh" },
      G,
      0,
    );
    expect(decision.action).toBe("abort");
    expect(clamped).toBe(true);
  });

  it("(e) valid decision passes through unchanged", () => {
    const input = { ...BASE_DECISION, action: "adjust_tip" as const, newTipLamports: 5_000 };
    const { decision, clamped } = applyGuardrails(input, G, 2);
    expect(clamped).toBe(false);
    expect(decision.action).toBe("adjust_tip");
    expect(decision.newTipLamports).toBe(5_000);
    expect(decision.diagnosis).toBe(input.diagnosis);
    expect(decision.rationale).toBe(input.rationale);
  });

  it("(f) attemptsRemaining === 0 + hold → override to abort (prevents negative-attempts crash)", () => {
    const { decision, clamped } = applyGuardrails(
      { ...BASE_DECISION, action: "hold", holdSlots: 10 },
      G,
      0,
    );
    expect(decision.action).toBe("abort");
    expect(clamped).toBe(true);
  });

  it("(g) attemptsRemaining === 0 + abort → stays abort, not clamped", () => {
    const { decision, clamped } = applyGuardrails({ ...BASE_DECISION, action: "abort" }, G, 0);
    expect(decision.action).toBe("abort");
    expect(clamped).toBe(false);
  });
});
