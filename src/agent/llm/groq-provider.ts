import { z } from "zod";
import { AgentDecisionSchema } from "../../schemas/decision-schema.js";
import type { AgentObservation } from "../../schemas/observation-schema.js";
import { type LlmProvider, type LlmResult } from "./llm-provider.js";

// Groq exposes an OpenAI-compatible Chat Completions API. BYO-key, far more
// generous free-tier limits than Gemini (~30 RPM / 1000 RPD). Raw fetch (no SDK)
// matches the hand-rolled JitoClient convention — zero new dependencies.
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

// Same rationale as GeminiProvider: variance must come from the OBSERVATION,
// not sampling noise, so judges see input-traceable decisions. [architecture.md:183]
const TEMPERATURE = 0.2;

// Derived from the CANONICAL AgentDecisionSchema so the model's output contract
// cannot drift from decision-schema.ts. `$schema` dropped — embedded in the prompt.
const DECISION_JSON_SCHEMA: Record<string, unknown> = (() => {
  const { $schema, ...rest } = z.toJSONSchema(AgentDecisionSchema) as Record<string, unknown>;
  return rest;
})();

const SYSTEM_INSTRUCTION = [
  "You are the retry strategist for a Solana Jito bundle-submission agent.",
  "A bundle failed to land. Given the structured observation, decide the single best next action.",
  "Actions: 'refresh' (fetch a fresh blockhash and resubmit), 'adjust_tip' (change the tip then resubmit),",
  "'hold' (wait some slots then resubmit), or 'abort' (give up).",
  "Stay within the guardrails reported in the observation. If guardrails.attemptsRemaining is 0,",
  "you MUST choose 'abort'. Set 'newTipLamports' only when changing the tip; 'holdSlots' only when holding.",
  "Reason from the observation's data — do not invent numbers.",
  "STRICT OUTPUT RULES: use whole numbers only (no decimals).",
  "'newTipLamports' is a REQUIRED positive integer whenever action is 'adjust_tip'.",
  "'holdSlots' is a REQUIRED positive integer whenever action is 'hold'.",
  "'diagnosis' and 'rationale' must be non-empty strings.",
  "Respond with ONLY a JSON object matching this JSON Schema:",
  JSON.stringify(DECISION_JSON_SCHEMA),
  "Additionally include a 'thinking' string field containing your brief step-by-step reasoning.",
].join(" ");

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/** Pure parse seam (exported for unit tests). Pulls the optional FR21 'thinking'
 * trace off the raw object, then validates the rest against the canonical schema.
 * Unknown keys (like 'thinking') are stripped by Zod, so the decision stays clean. */
export function parseGroqDecision(content: string): LlmResult {
  if (!content) return { ok: false, failure: { reason: "empty_response" } };

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    return {
      ok: false,
      failure: { reason: "invalid_json", rawError: err instanceof Error ? err.message : String(err) },
    };
  }

  const obj = (parsed ?? {}) as Record<string, unknown>;
  const thinking = obj["thinking"];
  const thinkingTrace = typeof thinking === "string" ? thinking : "";

  // Models in JSON-object mode tend to emit `holdSlots: 0` / `newTipLamports: 0`
  // for actions that don't use them ("0 = not applicable"). The canonical schema
  // treats those fields as ABSENT when not applicable and requires them to be
  // positive when present — so a stray 0 trips `.positive()`. Normalize the two
  // conventions by dropping zero-valued optionals before validation.
  if (obj["holdSlots"] === 0) delete obj["holdSlots"];
  if (obj["newTipLamports"] === 0) delete obj["newTipLamports"];

  const result = AgentDecisionSchema.safeParse(obj);
  if (!result.success) {
    return {
      ok: false,
      failure: { reason: "decision_schema_violation", rawError: JSON.stringify(result.error.flatten()) },
    };
  }

  return { ok: true, value: { decision: result.data, thinkingTrace } };
}

export class GroqProvider implements LlmProvider {
  private static readonly MAX_RETRIES = 4;

  constructor(private readonly apiKey: string, private readonly model: string) {}

  async reason(observation: AgentObservation): Promise<LlmResult> {
    const baseMessages: ChatMessage[] = [
      { role: "system", content: SYSTEM_INSTRUCTION },
      { role: "user", content: JSON.stringify(observation) },
    ];
    let messages = baseMessages;
    let last: LlmResult = { ok: false, failure: { reason: "groq_request_failed", rawError: "no response" } };

    for (let attempt = 0; attempt < GroqProvider.MAX_RETRIES; attempt++) {
      let res: Response;
      try {
        res = await fetch(GROQ_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: this.model,
            messages,
            // Bump temperature slightly on repair attempts so a deterministic
            // bad output isn't reproduced verbatim.
            temperature: attempt === 0 ? TEMPERATURE : 0.4,
            response_format: { type: "json_object" },
          }),
        });
      } catch (err) {
        last = { ok: false, failure: { reason: "groq_request_failed", rawError: err instanceof Error ? err.message : String(err) } };
        break;
      }

      if ((res.status === 429 || res.status === 503) && attempt < GroqProvider.MAX_RETRIES - 1) {
        const backoff = Math.min(2_000 * 2 ** attempt, 20_000) + Math.floor(Math.random() * 500);
        await new Promise((r) => setTimeout(r, backoff));
        continue; // same messages — transient server issue, not a bad answer
      }
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        last = { ok: false, failure: { reason: "groq_request_failed", rawError: `HTTP ${res.status} from groq: ${detail.slice(0, 200)}` } };
        break;
      }

      const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const content = body.choices?.[0]?.message?.content ?? "";
      const parsed = parseGroqDecision(content);
      if (parsed.ok) return parsed;

      // Self-repair: JSON-object mode can't enforce the conditional-field schema,
      // so feed the invalid output + error back and ask for a strict correction.
      last = parsed;
      if (attempt < GroqProvider.MAX_RETRIES - 1) {
        const why = parsed.failure.rawError ? `${parsed.failure.reason}: ${parsed.failure.rawError}` : parsed.failure.reason;
        messages = [
          ...baseMessages,
          { role: "assistant", content },
          {
            role: "user",
            content:
              `Your previous response was invalid (${why}). Return ONLY a corrected JSON object that strictly matches the schema. ` +
              "Remember: 'newTipLamports' is a REQUIRED positive integer when action is 'adjust_tip'; " +
              "'holdSlots' is a REQUIRED positive integer when action is 'hold'; 'diagnosis' and 'rationale' must be non-empty strings; use whole numbers only.",
          },
        ];
      }
    }
    return last;
  }
}
