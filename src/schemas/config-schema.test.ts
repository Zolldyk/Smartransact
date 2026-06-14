import { describe, it, expect } from "vitest";
import { ConfigFileSchema, GuardrailsSchema, ProfileSchema, LlmConfigSchema } from "./config-schema.js";

describe("LlmConfigSchema (Story 7.3)", () => {
  it("accepts the claude provider", () => {
    expect(LlmConfigSchema.safeParse({ provider: "claude", model: "claude-sonnet-4-6" }).success).toBe(true);
  });
  it("defaults provider to gemini when omitted (backward compatible)", () => {
    const r = LlmConfigSchema.safeParse({ model: "gemini-2.5-flash" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.provider).toBe("gemini");
  });
  it("accepts an optional baseURL (valid url) and rejects a non-url", () => {
    expect(LlmConfigSchema.safeParse({ provider: "groq", model: "x", baseURL: "https://api.groq.com/openai/v1" }).success).toBe(true);
    expect(LlmConfigSchema.safeParse({ provider: "groq", model: "x", baseURL: "not-a-url" }).success).toBe(false);
  });
  it("rejects an unknown provider", () => {
    expect(LlmConfigSchema.safeParse({ provider: "openai", model: "x" }).success).toBe(false);
  });
});

const GUARDRAIL_DEFAULTS = {
  maxTipLamports: 1_000_000,
  tipBand: [1_000, 1_000_000] as [number, number],
  maxRetries: 4,
  maxHoldSlots: 64,
};

const WS_PROFILE = {
  adapter: "ws" as const,
  rpcEndpoint: "https://api.testnet.solana.com",
  wsEndpoint: "wss://api.testnet.solana.com",
  jitoBlockEngineUrl: "https://dallas.testnet.block-engine.jito.wtf",
  bundleCount: 12,
  faultInjection: { atBundle: 6 },
  guardrails: GUARDRAIL_DEFAULTS,
  llm: { model: "gemini-2.5-flash" },
};

const VALID_CONFIG = {
  active: "testnet-ws",
  profiles: { "testnet-ws": WS_PROFILE },
};

describe("ConfigFileSchema", () => {
  it("accepts a valid testnet-ws config", () => {
    const result = ConfigFileSchema.safeParse(VALID_CONFIG);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.active).toBe("testnet-ws");
      expect(result.data.profiles["testnet-ws"]?.adapter).toBe("ws");
    }
  });

  it("rejects a grpc profile missing grpcEndpoint", () => {
    const invalid = {
      active: "local-grpc",
      profiles: {
        "local-grpc": {
          adapter: "grpc",
          rpcEndpoint: "http://127.0.0.1:8899",
          // grpcEndpoint intentionally omitted
          jitoBlockEngineUrl: "https://dallas.testnet.block-engine.jito.wtf",
          bundleCount: 3,
          faultInjection: { atBundle: 1 },
          guardrails: GUARDRAIL_DEFAULTS,
          llm: { model: "gemini-2.5-flash" },
        },
      },
    };
    const result = ConfigFileSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("rejects an unrecognized adapter value", () => {
    const invalid = {
      active: "bad",
      profiles: {
        bad: { ...WS_PROFILE, adapter: "udp" },
      },
    };
    expect(ConfigFileSchema.safeParse(invalid).success).toBe(false);
  });

  it("accepts a ws profile whose rpcEndpoint carries a ${VAR} placeholder (expanded by config.ts)", () => {
    const result = ProfileSchema.safeParse({
      ...WS_PROFILE,
      rpcEndpoint: "https://fra.rpc.solinfra.dev/sol?api_key=${SOLINFRA_RPC_KEY}",
    });
    expect(result.success).toBe(true);
  });
});

describe("GuardrailsSchema", () => {
  it("rejects negative maxTipLamports", () => {
    expect(
      GuardrailsSchema.safeParse({ ...GUARDRAIL_DEFAULTS, maxTipLamports: -1 }).success
    ).toBe(false);
  });

  it("rejects an inverted tipBand (min > max)", () => {
    expect(
      GuardrailsSchema.safeParse({
        ...GUARDRAIL_DEFAULTS,
        tipBand: [1_000_000, 1_000] as [number, number],
      }).success
    ).toBe(false);
  });

  it("rejects tipBand max above maxTipLamports", () => {
    expect(
      GuardrailsSchema.safeParse({
        ...GUARDRAIL_DEFAULTS,
        tipBand: [1_000, 2_000_000] as [number, number],
      }).success
    ).toBe(false);
  });
});

describe("ProfileSchema faultInjection.atBundle vs bundleCount", () => {
  it("(c) rejects atBundle >= bundleCount, accepts atBundle < bundleCount", () => {
    // atBundle equal to bundleCount: the fault drill could never fire → reject
    expect(
      ProfileSchema.safeParse({
        ...WS_PROFILE,
        bundleCount: 10,
        faultInjection: { atBundle: 10 },
      }).success
    ).toBe(false);
    // atBundle above bundleCount → reject
    expect(
      ProfileSchema.safeParse({
        ...WS_PROFILE,
        bundleCount: 10,
        faultInjection: { atBundle: 12 },
      }).success
    ).toBe(false);
    // valid 0-based index (9 < 10) → accept
    expect(
      ProfileSchema.safeParse({
        ...WS_PROFILE,
        bundleCount: 10,
        faultInjection: { atBundle: 9 },
      }).success
    ).toBe(true);
    // also enforced through ConfigFileSchema's record of profiles
    expect(
      ConfigFileSchema.safeParse({
        active: "testnet-ws",
        profiles: {
          "testnet-ws": {
            ...WS_PROFILE,
            bundleCount: 10,
            faultInjection: { atBundle: 10 },
          },
        },
      }).success
    ).toBe(false);
  });
});
