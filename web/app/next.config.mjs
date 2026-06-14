import path from "node:path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Isolated frontend workspace (see story 8.2 › "Why a nested web/app/ workspace").
  // The backend lives at the repo root with its own NodeNext toolchain; nothing
  // here leaks into the root tsc/vitest.
  reactStrictMode: true,
  // Pin the trace root to THIS workspace so Next does not infer the repo root
  // (the backend has its own lockfile) — silences the multi-lockfile warning.
  outputFileTracingRoot: path.resolve(import.meta.dirname),
};

export default nextConfig;
