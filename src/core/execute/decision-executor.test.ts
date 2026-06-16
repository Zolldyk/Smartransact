import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, rmSync, existsSync } from "node:fs";
import { createSolanaRpc, type BlockhashLifetimeConstraint } from "@solana/kit";
import { JitoClient } from "../jito/jito-client.js";
import { EvidenceLog } from "../evidence/evidence-log.js";
import { executeDecision, type ExecutorParams } from "./decision-executor.js";
import type { AgentObservation } from "../../schemas/observation-schema.js";
import type { Guardrails } from "../../schemas/config-schema.js";

function cleanup(sessionId: string): void {
  const p = `logs/lifecycle-${sessionId}.jsonl`;
  if (existsSync(p)) rmSync(p);
}

const G: Guardrails = {
  maxTipLamports: 1_000_000,
  tipBand: [1_000, 1_000_000],
  maxRetries: 4,
  maxHoldSlots: 64,
  dryRun: true,
};

const baseObs: AgentObservation = {
  episodeId: "ep-001",
  attempt: 0,
  failure: {
    classification: "expired_blockhash",
    rawError: "blockhash expired",
    failedAtSlot: 100,
  },
  blockhashAgeSlots: 155,
  currentSlot: 100,
  leader: { slotsUntilNextTargetWindow: 3, windowLengthSlots: 4 },
  tipMarket: {
    floorPercentiles: { p25: 1000, p50: 1500, p75: 2000, p95: 5000, p99: 10000 },
    emaP50: 1500,
    observedRecentTips: [],
  },
  myLastTipLamports: 2000,
  priorAttempts: [],
  guardrails: { maxTipLamports: 1_000_000, tipBandLamports: [1_000, 1_000_000], attemptsRemaining: 2 },
};

const dummyConstraint = {
  blockhash: "test-hash",
  lastValidBlockHeight: 999n,
} as BlockhashLifetimeConstraint;

function makeParams(
  evidenceLog: EvidenceLog,
  overrides: Partial<ExecutorParams> = {},
): ExecutorParams {
  return {
    decision: { diagnosis: "expired", action: "abort", rationale: "aborting" },
    observation: baseObs,
    thinkingTrace: "trace",
    bundleId: "bundle-test",
    lifetimeConstraint: dummyConstraint,
    keypairPath: "/unused",
    tipAccount: "11111111111111111111111111111112",
    submitter: new JitoClient("http://unused"),
    rpc: createSolanaRpc("http://unused"),
    evidenceLog,
    guardrails: G,
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe("executeDecision", () => {
  it("(a) abort returns { continued: false } and writes two evidence events", async () => {
    const sid = "exec-test-a";
    const log = new EvidenceLog(sid);
    try {
      const outcome = await executeDecision(makeParams(log, {
        decision: { diagnosis: "expired", action: "abort", rationale: "aborting" },
      }));
      log.close();

      expect(outcome.continued).toBe(false);

      const lines = readFileSync(`logs/lifecycle-${sid}.jsonl`, "utf8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l));

      expect(lines).toHaveLength(2);
      expect(lines[0].event).toBe("agentDecision");
      expect(lines[0].clamped).toBe(false);
      expect(lines[1].event).toBe("failureClassified");
      expect(lines[1].classification).toBe("expired_blockhash");
    } finally {
      cleanup(sid);
    }
  });

  it("(b) refresh + attemptsRemaining === 0 → clamped to abort via guardrails", async () => {
    const sid = "exec-test-b";
    const log = new EvidenceLog(sid);
    try {
      const obs: AgentObservation = {
        ...baseObs,
        guardrails: { ...baseObs.guardrails, attemptsRemaining: 0 },
      };
      const outcome = await executeDecision(makeParams(log, {
        decision: { diagnosis: "stale", action: "refresh", rationale: "try again" },
        observation: obs,
      }));
      log.close();

      expect(outcome.continued).toBe(false);

      const lines = readFileSync(`logs/lifecycle-${sid}.jsonl`, "utf8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l));

      const agentDecisionLine = lines.find((l: { event: string }) => l.event === "agentDecision");
      expect(agentDecisionLine.clamped).toBe(true);
      expect(agentDecisionLine.originalDecision.action).toBe("refresh");

      const failureLine = lines.find((l: { event: string }) => l.event === "failureClassified");
      expect(failureLine).toBeDefined();
      expect(failureLine.classification).toBe("expired_blockhash");
    } finally {
      cleanup(sid);
    }
  });

  it("(c) thinkingTrace and attempt are preserved in agentDecision event", async () => {
    const sid = "exec-test-c";
    const obs: AgentObservation = { ...baseObs, attempt: 3 };
    const log = new EvidenceLog(sid);
    try {
      await executeDecision(makeParams(log, {
        decision: { diagnosis: "expired", action: "abort", rationale: "done" },
        observation: obs,
        thinkingTrace: "deep-thought",
      }));
      log.close();

      const lines = readFileSync(`logs/lifecycle-${sid}.jsonl`, "utf8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l));

      expect(lines[0].thinkingTrace).toBe("deep-thought");
      expect(lines[0].attempt).toBe(3);
      expect(lines[0].episodeId).toBe("ep-001");
    } finally {
      cleanup(sid);
    }
  });
});
