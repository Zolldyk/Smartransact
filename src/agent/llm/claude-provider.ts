import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { AgentDecisionSchema } from "../../schemas/decision-schema.js";
import type { AgentObservation } from "../../schemas/observation-schema.js";
import { type LlmProvider, type LlmResult } from "./llm-provider.js";

// Derived from the CANONICAL AgentDecisionSchema so the model's output contract
// cannot drift from decision-schema.ts (AC3). `$schema` is dropped and
// `additionalProperties: false` added — Anthropic structured outputs requires it.
const DECISION_JSON_SCHEMA: Record<string, unknown> = (() => {
  const { $schema, ...rest } = z.toJSONSchema(AgentDecisionSchema) as Record<string, unknown>;
  return { ...rest, additionalProperties: false };
})();

// Same instruction as GeminiProvider, redefined locally so each provider stays
// self-contained (no shared agent constant to import). The model id and api key
// are CONSTRUCTOR-INJECTED here, never hardcoded (AC2).
const SYSTEM_INSTRUCTION = [
  "You are the retry strategist for a Solana Jito bundle-submission agent.",
  "A bundle failed to land. Given the structured observation, decide the single best next action.",
  "Actions: 'refresh' (fetch a fresh blockhash and resubmit), 'adjust_tip' (change the tip then resubmit),",
  "'hold' (wait some slots then resubmit), or 'abort' (give up).",
  "Stay within the guardrails reported in the observation. If guardrails.attemptsRemaining is 0,",
  "you MUST choose 'abort'. Set 'newTipLamports' only when changing the tip; 'holdSlots' only when holding.",
  "Reason from the observation's data — do not invent numbers. Respond with the JSON decision only.",
].join(" ");

// Headroom so a long summarized thinking trace cannot starve the JSON answer
// (a too-small cap truncates the decision → invalid_json/empty_response). Still
// non-streaming and well under the SDK HTTP-timeout window. [code review 2026-06-14]
const MAX_TOKENS = 8192;

/** Minimal structural shape of an Anthropic content block we consume. Declared
 * locally (not imported from the SDK) so extractClaudeReasoning is unit-testable
 * with plain object literals — matches the repo no-mock convention. */
export type ClaudeBlock = { type: string; text?: string; thinking?: string };

/** Models sometimes emit a zero for an optional field that doesn't apply to the
 * chosen action (e.g. `holdSlots: 0` on a `refresh`). `holdSlots` is `.positive()`
 * so a stray 0 trips schema validation; strip such not-applicable zeros to absent
 * before parsing — mirrors GroqProvider.parseGroqDecision. Required fields for the
 * chosen action are left untouched (a genuinely-bad 0 there still fails, correctly).
 * [code review 2026-06-14] */
function normalizeOptionalZeros(parsed: unknown): void {
  if (typeof parsed !== "object" || parsed === null) return;
  const d = parsed as Record<string, unknown>;
  if (d["holdSlots"] === 0 && d["action"] !== "hold") delete d["holdSlots"];
  if (d["newTipLamports"] === 0 && d["action"] !== "adjust_tip") delete d["newTipLamports"];
}

/** Pure, synchronous seam that converts raw Anthropic content blocks into a typed
 * result. Exported for unit tests — all 4 test cases call this directly.
 * Mirrors GeminiProvider.extractReasoning: thinking blocks → FR21 trace, text
 * block(s) → the decision JSON (validated against the canonical schema). */
export function extractClaudeReasoning(blocks: ClaudeBlock[]): LlmResult {
  const thinkingTrace = blocks
    .filter((b) => b.type === "thinking")
    .map((b) => b.thinking ?? "")
    .join("\n")
    .trim();

  const jsonText = blocks
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("")
    .trim();

  if (!jsonText) {
    return { ok: false, failure: { reason: "empty_response" } };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    return {
      ok: false,
      failure: {
        reason: "invalid_json",
        rawError: err instanceof Error ? err.message : String(err),
      },
    };
  }

  normalizeOptionalZeros(parsed);

  const result = AgentDecisionSchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      failure: {
        reason: "decision_schema_violation",
        rawError: JSON.stringify(result.error.flatten()),
      },
    };
  }

  return { ok: true, value: { decision: result.data, thinkingTrace } };
}

export class ClaudeProvider implements LlmProvider {
  private static readonly MAX_RETRIES = 4;
  private readonly anthropic: Anthropic;
  constructor(apiKey: string, private readonly model: string) {
    // maxRetries: 0 — this provider's own loop is the sole retry authority, so the
    // SDK's default 2 internal retries don't compound into ~12 HTTP attempts on a
    // sustained overload (matches the hand-rolled Groq client). [code review 2026-06-14]
    this.anthropic = new Anthropic({ apiKey, maxRetries: 0 });
  }

  async reason(observation: AgentObservation): Promise<LlmResult> {
    let lastError = "";
    for (let attempt = 0; attempt < ClaudeProvider.MAX_RETRIES; attempt++) {
      try {
        const response = await this.anthropic.messages.create({
          model: this.model,
          max_tokens: MAX_TOKENS,
          system: SYSTEM_INSTRUCTION,
          // Adaptive thinking + summarized display captures the FR21 reasoning
          // trace. No `temperature`/`effort`: those 400 on the newest Claude
          // models (Opus 4.7/4.8/Fable) and the model is BYO-key/user-chosen.
          thinking: { type: "adaptive", display: "summarized" },
          // Structured outputs constrain the answer to the decision schema so the
          // text block is always valid JSON (AC3).
          output_config: { format: { type: "json_schema", schema: DECISION_JSON_SCHEMA } },
          messages: [{ role: "user", content: JSON.stringify(observation) }],
        });
        // Guard the SDK boundary: if `content` is ever not an array (SDK drift, an
        // unexpected stop_reason variant), hand the seam an empty array → a typed
        // empty_response rather than a TypeError. [code review 2026-06-14]
        const blocks = Array.isArray(response.content)
          ? (response.content as unknown as ClaudeBlock[])
          : [];
        return extractClaudeReasoning(blocks);
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        // Transient API conditions (rate limit / overload / 5xx / connection)
        // back off and retry; everything else fails fast as a typed result.
        const retryable =
          err instanceof Anthropic.RateLimitError ||
          err instanceof Anthropic.InternalServerError ||
          err instanceof Anthropic.APIConnectionError ||
          (err instanceof Anthropic.APIError && err.status === 529);
        if (retryable && attempt < ClaudeProvider.MAX_RETRIES - 1) {
          const backoff = Math.min(2_000 * 2 ** attempt, 20_000) + Math.floor(Math.random() * 500);
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }
        break;
      }
    }
    return { ok: false, failure: { reason: "claude_request_failed", rawError: lastError } };
  }
}
