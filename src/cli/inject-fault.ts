import { loadConfig, type AppConfig } from "../config.js";
import { runSession } from "../core/orchestrator.js";

export async function injectFaultCommand(
  faultType: string,
  profileOverride?: string,
): Promise<void> {
  if (faultType !== "blockhash-expiry") {
    console.error(`[inject-fault] Unknown fault type: "${faultType}". Supported: blockhash-expiry`);
    process.exit(1);
  }

  try {
    process.loadEnvFile(".env");
  } catch {
    // .env optional
  }

  const config = loadConfig(profileOverride);
  const profile = profileOverride ?? config.adapter;

  // Force a single fault bundle at index 0 with live submission (dryRun off).
  const faultConfig = {
    ...config,
    bundleCount: 1,
    faultInjection: { atBundle: 0 },
    guardrails: { ...config.guardrails, dryRun: false },
  } as AppConfig;

  try {
    await runSession({ config: faultConfig, profile });
  } catch (err) {
    console.error("[inject-fault] fatal:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
