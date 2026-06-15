// web/app/lib/evidence-events.ts
//
// The CLIENT-SIDE evidence-event vocabulary — a discriminated union on `event`
// mirroring src/schemas/evidence-event-schema.ts (the ONLY data model, AC3). The
// backend (web/server/serialize.ts) already converted every bigint to a JSON
// number, so slot / lamport fields are `number` here (NOT bigint).
//
// `parseEvidenceEvent` is the narrow, defensive gate: any frame whose `event` is
// not a known variant returns null and is ignored — it NEVER throws (a malformed
// or future event must not crash the live view). The page feeds every frame from
// either source (live WS or committed replay) through it before reducing.
//
// `web/app` is a bundler-resolution workspace: extensionless `@/` imports, no zod
// in deps — so the narrowing is hand-written (mirrors the shapes locked in
// src/schemas/observation-schema.ts and decision-schema.ts).

/** Failure classifications (mirrors FailureClassifiedSchema / observation-schema). */
export type FailureClassification =
  | "expired_blockhash"
  | "fee_too_low"
  | "compute_exceeded"
  | "bundle_failure";

/** The agent's four possible actions (mirrors decision-schema). */
export type AgentAction = "refresh" | "adjust_tip" | "hold" | "abort";

/** Commitment stages a bundle passes through (mirrors CommitmentTransitionSchema). */
export type CommitmentStage = "processed" | "confirmed" | "finalized";

export interface SessionStarted {
  event: "sessionStarted";
  at: string;
  sessionId: string;
  profile: string;
  adapter: "ws" | "grpc";
}

export interface SessionEnded {
  event: "sessionEnded";
  at: string;
  sessionId: string;
  reason?: string;
}

export interface BundleSubmitted {
  event: "bundleSubmitted";
  at: string;
  bundleId: string;
  slot: number;
  tipLamports: number;
  leaderWindow?: { startSlot: number; endSlot: number };
}

export interface CommitmentTransition {
  event: "commitmentTransition";
  at: string;
  bundleId: string;
  stage: CommitmentStage;
  slot: number;
  latencyFromPrevMs: number;
  source: {
    kind: "txStatusChanged";
    transport: "ws" | "grpc";
    signature: string;
    commitment: CommitmentStage;
    slot: number;
    subscriptionId?: number | string;
  };
}

export interface FailureClassified {
  event: "failureClassified";
  at: string;
  bundleId?: string;
  classification: FailureClassification;
  rawError: string;
}

export interface AgentDecisionEvent {
  event: "agentDecision";
  at: string;
  bundleId: string;
  episodeId: string;
  attempt: number;
  observation: unknown;
  decision: unknown;
  originalDecision?: unknown;
  thinkingTrace: string;
  clamped: boolean;
}

export interface FaultInjected {
  event: "faultInjected";
  at: string;
  staleBlockhash: string;
  fetchedAtSlot: number;
  becameStaleAtSlot: number;
}

export interface EvidenceEventsDropped {
  event: "eventsDropped";
  at: string;
  count: number;
}

export interface StreamReconnectedEvidence {
  event: "streamReconnected";
  at: string;
  attempt: number;
  delayMs: number;
}

/** The discriminated union — the only data the renderer ever binds to (AC3). */
export type EvidenceEvent =
  | SessionStarted
  | SessionEnded
  | BundleSubmitted
  | CommitmentTransition
  | FailureClassified
  | AgentDecisionEvent
  | FaultInjected
  | EvidenceEventsDropped
  | StreamReconnectedEvidence;

/** Narrowed shape of `agentDecision.observation` (mirrors AgentObservationSchema,
 * numbers not bigints). Only the fields the drawer renders are typed precisely. */
export interface AgentObservation {
  episodeId: string;
  attempt: number;
  failure: {
    classification: FailureClassification;
    rawError: string;
    failedAtSlot: number;
  };
  blockhashAgeSlots: number;
  currentSlot: number;
  leader: { slotsUntilNextTargetWindow: number; windowLengthSlots: number };
  tipMarket: {
    floorPercentiles: { p25: number; p50: number; p75: number; p95: number; p99: number };
    emaP50: number;
    observedRecentTips: number[];
  };
  myLastTipLamports: number;
  priorAttempts: unknown[];
  guardrails: { maxTipLamports: number; tipBandLamports: [number, number]; attemptsRemaining: number };
}

/** Narrowed shape of `agentDecision.decision` (mirrors AgentDecisionSchema). */
export interface AgentDecision {
  diagnosis: string;
  action: AgentAction;
  newTipLamports?: number;
  holdSlots?: number;
  rationale: string;
}

const KNOWN_EVENTS = new Set([
  "sessionStarted",
  "sessionEnded",
  "bundleSubmitted",
  "commitmentTransition",
  "failureClassified",
  "agentDecision",
  "faultInjected",
  "eventsDropped",
  "streamReconnected",
]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/**
 * Defensive parse: returns the typed event when `event` is a known variant and
 * `at` is a string; otherwise null (unknown / future / malformed events are
 * ignored, never thrown). We trust the server's field shapes for known events
 * (they passed EvidenceEventSchema.parse before serialization) — this gate exists
 * to drop the *unknown*, not to re-validate every field client-side.
 */
export function parseEvidenceEvent(raw: unknown): EvidenceEvent | null {
  if (!isRecord(raw)) return null;
  const event = raw["event"];
  if (typeof event !== "string" || !KNOWN_EVENTS.has(event)) return null;
  if (typeof raw["at"] !== "string") return null;
  return raw as unknown as EvidenceEvent;
}

const CLASSIFICATIONS: ReadonlySet<string> = new Set([
  "expired_blockhash",
  "fee_too_low",
  "compute_exceeded",
  "bundle_failure",
]);
const ACTIONS: ReadonlySet<string> = new Set(["refresh", "adjust_tip", "hold", "abort"]);

/** Narrow `agentDecision.observation` (typed `unknown` on the wire). Returns null
 * when the core shape is absent so the drawer can render only what's present. */
export function narrowObservation(raw: unknown): AgentObservation | null {
  if (!isRecord(raw)) return null;
  const failure = raw["failure"];
  const tipMarket = raw["tipMarket"];
  if (typeof raw["currentSlot"] !== "number") return null;
  if (!isRecord(failure) || typeof failure["classification"] !== "string") return null;
  if (!isRecord(tipMarket) || !isRecord(tipMarket["floorPercentiles"])) return null;
  return raw as unknown as AgentObservation;
}

/** Narrow `agentDecision.decision` (typed `unknown` on the wire). */
export function narrowDecision(raw: unknown): AgentDecision | null {
  if (!isRecord(raw)) return null;
  if (typeof raw["diagnosis"] !== "string") return null;
  const action = raw["action"];
  if (typeof action !== "string" || !ACTIONS.has(action)) return null;
  return raw as unknown as AgentDecision;
}

export function isFailureClassification(v: string): v is FailureClassification {
  return CLASSIFICATIONS.has(v);
}
