import { describe, it, expect } from "vitest";
import { classifyFailure } from "./failure-classifier.js";

describe("classifyFailure", () => {
  it("(a) BlockhashNotFound → expired_blockhash", () => {
    const result = classifyFailure(new Error("BlockhashNotFound"));
    expect(result.classification).toBe("expired_blockhash");
    expect(result.rawError).toBe("BlockhashNotFound");
  });

  it("(b) InsufficientFundsForFee → fee_too_low", () => {
    const result = classifyFailure("InsufficientFundsForFee");
    expect(result.classification).toBe("fee_too_low");
    expect(result.rawError).toBe("InsufficientFundsForFee");
  });

  it("(c) ComputationalBudgetExceeded → compute_exceeded", () => {
    const result = classifyFailure(new Error("ComputationalBudgetExceeded"));
    expect(result.classification).toBe("compute_exceeded");
    expect(result.rawError).toBe("ComputationalBudgetExceeded");
  });

  it("(d) unrecognized error → bundle_failure", () => {
    const result = classifyFailure(
      new Error("Bundle Dropped, no leader upcoming"),
    );
    expect(result.classification).toBe("bundle_failure");
    expect(result.rawError).toBe("Bundle Dropped, no leader upcoming");
  });
});
