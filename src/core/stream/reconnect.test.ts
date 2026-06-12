import { describe, it, expect } from "vitest";
import { computeBackoffDelay, type ReconnectPolicy } from "./reconnect.js";

describe("computeBackoffDelay", () => {
  const policy: ReconnectPolicy = { initialDelayMs: 100, maxDelayMs: 400 };
  const noJitter = (): number => 0;

  it("(a) grows exponentially and caps at maxDelayMs", () => {
    expect(computeBackoffDelay(0, policy, noJitter)).toBe(100);  // 100 * 2^0
    expect(computeBackoffDelay(1, policy, noJitter)).toBe(200);  // 100 * 2^1
    expect(computeBackoffDelay(2, policy, noJitter)).toBe(400);  // 100 * 2^2 = 400 (at cap)
    expect(computeBackoffDelay(3, policy, noJitter)).toBe(400);  // 100 * 2^3 = 800 → capped
    expect(computeBackoffDelay(10, policy, noJitter)).toBe(400); // deep attempt, still capped
  });

  it("(b) jitter is within 0–25% of base delay", () => {
    const base = 100; // attempt 0, initialDelayMs 100
    const minDelay = computeBackoffDelay(0, policy, () => 0);
    const maxDelay = computeBackoffDelay(0, policy, () => 0.9999);
    expect(minDelay).toBe(base);
    expect(maxDelay).toBeLessThanOrEqual(base + Math.floor(base * 0.25));
    expect(maxDelay).toBeGreaterThan(base);
  });

  it("(c) different rand values produce independent jitter", () => {
    const d1 = computeBackoffDelay(0, policy, () => 0.1);
    const d2 = computeBackoffDelay(0, policy, () => 0.9);
    expect(d1).not.toBe(d2);
  });
});
