import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ConfigFileSchema, type AppConfig } from "./schemas/config-schema.js";

export type { AppConfig } from "./schemas/config-schema.js";

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

  const geminiApiKey = process.env["GEMINI_API_KEY"];
  if (!geminiApiKey) {
    console.error("Config error: GEMINI_API_KEY is not set. Add it to .env (see .env.example).");
    process.exit(1);
  }

  const keypairPath = process.env["KEYPAIR_PATH"];
  if (!keypairPath) {
    console.error("Config error: KEYPAIR_PATH is not set. Add it to .env (see .env.example).");
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

  return { geminiApiKey, keypairPath, ...profile };
}
