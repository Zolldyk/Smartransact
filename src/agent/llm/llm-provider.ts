import type { AgentObservation } from "../../schemas/observation-schema.js";
import type { AgentDecision } from "../../schemas/decision-schema.js";

/** What the model produced: the validated decision plus the FR21 thinking
 * trace. `thinkingTrace` is always a string ("" when the model emitted no
 * thought parts) so Story 4.6 can write it straight into the
 * `agentDecision` evidence event's `thinkingTrace: z.string()` field. */
export type Reasoning = { decision: AgentDecision; thinkingTrace: string };

/** Typed LLM failure — operational, never thrown (AC6). `reason` is a short
 * human-readable cause; `rawError` is the original error string when one
 * exists (kept for evidence/debugging, never re-thrown). */
export type LlmFailure = { reason: string; rawError?: string };

/** Result for the LLM boundary. Structurally identical to the shared
 * `Result<Reasoning, LlmFailure>` ON PURPOSE: the orchestrator (cli/, which
 * may import both layers) can pass this where a shared `Result` is expected
 * without a conversion, yet this file imports nothing outside `src/schemas/`
 * (AC7). Defined here instead of imported so the agent layer stays dependency-free. */
export type LlmResult =
  | { ok: true; value: Reasoning }
  | { ok: false; failure: LlmFailure };

export interface LlmProvider {
  reason(observation: AgentObservation): Promise<LlmResult>;
}
