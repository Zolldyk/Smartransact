import { buildObservation } from "./observation-builder.js";
import type { LlmProvider, LlmFailure } from "./llm/llm-provider.js";
import type {
  FailureContext,
  TipMarketData,
  LeaderContext,
  PriorAttempt,
  AgentObservation,
} from "../schemas/observation-schema.js";
import type { AgentDecision } from "../schemas/decision-schema.js";
import type { Guardrails } from "../schemas/config-schema.js";

/** Live context snapshot passed to the loop — updated each iteration by the
 * orchestrator via StepFeedback.next when a retry also fails. */
export type LoopContext = {
  failure: FailureContext;
  blockhashAgeSlots: number;
  currentSlot: number;
  leader: LeaderContext;
  tipMarket: TipMarketData;
  lastTipLamports: number;
};

/** What the loop hands to the orchestrator's executeStep for execution. */
export type AgentStep = {
  observation: AgentObservation;
  decision: AgentDecision;
  thinkingTrace: string;
};

/** What executeStep returns to drive loop continuation.
 * done:true  → loop exits (abort or send failure in executor).
 * done:false → retry was submitted but also failed; orchestrator provides
 *              the new failure context and the prior-attempt record to
 *              append to episode history. */
export type StepFeedback =
  | { done: true }
  | {
      done: false;
      priorAttempt: PriorAttempt;
      next: LoopContext;
    };

export type RunEpisodeParams = {
  episodeId: string;
  context: LoopContext;
  guardrails: Guardrails;
  provider: LlmProvider;
  /** Injected by the orchestrator (cli/ layer). Calls executeDecision and
   * returns done:true when the executor returns { continued: false }, or
   * done:false with the new failure context when the retry also fails. */
  executeStep: (step: AgentStep) => Promise<StepFeedback>;
};

export type EpisodeResult =
  | { ok: true }
  | { ok: false; failure: { llmError: LlmFailure } };

export async function runEpisode(params: RunEpisodeParams): Promise<EpisodeResult> {
  const { episodeId, guardrails, provider, executeStep } = params;
  let ctx = params.context;
  const priorAttempts: PriorAttempt[] = [];

  while (true) {
    const observation = buildObservation({
      episodeId,
      attempt: priorAttempts.length,
      failure: ctx.failure,
      blockhashAgeSlots: ctx.blockhashAgeSlots,
      currentSlot: ctx.currentSlot,
      leader: ctx.leader,
      tipMarket: ctx.tipMarket,
      myLastTipLamports: ctx.lastTipLamports,
      priorAttempts,
      guardrails,
    });

    const llmResult = await provider.reason(observation);
    if (!llmResult.ok) {
      return { ok: false, failure: { llmError: llmResult.failure } };
    }

    const { decision, thinkingTrace } = llmResult.value;
    const feedback = await executeStep({ observation, decision, thinkingTrace });

    if (feedback.done) break;

    priorAttempts.push(feedback.priorAttempt);
    ctx = feedback.next;
  }

  return { ok: true };
}
