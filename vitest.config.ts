import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // src/ is the primary tree; web/server/ (Story 8.1) carries the backend
    // safety unit tests (e.g. dryRun/keypair override guards) — co-located too.
    // web/app/ (the Story 8.2 frontend) is a SEPARATE workspace with its own
    // vitest — deliberately excluded here to keep the root suite backend-pure.
    include: ["src/**/*.test.ts", "web/server/**/*.test.ts"],
    passWithNoTests: true,
  },
});
