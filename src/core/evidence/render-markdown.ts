import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type BundleRow = {
  bundleId: string;
  tipLamports: number | null;
  submittedSlot: number | null;
  processedSlot: number | null;
  confirmedSlot: number | null;
  finalizedSlot: number | null;
  processedLatencyMs: number | null;
  confirmedLatencyMs: number | null;
  finalizedLatencyMs: number | null;
  failureClassification: string | null;
  agentAction: string | null;
};

function shortId(id: unknown): string {
  const s = String(id ?? "?");
  return s.length > 8 ? `…${s.slice(-8)}` : s;
}

function cell(v: number | string | null | undefined): string {
  return v === null || v === undefined ? "" : String(v);
}

export function renderMarkdown(lines: string[]): string {
  const rows = new Map<string, BundleRow>();
  let failedCount = 0;
  const episodeIds = new Set<string>();

  for (const line of lines) {
    if (!line.trim()) continue;
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    switch (ev["event"]) {
      case "bundleSubmitted": {
        const id = String(ev["bundleId"] ?? "");
        if (!rows.has(id)) {
          rows.set(id, {
            bundleId: id,
            tipLamports: ev["tipLamports"] !== undefined ? Number(ev["tipLamports"]) : null,
            submittedSlot: ev["slot"] !== undefined ? Number(ev["slot"]) : null,
            processedSlot: null,
            confirmedSlot: null,
            finalizedSlot: null,
            processedLatencyMs: null,
            confirmedLatencyMs: null,
            finalizedLatencyMs: null,
            failureClassification: null,
            agentAction: null,
          });
        }
        break;
      }
      case "commitmentTransition": {
        const id = String(ev["bundleId"] ?? "");
        const row = rows.get(id);
        if (!row) break;
        const stage = ev["stage"] as string;
        const slot = ev["slot"] !== undefined ? Number(ev["slot"]) : null;
        const latency = ev["latencyFromPrevMs"] !== undefined ? Number(ev["latencyFromPrevMs"]) : null;
        if (stage === "processed") {
          row.processedSlot = slot;
          row.processedLatencyMs = latency;
        } else if (stage === "confirmed") {
          row.confirmedSlot = slot;
          row.confirmedLatencyMs = latency;
        } else if (stage === "finalized") {
          row.finalizedSlot = slot;
          row.finalizedLatencyMs = latency;
        }
        break;
      }
      case "failureClassified": {
        failedCount++;
        const id = ev["bundleId"] !== undefined ? String(ev["bundleId"]) : null;
        if (id) {
          const row = rows.get(id);
          if (row) row.failureClassification = String(ev["classification"] ?? "");
        }
        break;
      }
      case "agentDecision": {
        const epId = ev["episodeId"];
        if (epId !== undefined) episodeIds.add(String(epId));
        const id = ev["bundleId"] !== undefined ? String(ev["bundleId"]) : null;
        if (id) {
          const row = rows.get(id);
          if (row && row.agentAction === null) {
            const dec = ev["decision"] as Record<string, unknown> | null | undefined;
            const action = dec?.["action"];
            if (action !== undefined) row.agentAction = String(action);
          }
        }
        break;
      }
    }
  }

  const header =
    "| Bundle ID | Tip (λ) | Sub Slot | Proc Slot | Conf Slot | Fin Slot | →proc ms | →conf ms | →fin ms | Failure | Agent Action |\n" +
    "|---|---|---|---|---|---|---|---|---|---|---|";

  if (rows.size === 0) {
    return header + "\n";
  }

  const dataRows = Array.from(rows.values())
    .map(
      (r) =>
        `| ${shortId(r.bundleId)} | ${cell(r.tipLamports)} | ${cell(r.submittedSlot)} | ${cell(r.processedSlot)} | ${cell(r.confirmedSlot)} | ${cell(r.finalizedSlot)} | ${cell(r.processedLatencyMs)} | ${cell(r.confirmedLatencyMs)} | ${cell(r.finalizedLatencyMs)} | ${cell(r.failureClassification)} | ${cell(r.agentAction)} |`
    )
    .join("\n");

  const totalBundles = rows.size;
  const landed = Array.from(rows.values()).filter((r) => r.finalizedSlot !== null).length;
  const summary = `| **Total** | | | | | | | | | | ${totalBundles} bundles / ${landed} landed / ${failedCount} failed / ${episodeIds.size} episodes |`;

  return `${header}\n${dataRows}\n${summary}\n`;
}

const isEntryPoint =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("render-markdown.ts") || process.argv[1].endsWith("render-markdown.js"));

if (isEntryPoint) {
  const LOGS_DIR = "logs";

  let inputPath: string;
  if (process.argv[2]) {
    inputPath = process.argv[2];
  } else {
    let files: string[];
    try {
      files = readdirSync(LOGS_DIR).filter(
        (f) => f.endsWith(".jsonl") && f.startsWith("lifecycle-")
      );
    } catch {
      files = [];
    }
    if (files.length === 0) {
      console.error("[render-log] No lifecycle-*.jsonl files found in logs/");
      process.exit(1);
    }
    const sorted = files
      .map((f) => ({ name: f, mtime: statSync(join(LOGS_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    inputPath = join(LOGS_DIR, sorted[0].name);
  }

  let content: string;
  try {
    content = readFileSync(inputPath, "utf8");
  } catch {
    console.error(`[render-log] Cannot read ${inputPath}`);
    process.exit(1);
  }

  const lines = content.split("\n");
  const md = renderMarkdown(lines);

  mkdirSync("evidence", { recursive: true });
  writeFileSync("evidence/lifecycle-log.md", md);
  console.log(`[render-log] Written to evidence/lifecycle-log.md (input: ${inputPath})`);
}
