import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // src/ is the primary tree; web/server/ (Story 8.1) carries the backend
    // safety unit tests (e.g. dryRun/keypair override guards) — co-located too.
    include: ["src/**/*.test.ts", "web/**/*.test.ts"],
    passWithNoTests: true,
  },
});
