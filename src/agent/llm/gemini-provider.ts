import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { AgentDecisionSchema } from "../../schemas/decision-schema.js";
import type { AgentObservation } from "../../schemas/observation-schema.js";
import {
  type LlmProvider,
  type LlmResult,
  type Reasoning,
  type LlmFailure,
} from "./llm-provider.js";

// Derived from the CANONICAL AgentDecisionSchema so the model's output
// contract cannot drift from decision-schema.ts (AC3). `$schema` is dropped
// because Gemini's responseJsonSchema does not expect the meta key.
const DECISION_JSON_SCHEMA: Record<string, unknown> = (() => {
  const { $schema, ...rest } = z.toJSONSchema(AgentDecisionSchema) as Record<string, unknown>;
  return rest;
})();

// Low temperature by design: decision variance must come from VARYING
// OBSERVATIONS (FR19/CM3), not sampling noise — judges should see
// input-traceable differences, not dice rolls. [architecture.md:183]
const TEMPERATURE = 0.2;

const SYSTEM_INSTRUCTION = [
  "You are the retry strategist for a Solana Jito bundle-submission agent.",
  "A bundle failed to land. Given the structured observation, decide the single best next action.",
  "Actions: 'refresh' (fetch a fresh blockhash and resubmit), 'adjust_tip' (change the tip then resubmit),",
  "'hold' (wait some slots then resubmit), or 'abort' (give up).",
  "Stay within the guardrails reported in the observation. If guardrails.attemptsRemaining is 0,",
  "you MUST choose 'abort'. Set 'newTipLamports' only when changing the tip; 'holdSlots' only when holding.",
  "Reason from the observation's data — do not invent numbers. Respond with the JSON decision only.",
].join(" ");

/** Minimal structural shape of a Gemini content part we consume. Declared
 * locally (not imported from the SDK) so extractReasoning is unit-testable
 * with plain object literals — matches the repo no-mock convention. */
export type GeminiPart = { text?: string; thought?: boolean };

/** Pure, synchronous seam that converts raw Gemini parts into a typed result.
 * Exported for unit tests — all 4 test cases call this directly. */
export function extractReasoning(parts: GeminiPart[]): LlmResult {
  const thinkingTrace = parts
    .filter((p) => p.thought === true)
    .map((p) => p.text ?? "")
    .join("\n")
    .trim();

  const jsonText = parts
    .filter((p) => p.thought !== true)
    .map((p) => p.text ?? "")
    .join("");

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

export class GeminiProvider implements LlmProvider {
  private static readonly MAX_RETRIES = 4;
  private readonly ai: GoogleGenAI;
  constructor(apiKey: string, private readonly model: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async reason(observation: AgentObservation): Promise<LlmResult> {
    let lastError = "";
    for (let attempt = 0; attempt < GeminiProvider.MAX_RETRIES; attempt++) {
      try {
        const response = await this.ai.models.generateContent({
          model: this.model,
          contents: JSON.stringify(observation),
          config: {
            systemInstruction: SYSTEM_INSTRUCTION,
            temperature: TEMPERATURE,
            responseMimeType: "application/json",
            responseJsonSchema: DECISION_JSON_SCHEMA,
            thinkingConfig: { includeThoughts: true },
          },
        });
        const parts = response.candidates?.[0]?.content?.parts ?? [];
        return extractReasoning(parts as GeminiPart[]);
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        // Free-tier Gemini rate-limits (~10 RPM); rapid back-to-back episodes
        // trip 429/RESOURCE_EXHAUSTED. Back off and retry so the agent keeps
        // reasoning instead of dropping the decision. Non-rate-limit errors fail fast.
        const retryable = /429|resource_exhausted|quota|rate.?limit|unavailable|503|overloaded/i.test(lastError);
        if (retryable && attempt < GeminiProvider.MAX_RETRIES - 1) {
          const backoff = Math.min(2_000 * 2 ** attempt, 20_000) + Math.floor(Math.random() * 500);
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }
        break;
      }
    }
    return { ok: false, failure: { reason: "gemini_request_failed", rawError: lastError } };
  }
}
