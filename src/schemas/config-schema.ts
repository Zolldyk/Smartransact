import { z } from "zod";

export const GuardrailsSchema = z.object({
  maxTipLamports: z.number().int().positive(),
  tipBand: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  maxRetries: z.number().int().positive(),
  maxHoldSlots: z.number().int().positive(),
});

export const FaultInjectionSchema = z.object({
  atBundle: z.number().int().nonnegative(),
});

export const LlmConfigSchema = z.object({
  model: z.string().min(1),
});

const WsProfileSchema = z.object({
  adapter: z.literal("ws"),
  rpcEndpoint: z.string().url(),
  wsEndpoint: z.string().url(),
  jitoBlockEngineUrl: z.string().url(),
  bundleCount: z.number().int().positive(),
  faultInjection: FaultInjectionSchema,
  guardrails: GuardrailsSchema,
  llm: LlmConfigSchema,
});

const GrpcProfileSchema = z.object({
  adapter: z.literal("grpc"),
  rpcEndpoint: z.string().url(),
  grpcEndpoint: z.string().min(1), // host:port, NOT a URL
  jitoBlockEngineUrl: z.string().url(),
  bundleCount: z.number().int().positive(),
  faultInjection: FaultInjectionSchema,
  guardrails: GuardrailsSchema,
  llm: LlmConfigSchema,
});

export const ProfileSchema = z.discriminatedUnion("adapter", [
  WsProfileSchema,
  GrpcProfileSchema,
]);

export const ConfigFileSchema = z.object({
  active: z.string().min(1),
  profiles: z.record(z.string(), ProfileSchema),
});

export type Profile = z.infer<typeof ProfileSchema>;
export type ConfigFile = z.infer<typeof ConfigFileSchema>;
export type AppConfig = {
  geminiApiKey: string;
  keypairPath: string;
} & Profile;
