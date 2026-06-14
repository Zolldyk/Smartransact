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

/** Hard ceiling on the agent's retry budget for an anonymous session. The run is
 * additionally time-boxed (index.ts SESSION_TIMEOUT_MS); this bounds the loop. */
export const MAX_SANDBOX_MAX_RETRIES = 8;

/**
 * The ONLY fields a client may set. `.strict()` rejects unknown keys, so a
 * client cannot smuggle `dryRun`, `keypairPath`, gRPC fields, or the SolInfra
 * token through this boundary (zod-at-boundary convention).
 *
 * Story 8.2 (Task 7) additively widened this with the guardrail tuning fields
 * (`tipBand`, `maxTipLamports`, `maxRetries`) so the Config Sandbox's "Customize"
 * controls are functional. This is safe because `dryRun` is forced `true`
 * server-side (below) — guardrail tweaks can never cause a spend. The values are
 * clamped (not rejected) in `buildSessionConfig` so a hostile payload degrades
 * to a valid config rather than tearing down the session.
 */
export const ClientOverridesSchema = z
  .object({
    provider: z.enum(["gemini", "groq", "claude"]).optional(),
    model: z.string().min(1).max(100).optional(),
    // BYO LLM key — held in memory for the session only; never persisted/logged.
    apiKey: z.string().min(1).max(1000).optional(),
    bundleCount: z.number().int().positive().max(MAX_SANDBOX_BUNDLE_COUNT).optional(),
    injectFault: z.boolean().optional(),
    // Guardrail tuning (Story 8.2). Shapes mirror src/schemas/config-schema.ts
    // GuardrailsSchema; the cross-field rule (tipBand[0] ≤ tipBand[1] ≤
    // maxTipLamports) is enforced by clamping in buildSessionConfig.
    tipBand: z.tuple([z.number().int().positive(), z.number().int().positive()]).optional(),
    maxTipLamports: z.number().int().positive().optional(),
    maxRetries: z.number().int().positive().optional(),
  })
  .strict();

/** Clamp `n` into the inclusive [lo, hi] range. */
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}

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

  // Guardrail tuning (Story 8.2 Task 7). Clamp every client value so the merged
  // guardrails ALWAYS satisfy the GuardrailsSchema cross-field invariant
  // (tipBand[0] ≤ tipBand[1] ≤ maxTipLamports) without ever throwing — a hostile
  // payload degrades to a valid config instead of tearing down the session. The
  // server's own cap (`base.guardrails.maxTipLamports`) is the ceiling; the
  // client may lower the band but never raise the spend ceiling (inert under
  // forced dryRun, but truthful regardless).
  const tipCap = base.guardrails.maxTipLamports;
  const maxTipLamports = clamp(overrides.maxTipLamports ?? tipCap, 1, tipCap);
  const [reqMin, reqMax] = overrides.tipBand ?? base.guardrails.tipBand;
  const tipMin = clamp(reqMin, 1, maxTipLamports);
  const tipMax = clamp(reqMax, 1, maxTipLamports);
  const tipBand: [number, number] = tipMin <= tipMax ? [tipMin, tipMax] : [tipMax, tipMin];
  const maxRetries = clamp(overrides.maxRetries ?? base.guardrails.maxRetries, 1, MAX_SANDBOX_MAX_RETRIES);

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
      tipBand,
      maxTipLamports,
      maxRetries,
      // AC5: dryRun forced true server-side, regardless of client input.
      dryRun: true,
    },
  };
}
