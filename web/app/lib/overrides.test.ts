// web/app/lib/overrides.test.ts
//
// Pure value-in / value-out tests for the form-state → server-payload mapper.
// No DOM, no network. Mirrors the backend's session-config.test.ts intent: prove
// the boundary can never emit a forbidden field and always clamps to the cap.

import { describe, it, expect } from "vitest";
import {
  buildOverrides,
  DEFAULT_FORM_STATE,
  MAX_SANDBOX_BUNDLE_COUNT,
  MissingApiKeyError,
  type ConfigFormState,
} from "./overrides";

function form(overrides: Partial<ConfigFormState> = {}): ConfigFormState {
  return { ...DEFAULT_FORM_STATE, ...overrides };
}

describe("buildOverrides", () => {
  it("maps the defaults (Groq, keyless) to a one-click payload", () => {
    const payload = buildOverrides(form());
    expect(payload).toEqual({
      provider: "groq",
      bundleCount: 12,
      injectFault: true,
      tipBand: [1_000, 1_000_000],
      maxTipLamports: 1_000_000,
      maxRetries: 4,
    });
    // Groq is keyless — no apiKey emitted.
    expect(payload.apiKey).toBeUndefined();
  });

  it("never emits a forbidden field (dryRun / keypairPath / transport / model)", () => {
    const payload = buildOverrides(form({ provider: "claude", apiKey: "byo" }));
    const keys = Object.keys(payload);
    expect(keys).not.toContain("dryRun");
    expect(keys).not.toContain("keypairPath");
    expect(keys).not.toContain("transport");
    expect(keys).not.toContain("adapter");
    // model is not exposed in 8.2 — server default applies.
    expect(keys).not.toContain("model");
  });

  it("passes a BYO key through for a key-requiring provider", () => {
    const payload = buildOverrides(form({ provider: "claude", apiKey: "  sk-abc123  " }));
    expect(payload.provider).toBe("claude");
    expect(payload.apiKey).toBe("sk-abc123"); // trimmed
  });

  it("maps each provider segment 1:1 with the server enum", () => {
    expect(buildOverrides(form({ provider: "groq" })).provider).toBe("groq");
    expect(buildOverrides(form({ provider: "gemini", apiKey: "k" })).provider).toBe("gemini");
    expect(buildOverrides(form({ provider: "claude", apiKey: "k" })).provider).toBe("claude");
  });

  it("blocks launch (throws) when a key-requiring provider has no key", () => {
    expect(() => buildOverrides(form({ provider: "gemini", apiKey: "" }))).toThrow(MissingApiKeyError);
    expect(() => buildOverrides(form({ provider: "claude", apiKey: "   " }))).toThrow(MissingApiKeyError);
    // Groq with no key is fine.
    expect(() => buildOverrides(form({ provider: "groq", apiKey: "" }))).not.toThrow();
  });

  it("clamps bundleCount to the server cap", () => {
    expect(buildOverrides(form({ bundleCount: 99 })).bundleCount).toBe(MAX_SANDBOX_BUNDLE_COUNT);
    expect(buildOverrides(form({ bundleCount: 0 })).bundleCount).toBe(1);
    expect(buildOverrides(form({ bundleCount: 5 })).bundleCount).toBe(5);
  });

  it("passes guardrail fields through and orders an inverted tip band", () => {
    const payload = buildOverrides(form({ tipBandMin: 9_000, tipBandMax: 2_000, maxTipLamports: 500_000, maxRetries: 6 }));
    expect(payload.tipBand![0]).toBeLessThanOrEqual(payload.tipBand![1]);
    expect(payload.tipBand).toEqual([2_000, 9_000]);
    expect(payload.maxTipLamports).toBe(500_000);
    expect(payload.maxRetries).toBe(6);
  });

  it("honors the fault toggle", () => {
    expect(buildOverrides(form({ injectFault: false })).injectFault).toBe(false);
    expect(buildOverrides(form({ injectFault: true })).injectFault).toBe(true);
  });
});
