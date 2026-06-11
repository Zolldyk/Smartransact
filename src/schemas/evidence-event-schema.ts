import { z } from "zod";

/**
 * Contract #1 — the evidence log event union. A discriminated union on `event`
 * that the JSONL evidence logger (Story 1.4) writes. Slot and lamport fields are
 * bigint; the logger's central serializer converts them to JSON numbers.
 *
 * `at` is an ISO 8601 UTC string on every event. Uses `z.string()` (not
 * `.datetime()`) because Zod's datetime check is slightly stricter than the
 * ISO 8601 supertype and can spuriously reject valid timestamps the logger emits.
 */

/** The triggering txStatusChanged event data carried on commitmentTransition for
 * FR14 falsifiability. Defined inline (NOT imported from stream-event-schema) —
 * it is a subset carried for logging, not the stream event type itself. */
const CommitmentSourceSchema = z.object({
  kind: z.literal("txStatusChanged"),
  transport: z.enum(["ws", "grpc"]),
  signature: z.string(),
  commitment: z.enum(["processed", "confirmed", "finalized"]),
  slot: z.bigint(),
  subscriptionId: z.union([z.number(), z.string()]).optional(),
});

export const SessionStartedSchema = z.object({
  event: z.literal("sessionStarted"),
  at: z.string(),
  sessionId: z.string(),
  profile: z.string(),
  adapter: z.enum(["ws", "grpc"]),
});

export const SessionEndedSchema = z.object({
  event: z.literal("sessionEnded"),
  at: z.string(),
  sessionId: z.string(),
  reason: z.string().optional(),
});

export const BundleSubmittedSchema = z.object({
  event: z.literal("bundleSubmitted"),
  at: z.string(),
  bundleId: z.string(),
  slot: z.bigint(),
  tipLamports: z.bigint(),
});

export const CommitmentTransitionSchema = z.object({
  event: z.literal("commitmentTransition"),
  at: z.string(),
  bundleId: z.string(),
  stage: z.enum(["processed", "confirmed", "finalized"]),
  slot: z.bigint(),
  latencyFromPrevMs: z.number(),
  source: CommitmentSourceSchema,
});

export const FailureClassifiedSchema = z.object({
  event: z.literal("failureClassified"),
  at: z.string(),
  bundleId: z.string().optional(),
  classification: z.enum([
    "expired_blockhash",
    "fee_too_low",
    "compute_exceeded",
    "bundle_failure",
  ]),
  rawError: z.string(),
});

/** `observation` and `decision` are `z.unknown()` to avoid a cross-schema import
 * from observation-schema/decision-schema. The caller (Story 4.5) validates the
 * inner objects against their own schemas, then casts to AgentDecisionEvent. */
export const AgentDecisionEventSchema = z.object({
  event: z.literal("agentDecision"),
  at: z.string(),
  bundleId: z.string(),
  episodeId: z.string(),
  attempt: z.number().int().nonnegative(),
  observation: z.unknown(),
  decision: z.unknown(),
  originalDecision: z.unknown().optional(),
  thinkingTrace: z.string(),
  clamped: z.boolean(),
});

export const FaultInjectedSchema = z.object({
  event: z.literal("faultInjected"),
  at: z.string(),
  staleBlockhash: z.string(),
  fetchedAtSlot: z.bigint(),
  becameStaleAtSlot: z.bigint(),
});

export const EvidenceEventsDroppedSchema = z.object({
  event: z.literal("eventsDropped"),
  at: z.string(),
  count: z.number().int().positive(),
});

export const EvidenceEventSchema = z.discriminatedUnion("event", [
  SessionStartedSchema,
  SessionEndedSchema,
  BundleSubmittedSchema,
  CommitmentTransitionSchema,
  FailureClassifiedSchema,
  AgentDecisionEventSchema,
  FaultInjectedSchema,
  EvidenceEventsDroppedSchema,
]);

export type SessionStarted = z.infer<typeof SessionStartedSchema>;
export type SessionEnded = z.infer<typeof SessionEndedSchema>;
export type BundleSubmitted = z.infer<typeof BundleSubmittedSchema>;
export type CommitmentTransition = z.infer<typeof CommitmentTransitionSchema>;
export type FailureClassified = z.infer<typeof FailureClassifiedSchema>;
export type AgentDecisionEvent = z.infer<typeof AgentDecisionEventSchema>;
export type FaultInjected = z.infer<typeof FaultInjectedSchema>;
export type EvidenceEventsDropped = z.infer<typeof EvidenceEventsDroppedSchema>;
export type EvidenceEvent = z.infer<typeof EvidenceEventSchema>;
