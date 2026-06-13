import { describe, it, expect } from "vitest";
import { AgentDecisionSchema } from "./decision-schema.js";

const BASE = {
  diagnosis: "blockhash expired",
  rationale: "retry with fresh blockhash",
};

describe("AgentDecisionSchema action↔field coupling", () => {
  it("(a) adjust_tip with newTipLamports present → succeeds", () => {
    const result = AgentDecisionSchema.safeParse({
      ...BASE,
      action: "adjust_tip",
      newTipLamports: 5_000,
    });
    expect(result.success).toBe(true);
  });

  it("(b) adjust_tip without newTipLamports → fails on newTipLamports path", () => {
    const result = AgentDecisionSchema.safeParse({
      ...BASE,
      action: "adjust_tip",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("newTipLamports");
    }
  });

  it("(c) hold without holdSlots → fails on holdSlots path", () => {
    const result = AgentDecisionSchema.safeParse({
      ...BASE,
      action: "hold",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("holdSlots");
    }
  });

  it("(d) refresh with no optional fields → succeeds", () => {
    const result = AgentDecisionSchema.safeParse({
      ...BASE,
      action: "refresh",
    });
    expect(result.success).toBe(true);
  });

  it("(e) abort with no optional fields → succeeds", () => {
    const result = AgentDecisionSchema.safeParse({
      ...BASE,
      action: "abort",
    });
    expect(result.success).toBe(true);
  });
});
