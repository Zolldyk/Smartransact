import { describe, it, expect } from "vitest";
import { extractClaudeReasoning, type ClaudeBlock } from "./claude-provider.js";

const validDecision = { diagnosis: "blockhash aged out", action: "refresh", rationale: "fetch fresh" };

describe("extractClaudeReasoning", () => {
  it("(a) valid response with a thinking trace → ok, decision + trace", () => {
    const blocks: ClaudeBlock[] = [
      { type: "thinking", thinking: "the failure is expired_blockhash; refresh first" },
      { type: "text", text: JSON.stringify(validDecision) },
    ];
    const out = extractClaudeReasoning(blocks);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.value.decision.action).toBe("refresh");
      expect(out.value.thinkingTrace).toBe("the failure is expired_blockhash; refresh first");
    }
  });

  it("(b) malformed JSON → invalid_json failure", () => {
    const out = extractClaudeReasoning([{ type: "text", text: "{not valid json" }]);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.failure.reason).toBe("invalid_json");
  });

  it("(c) schema-violating decision → decision_schema_violation failure", () => {
    // action adjust_tip without newTipLamports (and missing diagnosis/rationale)
    const out = extractClaudeReasoning([{ type: "text", text: JSON.stringify({ action: "adjust_tip" }) }]);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.failure.reason).toBe("decision_schema_violation");
  });

  it("(d) no thinking block → ok with empty trace", () => {
    const out = extractClaudeReasoning([{ type: "text", text: JSON.stringify(validDecision) }]);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.value.thinkingTrace).toBe("");
  });
});
