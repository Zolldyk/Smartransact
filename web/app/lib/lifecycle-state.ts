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
 */
export function reduceEvidence(state: LiveState, event: EvidenceEvent): LiveState {
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
      // pips (they belong to the current bundle) and the Landed stage.
      return {
        ...state,
        currentBundleId: event.bundleId,
        bundleSubmittedSeen: true,
        counts: { ...state.counts, bundlesSubmitted: state.counts.bundlesSubmitted + 1 },
        pips: { processed: false, confirmed: false, finalized: false },
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
        diagnosis: decision?.diagnosis ?? observation?.failure.classification ?? "—",
        action: decision?.action ?? "hold",
        classification: observation?.failure.classification,
        newTipLamports: decision?.newTipLamports,
        rationale: decision?.rationale,
        thinkingTrace: event.thinkingTrace,
        observation,
        decision,
      };
      return {
        ...state,
        recoveryActive: true,
        counts: { ...state.counts, decisions: state.counts.decisions + 1 },
        episodes: [...state.episodes, episode],
        // currentSlot is a real, event-carried field — safe to surface.
        inputs: observation ? { ...state.inputs, latestSlot: observation.currentSlot } : state.inputs,
      };
    }

    case "faultInjected":
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
      return { ...state, note: `${event.count} event(s) dropped under load — the stream stayed connected.` };

    case "streamReconnected":
      return { ...state, note: `stream reconnected (attempt ${event.attempt}).` };

    case "sessionEnded":
      // Honest terminal. A dryRun session emits NO bundleSubmitted (locked 8.1
      // contract): mark Package done (it was prepared) and leave the rest pending
      // — the page shows the "dryRun — no bundle submitted (safe mode)" terminal.
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

/** The latest agent episode (the one the agent card + drawer render), or null. */
export function latestEpisode(state: LiveState): AgentEpisode | null {
  return state.episodes.length > 0 ? state.episodes[state.episodes.length - 1]! : null;
}

/** Fold an ordered list of events from the initial state (used by replay + tests). */
export function reduceAll(events: EvidenceEvent[], from: LiveState = initialLiveState): LiveState {
  return events.reduce(reduceEvidence, from);
}
