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

export function parseEvidence(events: EvidenceEvent[]): EvidenceTableData {
  const rowMap = new Map<string, BundleRow>();
  const rowOrder: string[] = [];
  let failureCount = 0;
  const episodeIdSet = new Set<string>();
  let sessionId: string | undefined;

  for (const ev of events) {
    if (ev.event === "sessionStarted") {
      sessionId = ev.sessionId;
    } else if (ev.event === "bundleSubmitted") {
      if (!rowMap.has(ev.bundleId)) {
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
      if (ev.bundleId) {
        const row = rowMap.get(ev.bundleId);
        if (row) {
          row.failureClassification = ev.classification;
        }
      }
    } else if (ev.event === "agentDecision") {
      episodeIdSet.add(ev.episodeId);
      const row = rowMap.get(ev.bundleId);
      if (row) {
        const dec = narrowDecision(ev.decision);
        if (dec) {
          if (row.agentAction === null) {
            row.agentAction = dec.action;
          }
          row.episode = {
            episodeId: ev.episodeId,
            attempt: ev.attempt,
            diagnosis: dec.diagnosis,
            action: dec.action,
            newTipLamports: dec.newTipLamports,
            rationale: dec.rationale,
            thinkingTrace: ev.thinkingTrace,
          };
        }
      }
    }
  }

  const rows: BundleRow[] = rowOrder.map((id) => {
    const row = rowMap.get(id)!;
    if (row.finalSlot !== null) {
      row.status = "landed";
    } else if (
      row.failureClassification !== null &&
      row.agentAction !== null &&
      RECOVERY_ACTIONS.has(row.agentAction)
    ) {
      row.status = "recovered";
    } else if (row.failureClassification !== null) {
      row.status = "failed";
    } else {
      row.status = "pending";
    }
    return row;
  });

  const landed = rows.filter((r) => r.status === "landed").length;

  return {
    rows,
    stats: {
      bundlesSubmitted: rows.length,
      landed,
      failures: failureCount,
      agentRecoveries: episodeIdSet.size,
      sessionId,
    },
    sessionId,
  };
}
