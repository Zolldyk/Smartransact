// web/server/session-config.ts
//
// Pure builder for a per-session AppConfig used by the public web sandbox.
// Two non-negotiable safety overrides (NFR9 / FR43), applied server-side AFTER
// any client input is merged:
//   - AC5: guardrails.dryRun is forced `true`, unconditionally. No anonymous
//          session can ever spend SOL.
//   - AC6: keypairPath is forced to the ephemeral, never-funded sandbox key.
//          The client can never point it at the funded payer.
// The client may only influence a small, validated allow-list (BYO LLM
// provider/model/key, bundle count within a server cap, fault toggle). Anything
// else in the request body is rejected by `ClientOverridesSchema` (`.strict()`).

import { z } from "zod";
import type { AppConfig } from "../../src/config.js";

/** Hard server cap on bundles per anonymous session (bounds run time / abuse). */
export const MAX_SANDBOX_BUNDLE_COUNT = 12;

/**
 * The ONLY fields a client may set. `.strict()` rejects unknown keys, so a
 * client cannot smuggle `dryRun`, `keypairPath`, gRPC fields, or the SolInfra
 * token through this boundary (zod-at-boundary convention).
 */
export const ClientOverridesSchema = z
  .object({
    provider: z.enum(["gemini", "groq", "claude"]).optional(),
    model: z.string().min(1).max(100).optional(),
    // BYO LLM key — held in memory for the session only; never persisted/logged.
    apiKey: z.string().min(1).max(1000).optional(),
    bundleCount: z.number().int().positive().max(MAX_SANDBOX_BUNDLE_COUNT).optional(),
    injectFault: z.boolean().optional(),
  })
  .strict();

export type ClientOverrides = z.infer<typeof ClientOverridesSchema>;

/**
 * Builds the per-session config from a base config (loaded once at startup) and
 * validated client overrides. Never mutates `base` — every nested object is
 * rebuilt via spread so concurrent sessions stay isolated.
 */
export function buildSessionConfig(
  base: AppConfig,
  sandboxKeypairPath: string,
  overrides: ClientOverrides,
): AppConfig {
  const bundleCount = overrides.bundleCount ?? base.bundleCount;

  // Fault toggle. NOTE: in dryRun the orchestrator never injects a fault
  // (orchestrator.ts:296 gates injection on `!dryRun`), so this is effectively
  // inert for the public sandbox — but we honor the toggle so the config stays
  // truthful. When off, push atBundle out of the valid [0, bundleCount) range
  // so `isFaultBundle` can never select it; when on, clamp it in-range.
  const injectFault = overrides.injectFault ?? true;
  const atBundle = injectFault
    ? Math.min(base.faultInjection.atBundle, bundleCount - 1)
    : bundleCount;

  return {
    ...base,
    // BYO key flows in as the per-session LLM key (in-memory only). Falls back
    // to the server's default key when the client supplies none.
    llmApiKey: overrides.apiKey ?? base.llmApiKey,
    // AC6: always the non-funded ephemeral key — client can never override.
    keypairPath: sandboxKeypairPath,
    bundleCount,
    faultInjection: { atBundle },
    llm: {
      ...base.llm,
      provider: overrides.provider ?? base.llm.provider,
      model: overrides.model ?? base.llm.model,
    },
    guardrails: {
      ...base.guardrails,
      // AC5: dryRun forced true server-side, regardless of client input.
      dryRun: true,
    },
  };
}
