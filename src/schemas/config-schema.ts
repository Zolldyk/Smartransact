import { z } from "zod";

export const GuardrailsSchema = z
  .object({
    maxTipLamports: z.number().int().positive(),
    tipBand: z.tuple([z.number().int().positive(), z.number().int().positive()]),
    maxRetries: z.number().int().positive(),
    maxHoldSlots: z.number().int().positive(),
    dryRun: z.boolean().optional().default(true),
  })
  .superRefine((g, ctx) => {
    if (g.tipBand[0] > g.tipBand[1]) {
      ctx.addIssue({
        code: "custom",
        path: ["tipBand"],
        message: `tipBand min (${g.tipBand[0]}) exceeds tipBand max (${g.tipBand[1]})`,
      });
    }
    if (g.tipBand[1] > g.maxTipLamports) {
      ctx.addIssue({
        code: "custom",
        path: ["tipBand"],
        message: `tipBand max (${g.tipBand[1]}) exceeds maxTipLamports (${g.maxTipLamports})`,
      });
    }
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
  rpcEndpoint: z.string().min(1), // may contain ${VAR} placeholders; expanded by config.ts
  grpcEndpoint: z.string().min(1), // host:port or ${VAR}; NOT a URL — normalized to https:// by GrpcAdapter
  grpcXToken: z.string().optional(),
  jitoBlockEngineUrl: z.string().url(),
  bundleCount: z.number().int().positive(),
  faultInjection: FaultInjectionSchema,
  guardrails: GuardrailsSchema,
  llm: LlmConfigSchema,
});

export const ProfileSchema = z
  .discriminatedUnion("adapter", [WsProfileSchema, GrpcProfileSchema])
  .superRefine((p, ctx) => {
    if (p.faultInjection.atBundle >= p.bundleCount) {
      ctx.addIssue({
        code: "custom",
        path: ["faultInjection", "atBundle"],
        message: `faultInjection.atBundle (${p.faultInjection.atBundle}) must be a valid 0-based bundle index < bundleCount (${p.bundleCount}); otherwise the fault drill never fires`,
      });
    }
  });

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
export type Guardrails = z.infer<typeof GuardrailsSchema>;
