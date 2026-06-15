// web/app/lib/lifecycle-state.test.ts
//
// Pure value-in / value-out tests for the lifecycle reducer — the high-value
// testable seam (8.2's overrides.test.ts precedent). No DOM, no network. The
// fixtures are REAL lines copied verbatim from evidence/lifecycle-log.jsonl
// (bigints already numbers, as they arrive on the wire) so the tests prove the
// reducer is faithful to the committed run — including the honest gaps (no
// commitmentTransition → empty Track pips, unlit Landed).

import { describe, it, expect } from "vitest";
import { parseEvidenceEvent, type EvidenceEvent } from "./evidence-events";
import {
  PACKET_MAX_MS,
  PACKET_MIN_MS,
  clampPacketDuration,
  initialLiveState,
  latestEpisode,
  reduceAll,
  reduceEvidence,
  type LiveState,
} from "./lifecycle-state";

// ── Real fixture lines (copied from evidence/lifecycle-log.jsonl) ──────────────
const SESSION_STARTED = {
  event: "sessionStarted",
  at: "2026-06-14T03:14:57.395Z",
  sessionId: "mqd7o73n-6e0959",
  profile: "mainnet-ws",
  adapter: "ws",
};
const BUNDLE_SUBMITTED = {
  event: "bundleSubmitted",
  at: "2026-06-14T03:15:01.610Z",
  bundleId: "a87903c77e58dc902739c19755433cfd333bde0fac2bead6ea95431632f0ba8d",
  slot: 426332922,
  tipLamports: 4746,
  leaderWindow: { startSlot: 426332923, endSlot: 426332926 },
};
const FAILURE_CLASSIFIED = {
  event: "failureClassified",
  at: "2026-06-14T03:15:20.833Z",
  bundleId: "a87903c77e58dc902739c19755433cfd333bde0fac2bead6ea95431632f0ba8d",
  classification: "bundle_failure",
  rawError: "Bundle timed out after 50 slots",
};
const AGENT_DECISION = {
  event: "agentDecision",
  at: "2026-06-14T03:15:22.038Z",
  bundleId: "a87903c77e58dc902739c19755433cfd333bde0fac2bead6ea95431632f0ba8d",
  episodeId: "ep-0-mqd7op6r",
  attempt: 0,
  observation: {
    episodeId: "ep-0-mqd7op6r",
    attempt: 0,
    failure: { classification: "bundle_failure", rawError: "Bundle timed out after 50 slots", failedAtSlot: 426332922 },
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
    diagnosis: "Bundle timed out after 50 slots",
    action: "refresh",
    rationale: "The bundle timed out; the blockhash is likely stale and a refresh is needed.",
  },
  thinkingTrace: "Step 1: failure is a timeout. Step 2: blockhash age 51 → stale. Step 3: refresh.",
  clamped: false,
};
const FAULT_INJECTED = {
  event: "faultInjected",
  at: "2026-06-14T03:27:40.628Z",
  staleBlockhash: "94Jc6yvLyd1NpZACCU2MMYZof3av3UFF1eDvwiH8UWxJ",
  fetchedAtSlot: 426334667,
  becameStaleAtSlot: 426334818,
};
const SESSION_ENDED = {
  event: "sessionEnded",
  at: "2026-06-14T04:13:11.955Z",
  sessionId: "mqd7o73n-6e0959",
  reason: "completed",
};

/** Parse a raw fixture (proves parseEvidenceEvent accepts the real shapes too). */
function ev(raw: unknown): EvidenceEvent {
  const parsed = parseEvidenceEvent(raw);
  if (!parsed) throw new Error(`fixture did not parse: ${JSON.stringify(raw)}`);
  return parsed;
}

// Synthetic commitment transitions (the committed run has none — these exercise
// the landing path that lights only from a real commitmentTransition).
function commit(stage: "processed" | "confirmed" | "finalized", slot: number) {
  return ev({
    event: "commitmentTransition",
    at: "2026-06-14T03:15:05.000Z",
    bundleId: BUNDLE_SUBMITTED.bundleId,
    stage,
    slot,
    latencyFromPrevMs: 410,
    source: { kind: "txStatusChanged", transport: "ws", signature: "sig", commitment: stage, slot },
  });
}

