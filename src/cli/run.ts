import { loadConfig, type AppConfig } from "../config.js";
import { runSession } from "../core/orchestrator.js";

export async function runCommand(profileOverride?: string, live?: boolean): Promise<void> {
  try {
    process.loadEnvFile(".env");
  } catch {
    // .env optional
  }

  let config: AppConfig = loadConfig(profileOverride);
  const profile = profileOverride ?? config.adapter;

  if (live) {
    config = { ...config, guardrails: { ...config.guardrails, dryRun: false } };
  }

  try {
    await runSession({ config, profile });
  } catch (err) {
    console.error("[run] fatal:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
