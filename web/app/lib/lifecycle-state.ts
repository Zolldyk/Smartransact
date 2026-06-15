// web/app/lib/lifecycle-state.ts
//
// The ONE sanctioned pure mapper for the Live view (mirrors the repo convention:
// lib/overrides.ts here, src/agent/observation-builder.ts in core). value-in /
// value-out — no React, no I/O, no timers. It folds the evidence-event stream
// into the view model the flow components render. Keeping ALL derivation here is
// what makes "render only what the events say" (AC3 / Evidence Integrity)
// structural: the components stay dumb and cannot fabricate a beat.
//
// CRITICAL honesty rule encoded here: a Track pip / the Landed stage only ever
// lights from a real `commitmentTransition` event. The committed run has zero of
// those, so it renders package→send→fault→recovery richly but leaves Track empty
// and Landed unlit — by construction, not by a special case.

import {
  narrowDecision,
  narrowObservation,
  type AgentAction,
  type AgentDecision,
  type AgentObservation,
  type EvidenceEvent,
  type FailureClassification,
} from "./evidence-events";

/** The 5 pipeline stages, in flow order (Package→Aim→Send→Track→Landed). */
export type StageId = "package" | "aim" | "send" | "track" | "landed";
export const STAGE_ORDER: readonly StageId[] = ["package", "aim", "send", "track", "landed"];

/** Per-stage status. `fault` is the calm amber state (never red). */
export type StageStatus = "pending" | "live" | "done" | "fault";

/** Track-stage commitment pips — each lights only from a real commitmentTransition. */
export interface CommitPips {
  processed: boolean;
  confirmed: boolean;
  finalized: boolean;
}

/** Live-input values, derived ONLY from fields carried on real events. */
export interface LiveInputs {
  latestSlot?: number;
  leaderWindow?: { startSlot: number; endSlot: number };
  tipLamports?: number;
}

/** One agent recovery episode (drives the agent card + reasoning drawer). */
export interface AgentEpisode {
  episodeId: string;
  bundleId: string;
  attempt: number;
  diagnosis: string;
  action: AgentAction;
  classification?: FailureClassification;
  newTipLamports?: number;
  rationale?: string;
  thinkingTrace: string;
  observation: AgentObservation | null;
  decision: AgentDecision | null;
}

/** The genuine blockhash-expiry fault (Option D — surfaced as a trust feature). */
export interface FaultDetail {
  staleBlockhash: string;
  fetchedAtSlot: number;
  becameStaleAtSlot: number;
}

/**
 * A one-shot "a beat just advanced" marker (Story 8.7). Set ONLY inside this
 * reducer, ONLY on a real stage-advancing event (bundleSubmitted, processed
 * commitmentTransition). `seq` is monotonic so the connector packet re-fires
 * cleanly for a new bundle; `latencyMs` is the genuine wall-clock latency the
 * packet's travel duration is derived from. It is NEVER refreshed by a
 * non-advancing event — that structural rule is what keeps the motion honest
 * (AC3): no packet can travel without a backing evidence event.
 */
export interface AdvanceMarker {
  stage: StageId;
  latencyMs: number;
  seq: number;
}

export interface LiveState {
  stages: Record<StageId, StageStatus>;
  pips: CommitPips;
  inputs: LiveInputs;
  currentBundleId?: string;
  episodes: AgentEpisode[];
  recoveryActive: boolean;
  faultInjected: boolean;
  faultDetail?: FaultDetail;
  landed: boolean; // a real commitmentTransition:finalized has occurred at least once
  bundleSubmittedSeen: boolean;
  sessionStarted: boolean;
  sessionEnded: boolean;
  endedReason?: string;
  counts: { bundlesSubmitted: number; failures: number; decisions: number };
  /** One-shot packet-advance marker (Story 8.7); undefined until a real advance. */
  advance?: AdvanceMarker;
  /** Wall-clock ms of the previous event's `at`, to derive genuine latency deltas. */
  lastEventAtMs?: number;
  /** A calm inline note for backpressure / reconnect (optional, AC8). */
  note?: string;
}

