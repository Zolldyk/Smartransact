import { defineConfig } from "vitest/config";

// Scopes the frontend test run to web/app's own pure unit tests (the overrides
// mapper) so it never reaches up into the root backend vitest config. Keeps the
// two toolchains isolated (story 8.2 › "Why a nested web/app/ workspace").
export default defineConfig({
  test: {
    root: __dirname,
    include: ["lib/**/*.test.ts"],
    environment: "node",
  },
});
