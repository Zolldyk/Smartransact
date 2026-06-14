import { describe, it, expect } from "vitest";
import { createLlmProvider } from "./provider-factory.js";
import { GeminiProvider } from "./gemini-provider.js";
import { GroqProvider } from "./groq-provider.js";
import { ClaudeProvider } from "./claude-provider.js";

const base = { apiKey: "test-key", model: "test-model" } as const;

describe("createLlmProvider", () => {
  it("(a) builds a ClaudeProvider for 'claude'", () => {
    expect(createLlmProvider({ ...base, provider: "claude" })).toBeInstanceOf(ClaudeProvider);
  });

  it("(b) builds a GroqProvider for 'groq'", () => {
    expect(createLlmProvider({ ...base, provider: "groq" })).toBeInstanceOf(GroqProvider);
  });

  it("(c) builds a GeminiProvider for 'gemini'", () => {
    expect(createLlmProvider({ ...base, provider: "gemini" })).toBeInstanceOf(GeminiProvider);
  });

  it("(d) defaults to GeminiProvider for an unrecognized provider", () => {
    // cast past the type union to exercise the runtime default branch
    expect(createLlmProvider({ ...base, provider: "openai" as never })).toBeInstanceOf(GeminiProvider);
  });

  it("(e) every built provider satisfies the LlmProvider interface", () => {
    for (const provider of ["gemini", "groq", "claude"] as const) {
      expect(typeof createLlmProvider({ ...base, provider }).reason).toBe("function");
    }
  });
});
