import { readFileSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const LOGS_DIR = "logs";
const POLL_MS = 500;

function shortId(id: unknown): string {
  const s = String(id ?? "?");
  return s.length > 8 ? `…${s.slice(-8)}` : s;
}

function printEvent(ev: unknown): boolean {
  if (!ev || typeof ev !== "object") return false;
  const e = ev as Record<string, unknown>;
  switch (e["event"]) {
    case "sessionStarted":
      console.log(`[session] ${e["sessionId"]} | profile: ${e["profile"]} | adapter: ${e["adapter"]}`);
      return false;
    case "bundleSubmitted":
      console.log(`[bundle ${shortId(e["bundleId"])}] submitted | slot ${e["slot"]} | tip ${e["tipLamports"]} lamports`);
      return false;
    case "commitmentTransition":
      console.log(`[bundle ${shortId(e["bundleId"])}] ${e["stage"]} | slot ${e["slot"]} | +${e["latencyFromPrevMs"]}ms`);
      return false;
    case "failureClassified":
      console.log(`[bundle ${shortId(e["bundleId"] ?? "?")}] FAILED → ${e["classification"]}`);
      return false;
    case "agentDecision": {
      const dec = e["decision"] as Record<string, unknown> | null | undefined;
      const rationale = String(dec?.["rationale"] ?? "").slice(0, 60);
      console.log(`[agent] attempt ${e["attempt"]} → ${dec?.["action"] ?? "?"} | rationale: ${rationale}`);
      return false;
    }
    case "faultInjected":
      console.log(`[fault] stale blockhash injected | becomes stale at slot ${e["becameStaleAtSlot"]}`);
      return false;
    case "sessionEnded":
      console.log(`[session] ended${e["reason"] ? ` — ${e["reason"]}` : ""}`);
      return true;
    default:
      return false;
  }
}

export async function tailCommand(): Promise<void> {
  let files: string[];
  try {
    const all = await readdir(LOGS_DIR);
    files = all.filter((f) => f.endsWith(".jsonl") && f.startsWith("lifecycle-"));
  } catch {
    console.log("[tail] No session logs found. Run `smartransact run` to start a session.");
    return;
  }

  if (files.length === 0) {
    console.log("[tail] No session logs found. Run `smartransact run` to start a session.");
    return;
  }

  const sorted = files
    .map((f) => ({ name: f, mtime: statSync(join(LOGS_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  const logPath = join(LOGS_DIR, sorted[0].name);
  console.log(`[tail] ${logPath}`);

  let processedLines = 0;
  let stopped = false;

  process.once("SIGINT", () => {
    stopped = true;
    console.log("\n[tail] stopped");
  });

  while (!stopped) {
    try {
      const content = readFileSync(logPath, "utf8");
      const lines = content.split("\n").filter((l) => l.trim());
      const newLines = lines.slice(processedLines);
      for (const line of newLines) {
        try {
          const event = JSON.parse(line) as unknown;
          if (printEvent(event)) {
            console.log("[tail] session complete");
            return;
          }
          processedLines++;
        } catch {
          processedLines++;
        }
      }
    } catch {
      // logs/ not yet readable or file not yet created — retry next tick
    }
    await new Promise<void>((r) => setTimeout(r, POLL_MS));
  }
}
