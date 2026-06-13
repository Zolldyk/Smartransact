import { describe, it, expect } from "vitest";
import { runEpisode } from "./agent-loop.js";
import type { RunEpisodeParams, LoopContext, StepFeedback } from "./agent-loop.js";
import type { LlmProvider } from "./llm/llm-provider.js";
import type { AgentDecision } from "../schemas/decision-schema.js";
import type { Guardrails } from "../schemas/config-schema.js";

const G: Guardrails = {
  maxTipLamports: 1_000_000,
  tipBand: [1_000, 1_000_000],
  maxRetries: 4,
  maxHoldSlots: 64,
  dryRun: true,
};

const baseCtx: LoopContext = {
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
  lastTipLamports: 2000,
};

function makeProvider(decisions: AgentDecision[]): LlmProvider {
  let i = 0;
  return {
    async reason() {
      const d = decisions[i++]!;
      return { ok: true, value: { decision: d, thinkingTrace: `trace-${i}` } };
    },
  };
}

describe("runEpisode", () => {
  it("(a) abort on first decision — executeStep called once, returns ok:true", async () => {
    const abortDecision: AgentDecision = {
      diagnosis: "blockhash expired, no time to retry",
      action: "abort",
      rationale: "abort now",
    };

    let callCount = 0;
    let capturedStep: Parameters<RunEpisodeParams["executeStep"]>[0] | undefined;

    const executeStep = async (step: Parameters<RunEpisodeParams["executeStep"]>[0]): Promise<StepFeedback> => {
      callCount++;
      capturedStep = step;
      return { done: true };
    };

    const result = await runEpisode({
      episodeId: "ep-001",
      context: baseCtx,
      guardrails: G,
      provider: makeProvider([abortDecision]),
      executeStep,
    });

    expect(result.ok).toBe(true);
    expect(callCount).toBe(1);
    expect(capturedStep!.decision.action).toBe("abort");
    expect(capturedStep!.observation.attempt).toBe(0);
    expect(capturedStep!.observation.episodeId).toBe("ep-001");
  });

  it("(b) two iterations: refresh (done:false) then abort (done:true)", async () => {
    const refreshDecision: AgentDecision = {
      diagnosis: "worth retrying",
      action: "refresh",
      rationale: "retry with same tip",
    };
    const abortDecision: AgentDecision = {
      diagnosis: "second attempt also failed",
      action: "abort",
      rationale: "give up",
    };

    let callCount = 0;
    const capturedSteps: Parameters<RunEpisodeParams["executeStep"]>[0][] = [];

    const executeStep = async (step: Parameters<RunEpisodeParams["executeStep"]>[0]): Promise<StepFeedback> => {
      callCount++;
      capturedSteps.push(step);
      if (callCount === 1) {
        return {
          done: false,
          priorAttempt: { action: "refresh", tipLamports: 3000, outcome: "not_landed", slot: 105 },
          next: { ...baseCtx, currentSlot: 110, lastTipLamports: 3000 },
        };
      }
      return { done: true };
    };

    const result = await runEpisode({
      episodeId: "ep-002",
      context: baseCtx,
      guardrails: G,
      provider: makeProvider([refreshDecision, abortDecision]),
      executeStep,
    });

    expect(result.ok).toBe(true);
    expect(callCount).toBe(2);
    expect(capturedSteps[1]!.observation.attempt).toBe(1);
    expect(capturedSteps[1]!.observation.priorAttempts).toHaveLength(1);
    expect(capturedSteps[1]!.observation.priorAttempts[0]!.action).toBe("refresh");
    expect(capturedSteps[1]!.observation.currentSlot).toBe(110);
    expect(capturedSteps[0]!.observation.episodeId).toBe("ep-002");
    expect(capturedSteps[1]!.observation.episodeId).toBe("ep-002");
  });

  it("(c) LLM failure — executeStep NOT called, returns ok:false", async () => {
    const provider: LlmProvider = {
      async reason() {
        return { ok: false, failure: { reason: "API error", rawError: "500" } };
      },
    };

    const executeStep = async (): Promise<StepFeedback> => {
      throw new Error("executeStep must not be called on LLM failure");
    };

    const result = await runEpisode({
      episodeId: "ep-003",
      context: baseCtx,
      guardrails: G,
      provider,
      executeStep,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.llmError.reason).toBe("API error");
    }
  });
});