export const initialLiveState: LiveState = {
  stages: { package: "pending", aim: "pending", send: "pending", track: "pending", landed: "pending" },
  pips: { processed: false, confirmed: false, finalized: false },
  inputs: {},
  episodes: [],
  recoveryActive: false,
  faultInjected: false,
  landed: false,
  bundleSubmittedSeen: false,
  sessionStarted: false,
  sessionEnded: false,
  counts: { bundlesSubmitted: 0, failures: 0, decisions: 0 },
};

function withStages(state: LiveState, patch: Partial<Record<StageId, StageStatus>>): Record<StageId, StageStatus> {
  return { ...state.stages, ...patch };
}

/**
 * Fold one evidence event into the view model. Pure: returns a new LiveState (or
 * the same reference for events with no view effect). Never mutates `state`.
 *
 * Story 8.7: the reducer also derives an honest, one-shot `advance` marker (the
 * "a beat just advanced" signal) + carries `lastEventAtMs` so latency is a real
 * wall-clock delta. `advance` is set ONLY on the two genuinely stage-advancing
 * events (bundleSubmitted → Send, commitmentTransition → Track/Landed); every
 * other event preserves the prior `advance` reference so no spurious re-trigger
 * — that is what makes the packet motion structurally honest (AC3).
 */
export function reduceEvidence(state: LiveState, event: EvidenceEvent): LiveState {
  // Genuine wall-clock latency between consecutive events (AC2). Guard NaN /
  // missing prior timestamp → delta 0; carry the parsed time forward always.
  const atMs = Date.parse(event.at);
  const validAt = Number.isFinite(atMs);
  const delta = validAt && state.lastEventAtMs !== undefined ? Math.max(0, atMs - state.lastEventAtMs) : 0;
  const nextAtMs = validAt ? atMs : state.lastEventAtMs;
  // Monotonic seq: only the advancing branches below bump it.
  const seq = (state.advance?.seq ?? 0) + 1;

  const next = reduceCore(state, event, delta, seq);
  // Always carry lastEventAtMs forward; `advance` is preserved by reduceCore
  // (the non-advancing branches spread `state`, which already holds it).
  return next.lastEventAtMs === nextAtMs ? next : { ...next, lastEventAtMs: nextAtMs };
}

