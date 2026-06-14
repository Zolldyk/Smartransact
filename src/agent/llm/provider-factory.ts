import { type LlmProvider } from "./llm-provider.js";
import { GeminiProvider } from "./gemini-provider.js";
import { GroqProvider } from "./groq-provider.js";
import { ClaudeProvider } from "./claude-provider.js";

/** Provider names wired today. `openai-compatible` is deferred to Story 7.2. */
export type LlmProviderName = "gemini" | "groq" | "claude";

/** Inputs needed to build a provider. `apiKey` is a bring-your-own-key passed
 * in memory only — the factory never reads `process.env`, never persists or logs
 * it (NFR9). `baseURL` is reserved for the deferred generic OpenAI-compatible
 * provider (Story 7.2); the three current providers ignore it. */
export type LlmProviderInput = {
  provider: LlmProviderName;
  apiKey: string;
  model: string;
  baseURL?: string;
};

/** The single seam that maps a provider name to an `LlmProvider`. All
 * provider-specific construction lives here so the orchestrator (core/) depends
 * only on the `LlmProvider` interface — no provider branching leaks into core
 * (NFR10). Defaults to Gemini. */
export function createLlmProvider(input: LlmProviderInput): LlmProvider {
  switch (input.provider) {
    case "claude":
      return new ClaudeProvider(input.apiKey, input.model);
    case "groq":
      return new GroqProvider(input.apiKey, input.model);
    case "gemini":
    default:
      return new GeminiProvider(input.apiKey, input.model);
  }
}
