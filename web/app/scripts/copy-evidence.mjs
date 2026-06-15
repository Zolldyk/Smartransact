// web/app/scripts/copy-evidence.mjs
//
// Build step (predev / prebuild): copy the committed mainnet evidence run from
// the repo root into web/app/public so /live can fetch it as a static asset
// (/lifecycle-run.jsonl). Single source of truth stays evidence/lifecycle-log.jsonl
// — the public copy is GENERATED (gitignored). When Story 5.9 regenerates the log
// with a confirmed landing, the replay auto-refreshes on the next build.
//
// Cross-platform (Node fs, no shell). Fails SOFT: if the source is missing we
// write a tiny honest placeholder rather than break the build — the renderer
// already handles a sparse/empty stream (AC8).

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// web/app/scripts → repo root is three levels up.
const repoRoot = resolve(here, "..", "..", "..");
const src = resolve(repoRoot, "evidence", "lifecycle-log.jsonl");
const destDir = resolve(here, "..", "public");
const dest = resolve(destDir, "lifecycle-run.jsonl");

mkdirSync(destDir, { recursive: true });

if (existsSync(src)) {
  copyFileSync(src, dest);
  console.log(`[copy-evidence] ${src} → ${dest}`);
} else {
  // Honest placeholder: a clean dryRun stream (sessionStarted → sessionEnded).
  const at = new Date().toISOString();
  const placeholder =
    JSON.stringify({ event: "sessionStarted", at, sessionId: "placeholder", profile: "mainnet-ws", adapter: "ws" }) +
    "\n" +
    JSON.stringify({ event: "sessionEnded", at, sessionId: "placeholder", reason: "no committed run available" }) +
    "\n";
  writeFileSync(dest, placeholder);
  console.warn(`[copy-evidence] source missing (${src}); wrote placeholder → ${dest}`);
}
