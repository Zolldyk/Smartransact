import { z } from "zod";

/**
 * Contract #3a — the agent observation (LLM input). This is the LLM-facing
 * interface, so ALL numeric fields are `z.number()` (NOT `z.bigint()`): bigints
 * are serialized to numbers before the agent ever sees them. Shape matches the
 * architecture doc field-for-field.
 */

export const FailureContextSchema = z.object({
  classification: z.enum([
    "expired_blockhash",
    "fee_too_low",
    "compute_exceeded",
    "bundle_failure",
  ]),
  rawError: z.string(),
  failedAtSlot: z.number(),
});

export const TipMarketDataSchema = z.object({
  floorPercentiles: z.object({
    p25: z.number(),
    p50: z.number(),
    p75: z.number(),
    p95: z.number(),
    p99: z.number(),
  }),
  emaP50: z.number(),
  observedRecentTips: z.array(z.number()),
});

export const LeaderContextSchema = z.object({
  slotsUntilNextTargetWindow: z.number(),
  windowLengthSlots: z.number(),
});

export const PriorAttemptSchema = z.object({
  action: z.enum(["refresh", "adjust_tip", "hold", "abort"]),
  tipLamports: z.number(),
  outcome: z.enum(["landed", "not_landed", "aborted"]),
  slot: z.number(),
});

export const ObservationGuardrailsSchema = z.object({
  maxTipLamports: z.number(),
  tipBandLamports: z.tuple([z.number(), z.number()]),
  attemptsRemaining: z.number().int().nonnegative(),
});

export const AgentObservationSchema = z.object({
  episodeId: z.string(),
  attempt: z.number().int().nonnegative(),
  failure: FailureContextSchema,
  blockhashAgeSlots: z.number(),
  currentSlot: z.number(),
  leader: LeaderContextSchema,
  tipMarket: TipMarketDataSchema,
  myLastTipLamports: z.number(),
  priorAttempts: z.array(PriorAttemptSchema),
  guardrails: ObservationGuardrailsSchema,
});

export type FailureContext = z.infer<typeof FailureContextSchema>;
export type TipMarketData = z.infer<typeof TipMarketDataSchema>;
export type LeaderContext = z.infer<typeof LeaderContextSchema>;
export type PriorAttempt = z.infer<typeof PriorAttemptSchema>;
export type ObservationGuardrails = z.infer<typeof ObservationGuardrailsSchema>;
export type AgentObservation = z.infer<typeof AgentObservationSchema>;
