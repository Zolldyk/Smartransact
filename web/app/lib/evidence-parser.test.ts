// web/app/lib/evidence-parser.test.ts
//
// Pure value-in / value-out tests for the evidence-parser mapper.
// No DOM, no network. Fixtures mirror the shape of real evidence/lifecycle-log.jsonl
// lines (bigints already numbers, as they arrive on the wire).

import { describe, it, expect } from "vitest";
import { parseEvidenceEvent, type EvidenceEvent } from "./evidence-events";
import { parseEvidence } from "./evidence-parser";

function ev(raw: unknown): EvidenceEvent {
  const parsed = parseEvidenceEvent(raw);
  if (!parsed) throw new Error(`fixture did not parse: ${JSON.stringify(raw)}`);
  return parsed;
}

const SESSION = ev({
  event: "sessionStarted",
  at: "2026-06-14T03:14:57.395Z",
  sessionId: "mqd7o73n-6e0959",
  profile: "mainnet-ws",
  adapter: "ws",
});

const BUNDLE_A = ev({
  event: "bundleSubmitted",
  at: "2026-06-14T03:15:01.610Z",
  bundleId: "aaa111",
  slot: 426332922,
  tipLamports: 4746,
});

const BUNDLE_B = ev({
  event: "bundleSubmitted",
  at: "2026-06-14T03:16:00.000Z",
  bundleId: "bbb222",
  slot: 426332980,
  tipLamports: 6000,
});

const FAILURE_A = ev({
  event: "failureClassified",
  at: "2026-06-14T03:15:20.000Z",
  bundleId: "aaa111",
  classification: "bundle_failure",
  rawError: "Bundle timed out",
});

const DECISION_REFRESH = ev({
  event: "agentDecision",
  at: "2026-06-14T03:15:22.000Z",
  bundleId: "aaa111",
  episodeId: "ep-0",
  attempt: 0,
  observation: {
    episodeId: "ep-0",
    attempt: 0,
    failure: { classification: "bundle_failure", rawError: "Bundle timed out", failedAtSlot: 426332922 },
    blockhashAgeSlots: 51,
    currentSlot: 426332973,
    leader: { slotsUntilNextTargetWindow: 1, windowLengthSlots: 3 },
    tipMarket: {
      floorPercentiles: { p25: 1540, p50: 3549, p75: 10000, p95: 15567, p99: 77767 },
      emaP50: 4746,
      observedRecentTips: [],
    },
    myLastTipLamports: 4746,
    priorAttempts: [],
    guardrails: { maxTipLamports: 1000000, tipBandLamports: [1000, 1000000], attemptsRemaining: 4 },
  },
  decision: {
    diagnosis: "Bundle timed out",
    action: "refresh",
    rationale: "Refresh after timeout.",
  },
  thinkingTrace: "Step 1: refresh.",
  clamped: false,
});

function commitTransition(bundleId: string, stage: "processed" | "confirmed" | "finalized", slot: number, latencyMs = 410) {
  return ev({
    event: "commitmentTransition",
    at: "2026-06-14T03:15:05.000Z",
    bundleId,
    stage,
    slot,
    latencyFromPrevMs: latencyMs,
    source: { kind: "txStatusChanged", transport: "ws", signature: `sig-${stage}`, commitment: stage, slot },
  });
}

