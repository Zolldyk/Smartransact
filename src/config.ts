import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ConfigFileSchema, type AppConfig } from "./schemas/config-schema.js";

export type { AppConfig } from "./schemas/config-schema.js";

/** Story 5.8 AC2 — the Jito searcher auth keypair MUST be a separate, fund-less
 * keypair, never the funded payer (KEYPAIR_PATH). Reusing the payer for searcher
 * auth would expose the funded key on the searcher path. Exported (and throwing,
 * not exiting) so it is unit-testable. */
export function assertJitoAuthKeypair(
  jitoAuthKeypairPath: string | undefined,
  keypairPath: string,
): void {
  // Compare RESOLVED absolute paths so the funded-payer guard cannot be bypassed
  // by spelling the same file two ways (relative vs absolute, "./x" vs "x").
  if (
    jitoAuthKeypairPath !== undefined &&
    resolve(jitoAuthKeypairPath) === resolve(keypairPath)
  ) {
    throw new Error(
      "JITO_AUTH_KEYPAIR_PATH must not be the funded payer keypair (KEYPAIR_PATH); use a separate fund-less keypair for Jito searcher auth",
    );
  }
}

export function loadConfig(profileOverride?: string): AppConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(resolve("smartransact.config.json"), "utf-8"));
  } catch (err) {
    console.error("Config error: cannot read smartransact.config.json —", (err as Error).message);
    process.exit(1);
  }

  const result = ConfigFileSchema.safeParse(raw);
  if (!result.success) {
    console.error("Config validation failed:\n", JSON.stringify(result.error.format(), null, 2));
    process.exit(1);
  }

  const profileName = profileOverride ?? result.data.active;
  const profileRaw = result.data.profiles[profileName];
  if (profileRaw === undefined) {
    console.error(`Config error: profile "${profileName}" not found. Available: ${Object.keys(result.data.profiles).join(", ")}`);
    process.exit(1);
  }

  // The active profile's llm.provider selects which API key is required.
  const llmProvider = profileRaw.llm.provider;
  const llmEnvVar =
    llmProvider === "groq" ? "GROQ_API_KEY"
    : llmProvider === "claude" ? "ANTHROPIC_API_KEY"
    : "GEMINI_API_KEY";
  const llmApiKey = process.env[llmEnvVar];
  if (!llmApiKey) {
    console.error(`Config error: ${llmEnvVar} is not set (required for llm.provider "${llmProvider}"). Add it to .env (see .env.example).`);
    process.exit(1);
  }

  const keypairPath = process.env["KEYPAIR_PATH"];
  if (!keypairPath) {
    console.error("Config error: KEYPAIR_PATH is not set. Add it to .env (see .env.example).");
    process.exit(1);
  }

  // Optional Jito searcher auth keypair (Story 5.8). Fund-less; only used when a
  // profile sets jitoSearcherUrl. Must never be the funded payer (AC2).
  const jitoAuthKeypairPath = process.env["JITO_AUTH_KEYPAIR_PATH"];
  try {
    assertJitoAuthKeypair(jitoAuthKeypairPath, keypairPath);
  } catch (err) {
    console.error("Config error:", (err as Error).message);
    process.exit(1);
  }

  let profile = profileRaw;

  const expandPlaceholders = (s: string, fieldName: string): string =>
    s.replace(/\$\{([A-Z0-9_]+)\}/g, (_, varName: string) => {
      const value = process.env[varName];
      if (!value) {
        console.error(`Config error: ${fieldName} references \${${varName}} but ${varName} is not set in .env.`);
        process.exit(1);
      }
      return value;
    });

  const rpcEndpoint = expandPlaceholders(profile.rpcEndpoint, "rpcEndpoint");
  if (profile.adapter === "grpc") {
    const grpcEndpoint = expandPlaceholders(profile.grpcEndpoint, "grpcEndpoint");
    const grpcXToken = profile.grpcXToken != null
      ? expandPlaceholders(profile.grpcXToken, "grpcXToken")
      : undefined;
    profile = { ...profile, rpcEndpoint, grpcEndpoint, grpcXToken };
  } else {
    profile = { ...profile, rpcEndpoint };
  }

  return { llmApiKey, keypairPath, jitoAuthKeypairPath, ...profile };
}
