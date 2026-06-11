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

  // Expand ${SOLINFRA_GRPC_ENDPOINT} placeholder for the solinfra-grpc profile
  let profile = profileRaw;
  if (profile.adapter === "grpc" && profile.grpcEndpoint.startsWith("${")) {
    if (!profile.grpcEndpoint.endsWith("}")) {
      console.error(`Config error: grpcEndpoint "${profile.grpcEndpoint}" is a malformed placeholder — expected \${VAR_NAME}.`);
      process.exit(1);
    }
    const envVarName = profile.grpcEndpoint.slice(2, -1);
    const expanded = process.env[envVarName];
    if (!expanded) {
      console.error(`Config error: grpcEndpoint references ${profile.grpcEndpoint} but ${envVarName} is not set in .env.`);
      process.exit(1);
    }
    profile = { ...profile, grpcEndpoint: expanded };
  }

  return { geminiApiKey, keypairPath, ...profile };
}