/** The stage-transition core (pre-8.7 behavior + the two advance-marker writes). */
function reduceCore(state: LiveState, event: EvidenceEvent, delta: number, seq: number): LiveState {
  switch (event.event) {
    case "sessionStarted":
      // Pipeline initializes: Package is the live (preparing) stage.
      return {
        ...state,
        sessionStarted: true,
        stages: withStages(state, { package: "live" }),
      };

    case "bundleSubmitted": {
      // Package + Aim done, Send live. Capture the live-input values it carries.
      // A new submit re-focuses the single pipeline: reset the per-bundle Track
      // pips (they belong to the current bundle) and the Landed stage. The
      // entering connector (aim→send) gets a one-shot packet at the real latency.
      return {
        ...state,
        currentBundleId: event.bundleId,
        bundleSubmittedSeen: true,
        counts: { ...state.counts, bundlesSubmitted: state.counts.bundlesSubmitted + 1 },
        pips: { processed: false, confirmed: false, finalized: false },
        advance: { stage: "send", latencyMs: delta, seq },
        inputs: {
          ...state.inputs,
          latestSlot: event.slot,
          tipLamports: event.tipLamports,
          leaderWindow: event.leaderWindow ?? state.inputs.leaderWindow,
        },
        stages: withStages(state, { package: "done", aim: "done", send: "live", track: "pending", landed: "pending" }),
      };
    }

    case "commitmentTransition": {
      // The ONLY path that fills a Track pip / lights Landed. Honest by design.
      const pips: CommitPips = {
        processed: state.pips.processed || event.stage === "processed" || event.stage === "confirmed" || event.stage === "finalized",
        confirmed: state.pips.confirmed || event.stage === "confirmed" || event.stage === "finalized",
        finalized: state.pips.finalized || event.stage === "finalized",
      };
      const finalized = pips.finalized;
      return {
        ...state,
        pips,
        landed: state.landed || finalized,
        // Prefer the tracker-computed latency for this beat; the entering
        // connector is send→track (or track→landed when finalized).
        advance: { stage: finalized ? "landed" : "track", latencyMs: event.latencyFromPrevMs, seq },
        inputs: { ...state.inputs, latestSlot: event.slot },
        stages: withStages(state, {
          send: "done",
          track: finalized ? "done" : "live",
          landed: finalized ? "done" : state.stages.landed,
        }),
      };
    }

    case "failureClassified":
      // Activate the recovery loop; Send goes to the calm amber fault state.
      // NOTE: must NOT touch `advance` (preserved via spread) — AC3/AC6.
      return {
        ...state,
        recoveryActive: true,
        counts: { ...state.counts, failures: state.counts.failures + 1 },
        stages: withStages(state, { send: "fault" }),
      };

    case "agentDecision": {
      const observation = narrowObservation(event.observation);
      const decision = narrowDecision(event.decision);
      const episode: AgentEpisode = {
        episodeId: event.episodeId,
        bundleId: event.bundleId,
        attempt: event.attempt,
        diagnosis: decision?.diagnosis ?? observation?.failure.classification ?? "not specified",
        action: decision?.action ?? "hold",
        classification: observation?.failure.classification,
        newTipLamports: decision?.newTipLamports,
        rationale: decision?.rationale,
        thinkingTrace: event.thinkingTrace,
        observation,
        decision,
      };
      // NOTE: must NOT touch `advance` (preserved via spread) — AC3/AC6.
      return {
        ...state,
        recoveryActive: true,
        counts: { ...state.counts, decisions: state.counts.decisions + 1 },
        episodes: [...state.episodes, episode],
        // currentSlot is a real, event-carried field, safe to surface.
        inputs: observation ? { ...state.inputs, latestSlot: observation.currentSlot } : state.inputs,
      };
    }

    case "faultInjected":
      // NOTE: must NOT touch `advance` (preserved via spread) — AC3/AC6.
      return {
        ...state,
        faultInjected: true,
        faultDetail: {
          staleBlockhash: event.staleBlockhash,
          fetchedAtSlot: event.fetchedAtSlot,
          becameStaleAtSlot: event.becameStaleAtSlot,
        },
      };

    case "eventsDropped":
      return { ...state, note: `${event.count} event(s) dropped under load; the stream stayed connected.` };

    case "streamReconnected":
      return { ...state, note: `stream reconnected (attempt ${event.attempt}).` };

    case "sessionEnded":
      // Honest terminal. A dryRun session emits NO bundleSubmitted (locked 8.1
      // contract): mark Package done (it was prepared) and leave the rest pending
      // (the page shows the "dryRun, no bundle submitted (safe mode)" terminal).
      return {
        ...state,
        sessionEnded: true,
        endedReason: event.reason,
        stages: state.bundleSubmittedSeen ? state.stages : withStages(state, { package: "done" }),
      };

    default:
      return state;
  }
}

/**
 * Clamp a real latency to a watchable band (AC2): proportional to the genuine
 * wall-clock latency, but never so fast it's imperceptible nor so slow it stalls.
 * Pure helper so the band is unit-testable. Constants tuned for the ~42s replay
 * cadence: a sub-300ms beat reads as instant, anything past ~1.8s feels stuck.
 */
export const PACKET_MIN_MS = 280;
export const PACKET_MAX_MS = 1800;
export function clampPacketDuration(latencyMs: number): number {
  if (!Number.isFinite(latencyMs) || latencyMs <= PACKET_MIN_MS) return PACKET_MIN_MS;
  if (latencyMs >= PACKET_MAX_MS) return PACKET_MAX_MS;
  return Math.round(latencyMs);
}

/** The latest agent episode (the one the agent card + drawer render), or null. */
export function latestEpisode(state: LiveState): AgentEpisode | null {
  return state.episodes.length > 0 ? state.episodes[state.episodes.length - 1]! : null;
}

/** Fold an ordered list of events from the initial state (used by replay + tests). */
export function reduceAll(events: EvidenceEvent[], from: LiveState = initialLiveState): LiveState {
  return events.reduce(reduceEvidence, from);
}
