import { describe, it, expect } from "vitest";
import { extractReasoning } from "./gemini-provider.js";
import type { GeminiPart } from "./gemini-provider.js";

describe("extractReasoning", () => {
  it("(a) valid response with thinking — returns ok with decision and trace", () => {
    const parts: GeminiPart[] = [
      { text: "Blockhash is stale; refreshing is cheapest.", thought: true },
      { text: '{"diagnosis":"stale blockhash","action":"refresh","rationale":"age exceeds limit"}' },
    ];
    const result = extractReasoning(parts);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.decision.action).toBe("refresh");
    expect(result.value.thinkingTrace).toContain("Blockhash is stale");
  });

  it("(b) malformed JSON → typed failure, nothing thrown", () => {
    const parts: GeminiPart[] = [{ text: "{not json" }];
    const result = extractReasoning(parts);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.reason).toBe("invalid_json");
  });

  it("(c) schema-violating decision → typed failure", () => {
    const parts: GeminiPart[] = [
      { text: '{"diagnosis":"","action":"teleport","rationale":"x"}' },
    ];
    const result = extractReasoning(parts);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.reason).toBe("decision_schema_violation");
  });

  it("(d) no thought parts → thinkingTrace is empty string", () => {
    const parts: GeminiPart[] = [
      { text: '{"diagnosis":"low tip","action":"adjust_tip","newTipLamports":5000,"rationale":"raise to p75"}' },
    ];
    const result = extractReasoning(parts);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.thinkingTrace).toBe("");
    expect(result.value.decision.newTipLamports).toBe(5000);
  });
});
