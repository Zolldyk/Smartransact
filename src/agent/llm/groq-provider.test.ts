import { describe, it, expect } from "vitest";
import { parseGroqDecision } from "./groq-provider.js";

describe("parseGroqDecision", () => {
  it("(a) valid decision JSON parses and pulls the thinking trace off", () => {
    const content = JSON.stringify({
      thinking: "Tip was below the market p50; raise it.",
      diagnosis: "Bundle timed out; tip too low.",
      action: "adjust_tip",
      newTipLamports: 5000,
      rationale: "Raise tip to the observed p50 to win the auction.",
    });
    const result = parseGroqDecision(content);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.decision.action).toBe("adjust_tip");
      expect(result.value.decision.newTipLamports).toBe(5000);
      expect(result.value.thinkingTrace).toContain("p50");
      // 'thinking' is stripped from the validated decision
      expect((result.value.decision as Record<string, unknown>)["thinking"]).toBeUndefined();
    }
  });

  it("(b) malformed JSON → invalid_json failure", () => {
    const result = parseGroqDecision("{ not json");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.reason).toBe("invalid_json");
  });

  it("(c) schema-violating decision → decision_schema_violation", () => {
    // action adjust_tip without newTipLamports violates the superRefine coupling
    const content = JSON.stringify({ diagnosis: "x", action: "adjust_tip", rationale: "y" });
    const result = parseGroqDecision(content);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.reason).toBe("decision_schema_violation");
  });

  it("(d) missing thinking field → thinkingTrace is empty string", () => {
    const content = JSON.stringify({ diagnosis: "x", action: "abort", rationale: "give up" });
    const result = parseGroqDecision(content);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.thinkingTrace).toBe("");
  });

  it("(e) empty content → empty_response", () => {
    const result = parseGroqDecision("");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.reason).toBe("empty_response");
  });

  it("(f) adjust_tip with stray holdSlots:0 is normalized to valid (drops the zero optional)", () => {
    const content = JSON.stringify({
      diagnosis: "Bundle timed out; under-tipped.",
      action: "adjust_tip",
      newTipLamports: 1500,
      holdSlots: 0, // model's "not applicable" — must not trip .positive()
      rationale: "Raise tip toward the observed p50.",
    });
    const result = parseGroqDecision(content);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.decision.action).toBe("adjust_tip");
      expect(result.value.decision.holdSlots).toBeUndefined();
    }
  });
});
