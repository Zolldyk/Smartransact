#!/usr/bin/env node
// Global CLI entry for `smartransact`.
// The project runs uncompiled TypeScript via tsx (tsconfig is noEmit), so this
// wrapper spawns the project-local tsx binary on src/cli/main.ts and forwards
// all args. The entry path resolves relative to this package, but the CLI reads
// .env / smartransact.config.json from the current working directory — so run it
// from the project root.
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, "../src/cli/main.ts");
const tsx = resolve(here, "../node_modules/.bin/tsx");

const result = spawnSync(tsx, [entry, ...process.argv.slice(2)], {
  stdio: "inherit",
});

if (result.error) {
  console.error(`[smartransact] failed to launch: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
