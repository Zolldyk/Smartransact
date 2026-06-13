import {
  AgentObservationSchema,
  type AgentObservation,
  type FailureContext,
  type TipMarketData,
  type LeaderContext,
  type PriorAttempt,
} from "../schemas/observation-schema.js";
import type { Guardrails } from "../schemas/config-schema.js";

/** Typed slices of PUBLIC data only — the complete set of inputs the agent
 * is allowed to see. Note `failure` is a `FailureContext` (classification +
 * rawError + failedAtSlot), NOT a raw `ClassifiedFailure`: the orchestrator
 * (Story 5.1) bridges `ClassifiedFailure -> FailureContext` by injecting the
 * `failedAtSlot` it owns. Keeping the bridge on the core side is what lets
 * this file have zero imports from the core layer.
 *
 * All slot/lamport fields are NUMBERS, never bigints: the orchestrator
 * (Story 5.1) converts its bigint state via the units helpers BEFORE calling
 * here, so this file imports nothing from the core layer (AC6). The `leader`
 * slice arrives already shaped as `LeaderContext` — the caller derives it from
 * `LeaderWindow.getNextJitoLeaderWindow()` on the core side. */
export type ObservationInput = {
  episodeId: string;
  attempt: number;
  failure: FailureContext;
  blockhashAgeSlots: number;
  currentSlot: number;
  leader: LeaderContext;
  tipMarket: TipMarketData;
  myLastTipLamports: number;
  priorAttempts: PriorAttempt[];
  guardrails: Guardrails;
};

/** The SOLE constructor of `AgentObservation` (FR17 / NFR4). Assembles the
 * LLM input from public-data slices, derives `attemptsRemaining`, then
 * zod-parses its own output so schema drift fails fast at this seam instead
 * of silently reaching the prompt. Pure: no I/O, no clock, no randomness. */
export function buildObservation(input: ObservationInput): AgentObservation {
  const observation: AgentObservation = {
    episodeId: input.episodeId,
    attempt: input.attempt,
    failure: input.failure,
    blockhashAgeSlots: input.blockhashAgeSlots,
    currentSlot: input.currentSlot,
    leader: input.leader,
    tipMarket: input.tipMarket,
    myLastTipLamports: input.myLastTipLamports,
    priorAttempts: input.priorAttempts,
    guardrails: {
      maxTipLamports: input.guardrails.maxTipLamports,
      // config field `tipBand` maps to LLM-facing `tipBandLamports` (rename
      // locked in Story 1.3 — do not "fix" it back).
      tipBandLamports: input.guardrails.tipBand,
      // AC5 formula verbatim — no Math.max clamp: an over-run must throw at the
      // .parse() below (attemptsRemaining is .int().nonnegative()), by design.
      attemptsRemaining: input.guardrails.maxRetries - input.priorAttempts.length,
    },
  };
  return AgentObservationSchema.parse(observation);
}
