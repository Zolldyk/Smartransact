import type { AgentDecision } from "../../schemas/decision-schema.js";
import type { Guardrails } from "../../schemas/config-schema.js";

export function applyGuardrails(
  decision: AgentDecision,
  guardrails: Guardrails,
  attemptsRemaining: number,
): { decision: AgentDecision; clamped: boolean } {
  let clamped = false;
  let { action, newTipLamports, holdSlots } = decision;

  if (attemptsRemaining === 0 && (action === "refresh" || action === "adjust_tip")) {
    action = "abort";
    clamped = true;
  }

  if (newTipLamports !== undefined) {
    const [bandMin, bandMax] = guardrails.tipBand;
    if (newTipLamports < bandMin) {
      newTipLamports = bandMin;
      clamped = true;
    } else if (newTipLamports > bandMax) {
      newTipLamports = bandMax;
      clamped = true;
    }
  }

  if (holdSlots !== undefined && holdSlots > guardrails.maxHoldSlots) {
    holdSlots = guardrails.maxHoldSlots;
    clamped = true;
  }

  return { decision: { ...decision, action, newTipLamports, holdSlots }, clamped };
}
