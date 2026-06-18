// web/app/lib/evidence-parser.ts
//
// Pure synchronous mapper: EvidenceEvent[] → EvidenceTableData.
// No React, no fetch, no I/O. Mirrors the "one sanctioned pure mapper" pattern
// (lib/overrides.ts, lib/lifecycle-state.ts). The page feeds this after splitting
// the committed JSONL asset via parseEvidenceEvent.

import { type EvidenceEvent, narrowDecision } from "./evidence-events";

export interface CommitStep {
  stage: "processed" | "confirmed" | "finalized";
  slot: number;
  latencyMs: number;
  signature?: string;
}

export interface BundleEpisode {
  episodeId: string;
  attempt: number;
  diagnosis: string;
  action: string;
  newTipLamports?: number;
  rationale?: string;
  thinkingTrace: string;
}

export interface BundleRow {
  bundleId: string;
  bundleIdx: number;
  status: "landed" | "recovered" | "failed" | "pending";
  submitSlot: number | null;
  tipLamports: number | null;
  finalSlot: number | null;
  finalSignature: string | null;
  procToConfMs: number | null;
  failureClassification: string | null;
  agentAction: string | null;
  commitmentTimeline: CommitStep[];
  episode: BundleEpisode | null;
}

export interface EvidenceStats {
  bundlesSubmitted: number;
  landed: number;
  failures: number;
  agentRecoveries: number;
  sessionId?: string;
}

export interface EvidenceTableData {
  rows: BundleRow[];
  stats: EvidenceStats;
  sessionId?: string;
}

const RECOVERY_ACTIONS = new Set(["refresh", "adjust_tip", "hold"]);

function buildEpisode(ev: Extract<EvidenceEvent, { event: "agentDecision" }>): BundleEpisode | null {
  const dec = narrowDecision(ev.decision);
  if (!dec) return null;
  return {
    episodeId: ev.episodeId,
    attempt: ev.attempt,
    diagnosis: dec.diagnosis,
    action: dec.action,
    newTipLamports: dec.newTipLamports,
    rationale: dec.rationale,
    thinkingTrace: ev.thinkingTrace,
  };
}

export function parseEvidence(events: EvidenceEvent[]): EvidenceTableData {
  const rowMap = new Map<string, BundleRow>();
  const rowOrder: string[] = [];
  let failureCount = 0;
  let submittedCount = 0;
  const episodeIdSet = new Set<string>();
  let sessionId: string | undefined;

  // A fault → failureClassified → agentDecision sequence in the live log is NOT
  // tagged with a submitted bundleId (failureClassified carries none; the
  // agentDecision uses a synthetic "send-failed-N" id by design). The recovery
  // resubmission is the *next* bundleSubmitted event. We therefore correlate by
  // event order: stash an orphaned failure/decision, then attach it to the next
  // submitted bundle (the resubmission the agent's decision produced).
  let pendingFailure: string | null = null;
  let pendingEpisode: BundleEpisode | null = null;

  for (const ev of events) {
    if (ev.event === "sessionStarted") {
      sessionId = ev.sessionId;
    } else if (ev.event === "bundleSubmitted") {
      if (!rowMap.has(ev.bundleId)) {
        submittedCount++;
        const row: BundleRow = {
          bundleId: ev.bundleId,
          bundleIdx: rowOrder.length + 1,
          status: "pending",
          submitSlot: ev.slot,
          tipLamports: ev.tipLamports,
          finalSlot: null,
          finalSignature: null,
          procToConfMs: null,
          failureClassification: null,
          agentAction: null,
          commitmentTimeline: [],
          episode: null,
        };
        // Attach any pending (order-correlated) failure + agent recovery to this
        // resubmission — this bundle is the product of the agent's decision.
        if (pendingFailure !== null) {
          row.failureClassification = pendingFailure;
        }
        if (pendingEpisode !== null) {
          row.episode = pendingEpisode;
          row.agentAction = pendingEpisode.action;
        }
        pendingFailure = null;
        pendingEpisode = null;
        rowMap.set(ev.bundleId, row);
        rowOrder.push(ev.bundleId);
      }
    } else if (ev.event === "commitmentTransition") {
      const row = rowMap.get(ev.bundleId);
      if (row) {
        row.commitmentTimeline.push({
          stage: ev.stage,
          slot: ev.slot,
          latencyMs: ev.latencyFromPrevMs,
          signature: ev.source.signature,
        });
        if (ev.stage === "finalized") {
          row.finalSlot = ev.slot;
          row.finalSignature = ev.source.signature;
        } else if (ev.stage === "confirmed") {
          row.procToConfMs = ev.latencyFromPrevMs;
        }
      }
    } else if (ev.event === "failureClassified") {
      failureCount++;
      const row = ev.bundleId ? rowMap.get(ev.bundleId) : undefined;
      if (row) {
        // Failure carries a known submitted bundleId — attach directly.
        row.failureClassification = ev.classification;
      } else {
        // Orphaned failure — correlate to the upcoming resubmission by order.
        pendingFailure = ev.classification;
      }
    } else if (ev.event === "agentDecision") {
      episodeIdSet.add(ev.episodeId);
      const episode = buildEpisode(ev);
      const row = rowMap.get(ev.bundleId);
      if (row) {
        if (episode) {
          if (row.agentAction === null) {
            row.agentAction = episode.action;
          }
          row.episode = episode;
        }
      } else if (episode) {
        // Synthetic ("send-failed-N") id — correlate to the upcoming
        // resubmission by order.
        pendingEpisode = episode;
      }
    }
  }

  // A pending failure/episode with no following resubmission (e.g. the agent
  // aborted) is still a real failure case — surface it as its own row so it is
  // never silently dropped from the evidence table.
  if (pendingFailure !== null || pendingEpisode !== null) {
    const syntheticId = `episode-${rowOrder.length + 1}`;
    const row: BundleRow = {
      bundleId: syntheticId,
      bundleIdx: rowOrder.length + 1,
      status: "pending",
      submitSlot: null,
      tipLamports: null,
      finalSlot: null,
      finalSignature: null,
      procToConfMs: null,
      failureClassification: pendingFailure,
      agentAction: pendingEpisode?.action ?? null,
      commitmentTimeline: [],
      episode: pendingEpisode,
    };
    rowMap.set(syntheticId, row);
    rowOrder.push(syntheticId);
  }

  const isRecovery = (row: BundleRow) =>
    row.failureClassification !== null &&
    row.agentAction !== null &&
    RECOVERY_ACTIONS.has(row.agentAction);

  const rows: BundleRow[] = rowOrder.map((id) => {
    const row = rowMap.get(id)!;
    if (isRecovery(row)) {
      // Failed, the agent recovered, and (if finalSlot is set) it then landed.
      // "recovered" is the more informative label and stays visible in the table.
      row.status = "recovered";
    } else if (row.finalSlot !== null) {
      row.status = "landed";
    } else if (row.failureClassification !== null) {
      row.status = "failed";
    } else {
      row.status = "pending";
    }
    return row;
  });

  // "landed" counts bundles finalized on-chain (verifiable on an explorer),
  // which includes recovered bundles that went on to finalize.
  const landed = rows.filter((r) => r.finalSlot !== null).length;

  return {
    rows,
    stats: {
      bundlesSubmitted: submittedCount,
      landed,
      failures: failureCount,
      agentRecoveries: episodeIdSet.size,
      sessionId,
    },
    sessionId,
  };
}