describe("reduceEvidence", () => {
  it("(a) sessionStarted → Package stage active", () => {
    const s = reduceEvidence(initialLiveState, ev(SESSION_STARTED));
    expect(s.sessionStarted).toBe(true);
    expect(s.stages.package).toBe("live");
    expect(s.stages.send).toBe("pending");
  });

  it("(b) bundleSubmitted → Package+Aim done, Send live; tip/slot/leaderWindow captured", () => {
    const s = reduceAll([SESSION_STARTED, BUNDLE_SUBMITTED].map(ev));
    expect(s.stages.package).toBe("done");
    expect(s.stages.aim).toBe("done");
    expect(s.stages.send).toBe("live");
    expect(s.inputs.tipLamports).toBe(4746);
    expect(s.inputs.latestSlot).toBe(426332922);
    expect(s.inputs.leaderWindow).toEqual({ startSlot: 426332923, endSlot: 426332926 });
    expect(s.counts.bundlesSubmitted).toBe(1);
    expect(s.bundleSubmittedSeen).toBe(true);
  });

  it("(c) commitmentTransition processed→confirmed→finalized fills pips and lights Landed only on finalized", () => {
    let s = reduceAll([SESSION_STARTED, BUNDLE_SUBMITTED].map(ev));
    s = reduceEvidence(s, commit("processed", 426332925));
    expect(s.pips).toEqual({ processed: true, confirmed: false, finalized: false });
    expect(s.stages.track).toBe("live");
    expect(s.stages.landed).toBe("pending");

    s = reduceEvidence(s, commit("confirmed", 426332927));
    expect(s.pips).toEqual({ processed: true, confirmed: true, finalized: false });
    expect(s.landed).toBe(false);
    expect(s.stages.landed).toBe("pending");

    s = reduceEvidence(s, commit("finalized", 426332931));
    expect(s.pips).toEqual({ processed: true, confirmed: true, finalized: true });
    expect(s.landed).toBe(true);
    expect(s.stages.track).toBe("done");
    expect(s.stages.landed).toBe("done");
  });

  it("(d) failureClassified + agentDecision → recovery loop active + episode with thinking trace", () => {
    const s = reduceAll([SESSION_STARTED, BUNDLE_SUBMITTED, FAILURE_CLASSIFIED, AGENT_DECISION].map(ev));
    expect(s.recoveryActive).toBe(true);
    expect(s.stages.send).toBe("fault");
    expect(s.counts.failures).toBe(1);
    expect(s.counts.decisions).toBe(1);
    const epi = latestEpisode(s);
    expect(epi).not.toBeNull();
    expect(epi!.action).toBe("refresh");
    expect(epi!.diagnosis).toBe("Bundle timed out after 50 slots");
    expect(epi!.thinkingTrace).toContain("blockhash age 51");
    // observation/decision narrowed from `unknown`
    expect(epi!.observation?.tipMarket.floorPercentiles.p75).toBe(10000);
    expect(epi!.decision?.action).toBe("refresh");
  });

  it("(e) replaying the committed run (no commitmentTransition) leaves Track empty and Landed unlit", () => {
    // The real run is package→send→fault→recovery, never a landing.
    const s = reduceAll([SESSION_STARTED, BUNDLE_SUBMITTED, FAILURE_CLASSIFIED, AGENT_DECISION, FAULT_INJECTED, SESSION_ENDED].map(ev));
    expect(s.pips).toEqual({ processed: false, confirmed: false, finalized: false });
    expect(s.landed).toBe(false);
    expect(s.stages.landed).not.toBe("done");
    expect(s.stages.track).not.toBe("done");
    // the genuine fault is surfaced, not fabricated
    expect(s.faultInjected).toBe(true);
    expect(s.faultDetail?.staleBlockhash).toBe("94Jc6yvLyd1NpZACCU2MMYZof3av3UFF1eDvwiH8UWxJ");
  });

  it("(f) dryRun stream (sessionStarted → sessionEnded) is an honest terminal with no bundles", () => {
    const s = reduceAll([SESSION_STARTED, SESSION_ENDED].map(ev));
    expect(s.bundleSubmittedSeen).toBe(false);
    expect(s.counts.bundlesSubmitted).toBe(0);
    expect(s.sessionEnded).toBe(true);
    expect(s.endedReason).toBe("completed");
    expect(s.stages.package).toBe("done"); // prepared, but nothing submitted
    expect(s.stages.send).toBe("pending");
    expect(s.recoveryActive).toBe(false);
  });

  it("is pure; does not mutate the input state", () => {
    const before: LiveState = initialLiveState;
    const snapshot = JSON.stringify(before);
    reduceEvidence(before, ev(BUNDLE_SUBMITTED));
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

// ── Story 8.7: the one-shot packet-advance marker (AC1/AC2/AC3/AC6) ────────────
describe("reduceEvidence — advance marker", () => {
  it("(g) bundleSubmitted sets advance{stage:'send'}, seq increments, latencyMs ≥ 0 from the at-delta", () => {
    const s = reduceAll([SESSION_STARTED, BUNDLE_SUBMITTED].map(ev));
    expect(s.advance?.stage).toBe("send");
    expect(s.advance?.seq).toBe(1);
    // SESSION_STARTED at 03:14:57.395 → BUNDLE_SUBMITTED at 03:15:01.610 ≈ 4215ms.
    expect(s.advance?.latencyMs).toBeGreaterThanOrEqual(0);
    expect(s.advance?.latencyMs).toBe(
      Date.parse(BUNDLE_SUBMITTED.at) - Date.parse(SESSION_STARTED.at),
    );
  });

  it("(h) commitmentTransition processed → advance{stage:'track', latencyMs:event.latencyFromPrevMs}; finalized → 'landed'", () => {
    let s = reduceAll([SESSION_STARTED, BUNDLE_SUBMITTED].map(ev));
    const seqAfterSubmit = s.advance!.seq;

    s = reduceEvidence(s, commit("processed", 426332925));
    expect(s.advance?.stage).toBe("track");
    expect(s.advance?.latencyMs).toBe(410); // commit() fixture latencyFromPrevMs
    expect(s.advance?.seq).toBe(seqAfterSubmit + 1);

    s = reduceEvidence(s, commit("finalized", 426332931));
    expect(s.advance?.stage).toBe("landed");
    expect(s.advance?.latencyMs).toBe(410);
    expect(s.advance?.seq).toBe(seqAfterSubmit + 2);
  });

  it("(i) failureClassified / agentDecision / faultInjected do NOT advance the packet (seq + ref preserved) — locks AC3/AC6", () => {
    const submitted = reduceAll([SESSION_STARTED, BUNDLE_SUBMITTED].map(ev));
    const marker = submitted.advance;
    expect(marker?.stage).toBe("send");
    expect(marker?.seq).toBe(1);

    // Each non-advancing event must leave the SAME advance reference untouched.
    const afterFail = reduceEvidence(submitted, ev(FAILURE_CLASSIFIED));
    expect(afterFail.advance).toBe(marker); // identity preserved, no re-trigger

    const afterDecision = reduceEvidence(afterFail, ev(AGENT_DECISION));
    expect(afterDecision.advance).toBe(marker);

    const afterFault = reduceEvidence(afterDecision, ev(FAULT_INJECTED));
    expect(afterFault.advance).toBe(marker);
    expect(afterFault.advance?.seq).toBe(1);
  });

  it("(j) the committed run (no commitmentTransition) never produces a track/landed advance", () => {
    const s = reduceAll(
      [SESSION_STARTED, BUNDLE_SUBMITTED, FAILURE_CLASSIFIED, AGENT_DECISION, FAULT_INJECTED, SESSION_ENDED].map(ev),
    );
    // The only advance ever set is the Send beat from bundleSubmitted (AC6).
    expect(s.advance?.stage).toBe("send");
    expect(s.advance?.seq).toBe(1);
  });
});

describe("clampPacketDuration (AC2 watchable band)", () => {
  it("clamps below the floor up to PACKET_MIN_MS", () => {
    expect(clampPacketDuration(100)).toBe(PACKET_MIN_MS);
    expect(clampPacketDuration(0)).toBe(PACKET_MIN_MS);
    expect(clampPacketDuration(Number.NaN)).toBe(PACKET_MIN_MS);
  });
  it("passes a value inside the band through (rounded)", () => {
    expect(clampPacketDuration(900)).toBe(900);
    expect(clampPacketDuration(900.6)).toBe(901);
  });
  it("clamps above the ceiling down to PACKET_MAX_MS", () => {
    expect(clampPacketDuration(5000)).toBe(PACKET_MAX_MS);
  });
});

describe("parseEvidenceEvent", () => {
  it("ignores unknown / malformed events (returns null, never throws)", () => {
    expect(parseEvidenceEvent({ event: "slotTick", at: "x" })).toBeNull();
    expect(parseEvidenceEvent({ event: "bundleSubmitted" })).toBeNull(); // no `at`
    expect(parseEvidenceEvent(null)).toBeNull();
    expect(parseEvidenceEvent("nope")).toBeNull();
    expect(parseEvidenceEvent(SESSION_STARTED)?.event).toBe("sessionStarted");
  });
});
