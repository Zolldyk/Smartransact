import { describe, it, expect } from "vitest";
import { buildSessionConfig, ClientOverridesSchema, MAX_SANDBOX_BUNDLE_COUNT } from "./session-config.js";
import type { AppConfig } from "../../src/config.js";

// A representative base config in the shape `loadConfig("mainnet-ws")` returns.
// `dryRun: false` and the funded keypair are deliberately set so the tests prove
// the builder OVERRIDES them server-side (AC5 / AC6) — never trusts the base.
function baseConfig(): AppConfig {
  return {
    llmApiKey: "server-default-key",
    keypairPath: "/secret/keypair-mainnet.json", // the funded payer (must never survive)
    adapter: "ws",
    rpcEndpoint: "https://fra.rpc.solinfra.dev/sol?api_key=SECRET",
    wsEndpoint: "wss://api.mainnet-beta.solana.com",
    jitoBlockEngineUrl: "https://frankfurt.mainnet.block-engine.jito.wtf",
    bundleCount: 12,
    faultInjection: { atBundle: 6 },
    guardrails: {
      maxTipLamports: 1_000_000,
      tipBand: [1000, 1_000_000],
      maxRetries: 4,
      maxHoldSlots: 64,
      dryRun: false,
    },
    llm: { provider: "groq", model: "llama-3.3-70b-versatile" },
  };
}

const SANDBOX_KEY = "/tmp/smartransact-sandbox-abc/sandbox-keypair.json";

describe("buildSessionConfig", () => {
  it("(a) forces dryRun=true even when base says false and client tries to disable it", () => {
    const cfg = buildSessionConfig(baseConfig(), SANDBOX_KEY, {
      // dryRun is not even an accepted client field — but prove the output is true.
    });
    expect(cfg.guardrails.dryRun).toBe(true);
  });

  it("(b) forces keypairPath to the sandbox key — funded payer never survives", () => {
    const cfg = buildSessionConfig(baseConfig(), SANDBOX_KEY, {});
    expect(cfg.keypairPath).toBe(SANDBOX_KEY);
    expect(cfg.keypairPath).not.toContain("keypair-mainnet");
  });

  it("(c) rejects unknown client fields (cannot smuggle dryRun/keypairPath)", () => {
    expect(() =>
      ClientOverridesSchema.parse({ dryRun: false, keypairPath: "/evil.json" }),
    ).toThrow();
  });

  it("(d) applies valid BYO LLM overrides (provider/model/key in-memory)", () => {
    const cfg = buildSessionConfig(baseConfig(), SANDBOX_KEY, {
      provider: "claude",
      model: "claude-sonnet-4-6",
      apiKey: "byo-user-key",
    });
    expect(cfg.llm.provider).toBe("claude");
    expect(cfg.llm.model).toBe("claude-sonnet-4-6");
    expect(cfg.llmApiKey).toBe("byo-user-key");
  });

  it("(e) caps bundleCount at the server max and clamps fault index in-range", () => {
    expect(() =>
      ClientOverridesSchema.parse({ bundleCount: MAX_SANDBOX_BUNDLE_COUNT + 1 }),
    ).toThrow();

    const cfg = buildSessionConfig(baseConfig(), SANDBOX_KEY, { bundleCount: 3 });
    expect(cfg.bundleCount).toBe(3);
    // atBundle must stay a valid 0-based index < bundleCount.
    expect(cfg.faultInjection.atBundle).toBeLessThan(cfg.bundleCount);
  });

  it("(f) injectFault=false pushes the fault index out of range so it never fires", () => {
    const cfg = buildSessionConfig(baseConfig(), SANDBOX_KEY, { injectFault: false });
    expect(cfg.faultInjection.atBundle).toBeGreaterThanOrEqual(cfg.bundleCount);
  });

  it("(g) does not mutate the base config (concurrent-session isolation)", () => {
    const base = baseConfig();
    buildSessionConfig(base, SANDBOX_KEY, { apiKey: "byo", bundleCount: 2 });
    expect(base.guardrails.dryRun).toBe(false);
    expect(base.keypairPath).toBe("/secret/keypair-mainnet.json");
    expect(base.bundleCount).toBe(12);
  });
});
