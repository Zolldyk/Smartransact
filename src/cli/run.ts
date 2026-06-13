import { loadConfig } from "../config.js";
import { runSession } from "../core/orchestrator.js";

export async function runCommand(profileOverride?: string): Promise<void> {
  try {
    process.loadEnvFile(".env");
  } catch {
    // .env optional
  }

  const config = loadConfig(profileOverride);
  const profile = profileOverride ?? config.adapter;

  try {
    await runSession({ config, profile });
  } catch (err) {
    console.error("[run] fatal:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
