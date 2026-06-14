import { describe, it, expect } from "vitest";
import { createAdapter } from "./adapter-factory.js";
import { RpcWebSocketAdapter } from "./ws-adapter.js";
import { GrpcAdapter } from "./grpc-adapter.js";
import type { LifecycleStream } from "./lifecycle-stream.js";
import type { Profile } from "../../schemas/config-schema.js";

const mockStream = { push: () => {} } as unknown as LifecycleStream;

const baseGuardrails = {
  maxTipLamports: 1_000_000,
  tipBand: [1_000, 1_000_000] as [number, number],
  maxRetries: 4,
  maxHoldSlots: 64,
  dryRun: true,
};

const wsProfile: Profile = {
  adapter: "ws",
  rpcEndpoint: "https://api.testnet.solana.com",
  wsEndpoint: "wss://api.testnet.solana.com",
  jitoBlockEngineUrl: "https://dallas.testnet.block-engine.jito.wtf",
  bundleCount: 12,
  faultInjection: { atBundle: 6 },
  guardrails: baseGuardrails,
  llm: { provider: "gemini", model: "gemini-2.5-flash" },
};

const grpcProfile: Profile = {
  adapter: "grpc",
  rpcEndpoint: "http://127.0.0.1:8899",
  grpcEndpoint: "localhost:10000",
  jitoBlockEngineUrl: "https://dallas.testnet.block-engine.jito.wtf",
  bundleCount: 3,
  faultInjection: { atBundle: 1 },
  guardrails: baseGuardrails,
  llm: { provider: "gemini", model: "gemini-2.5-flash" },
};

describe("createAdapter", () => {
  it("(a) ws profile → RpcWebSocketAdapter", () => {
    const adapter = createAdapter(wsProfile, mockStream);
    expect(adapter).toBeInstanceOf(RpcWebSocketAdapter);
  });

  it("(b) grpc profile → GrpcAdapter", () => {
    const adapter = createAdapter(grpcProfile, mockStream);
    expect(adapter).toBeInstanceOf(GrpcAdapter);
  });
});