describe("parseEvidence", () => {
  it("(a) single bundle, no failure → status 'pending', stats correct", () => {
    const result = parseEvidence([SESSION, BUNDLE_A]);
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.status).toBe("pending");
    expect(row.bundleIdx).toBe(1);
    expect(row.submitSlot).toBe(426332922);
    expect(row.tipLamports).toBe(4746);
    expect(row.finalSlot).toBeNull();
    expect(row.finalSignature).toBeNull();
    expect(row.episode).toBeNull();
    expect(result.stats.bundlesSubmitted).toBe(1);
    expect(result.stats.landed).toBe(0);
    expect(result.stats.failures).toBe(0);
    expect(result.stats.agentRecoveries).toBe(0);
    expect(result.sessionId).toBe("mqd7o73n-6e0959");
  });

  it("(b) bundle with failureClassified + agentDecision action:'refresh' → status 'recovered'", () => {
    const result = parseEvidence([SESSION, BUNDLE_A, FAILURE_A, DECISION_REFRESH]);
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.status).toBe("recovered");
    expect(row.failureClassification).toBe("bundle_failure");
    expect(row.agentAction).toBe("refresh");
    expect(row.episode).not.toBeNull();
    expect(row.episode?.action).toBe("refresh");
    expect(row.episode?.diagnosis).toBe("Bundle timed out");
    expect(result.stats.failures).toBe(1);
    expect(result.stats.agentRecoveries).toBe(1);
  });

  it("(c) bundle with commitmentTransition finalized → status 'landed', finalSlot + finalSignature populated", () => {
    const events = [
      SESSION,
      BUNDLE_A,
      commitTransition("aaa111", "processed", 426332923),
      commitTransition("aaa111", "confirmed", 426332927, 520),
      commitTransition("aaa111", "finalized", 426332935, 800),
    ];
    const result = parseEvidence(events);
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.status).toBe("landed");
    expect(row.finalSlot).toBe(426332935);
    expect(row.finalSignature).toBe("sig-finalized");
    expect(row.procToConfMs).toBe(520);
    expect(row.commitmentTimeline).toHaveLength(3);
    expect(result.stats.landed).toBe(1);
  });

  it("(d) multi-bundle run with mixed statuses → stats aggregated correctly", () => {
    const FAILURE_B = ev({
      event: "failureClassified",
      at: "2026-06-14T03:16:30.000Z",
      bundleId: "bbb222",
      classification: "expired_blockhash",
      rawError: "Blockhash expired",
    });
    const DECISION_ABORT = ev({
      event: "agentDecision",
      at: "2026-06-14T03:16:32.000Z",
      bundleId: "bbb222",
      episodeId: "ep-1",
      attempt: 0,
      observation: {
        episodeId: "ep-1",
        attempt: 0,
        failure: { classification: "expired_blockhash", rawError: "Blockhash expired", failedAtSlot: 426332980 },
        blockhashAgeSlots: 160,
        currentSlot: 426333140,
        leader: { slotsUntilNextTargetWindow: 5, windowLengthSlots: 4 },
        tipMarket: {
          floorPercentiles: { p25: 1000, p50: 2000, p75: 5000, p95: 10000, p99: 50000 },
          emaP50: 3000,
          observedRecentTips: [],
        },
        myLastTipLamports: 6000,
        priorAttempts: [],
        guardrails: { maxTipLamports: 1000000, tipBandLamports: [1000, 1000000], attemptsRemaining: 0 },
      },
      decision: {
        diagnosis: "Blockhash expired; no retries left",
        action: "abort",
        rationale: "Abort — attemptsRemaining reached zero.",
      },
      thinkingTrace: "No retries left.",
      clamped: false,
    });

    // Bundle A: landed; Bundle B: failed (abort)
    const events = [
      SESSION,
      BUNDLE_A,
      BUNDLE_B,
      commitTransition("aaa111", "processed", 426332923),
      commitTransition("aaa111", "confirmed", 426332927),
      commitTransition("aaa111", "finalized", 426332935),
      FAILURE_B,
      DECISION_ABORT,
    ];
    const result = parseEvidence(events);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].status).toBe("landed");
    expect(result.rows[1].status).toBe("failed");
    expect(result.stats.bundlesSubmitted).toBe(2);
    expect(result.stats.landed).toBe(1);
    expect(result.stats.failures).toBe(1);
    expect(result.stats.agentRecoveries).toBe(1); // ep-1 unique episodeId
  });
});
