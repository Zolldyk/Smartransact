// web/app/lib/overrides.ts
//
// The single sanctioned path from ConfigForm state → the server's `ClientOverrides`
// payload (mirrors the repo's "one sanctioned mapper" pattern, e.g. the backend's
// serialize.ts / observation-builder.ts). PURE: value-in / value-out, no I/O, no
// React — so it is trivially unit-testable (lib/overrides.test.ts).
//
// The payload can ONLY ever carry the server's allow-list. It can NEVER carry
// `dryRun`, `keypairPath`, gRPC fields, or `transport` — those are server-fixed
// (NFR9). The server's `ClientOverridesSchema` is `.strict()`, so any stray key
// would be rejected; this mapper simply never produces one.
//
// Field shapes are kept in lock-step with web/server/session-config.ts
// (ClientOverridesSchema) and src/agent/llm/provider-factory.ts (provider enum).

/** Server hard cap on bundles per anonymous session (web/server/session-config.ts). */
export const MAX_SANDBOX_BUNDLE_COUNT = 12;

/** Provider segments — 1:1 with the server enum. Groq is the keyless default. */
export const PROVIDERS = ["groq", "gemini", "claude"] as const;
export type Provider = (typeof PROVIDERS)[number];

/** Human labels for the provider segmented control. */
export const PROVIDER_LABELS: Record<Provider, string> = {
  groq: "Groq",
  gemini: "Gemini",
  claude: "Claude",
};

/** Form state the ConfigForm owns. Mirrors the server `mainnet-ws` defaults. */
export interface ConfigFormState {
  provider: Provider;
  /** BYO LLM key — in React memory only; never persisted, logged, or put in the URL. */
  apiKey: string;
  bundleCount: number;
  injectFault: boolean;
  tipBandMin: number;
  tipBandMax: number;
  maxTipLamports: number;
  maxRetries: number;
}

/** The exact server allow-list (web/server/session-config.ts ClientOverridesSchema). */
export interface ClientOverrides {
  provider?: Provider;
  model?: string;
  apiKey?: string;
  bundleCount?: number;
  injectFault?: boolean;
  tipBand?: [number, number];
  maxTipLamports?: number;
  maxRetries?: number;
}

/**
 * Defaults that mirror the server `mainnet-ws` profile EXACTLY (story 8.2 Dev
 * Notes › Defaults): bundles 12 · fault blockhash-expiry on at #6 · tip band
 * [1000, 1000000] · maxTip 1000000 · maxRetries 4 · provider Groq (keyless).
 * The fault index (#6) is server-fixed and shown read-only in the UI — it is not
 * a client allow-list field, so it never appears in the payload.
 */
export const DEFAULT_FORM_STATE: ConfigFormState = {
  provider: "groq",
  apiKey: "",
  bundleCount: 12,
  injectFault: true,
  tipBandMin: 1_000,
  tipBandMax: 1_000_000,
  maxTipLamports: 1_000_000,
  maxRetries: 4,
};

/** The server-fixed fault bundle index (mainnet-ws `faultInjection.atBundle`). */
export const SERVER_FAULT_AT_BUNDLE = 6;

/** Groq runs keyless (server holds the key); Gemini/Claude require a BYO key. */
export function providerNeedsKey(provider: Provider): boolean {
  return provider !== "groq";
}

/**
 * Thrown by `buildOverrides` when a key-requiring provider has no BYO key — the
 * launch is blocked client-side (don't ship a request the server will only
 * reject). The form catches this and shows the "this provider needs your key"
 * affordance.
 */
export class MissingApiKeyError extends Error {
  constructor() {
    super("Add your API key. Gemini and Claude run on your own key for this session.");
    this.name = "MissingApiKeyError";
  }
}

/** Clamp `n` into the inclusive [lo, hi] range (also coerces NaN→lo). */
function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(Math.max(Math.round(n), lo), hi);
}

/**
 * Map validated form state → the server payload. Omits empty optionals (never
 * sends an empty `apiKey`/`model`); clamps `bundleCount` to the server cap; and
 * guards key-requiring providers client-side. Guardrail values pass through
 * (the server additionally clamps them); `tipBand` is ordered min ≤ max so the
 * server's cross-field rule never trips.
 */
export function buildOverrides(form: ConfigFormState): ClientOverrides {
  const apiKey = form.apiKey.trim();
  if (providerNeedsKey(form.provider) && apiKey === "") {
    throw new MissingApiKeyError();
  }

  const maxTipLamports = clamp(form.maxTipLamports, 1, Number.MAX_SAFE_INTEGER);
  let tipMin = clamp(form.tipBandMin, 1, Number.MAX_SAFE_INTEGER);
  let tipMax = clamp(form.tipBandMax, 1, Number.MAX_SAFE_INTEGER);
  if (tipMin > tipMax) {
    [tipMin, tipMax] = [tipMax, tipMin];
  }

  const overrides: ClientOverrides = {
    provider: form.provider,
    bundleCount: clamp(form.bundleCount, 1, MAX_SANDBOX_BUNDLE_COUNT),
    injectFault: form.injectFault,
    tipBand: [tipMin, tipMax],
    maxTipLamports,
    maxRetries: clamp(form.maxRetries, 1, Number.MAX_SAFE_INTEGER),
  };

  // Omit empty optionals. `apiKey` only when present (Gemini/Claude). `model` is
  // not exposed in 8.2 — the server's per-provider default applies — so it is
  // never sent.
  if (apiKey !== "") {
    overrides.apiKey = apiKey;
  }

  return overrides;
}
