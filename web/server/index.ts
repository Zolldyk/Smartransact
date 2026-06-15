// web/server/index.ts
//
// Public web-app streaming backend (Story 8.1). A thin, always-on Node process
// that runs the EXISTING `runSession` keystone and forwards every persisted
// evidence event to a connected browser over WebSocket. It is a SIBLING
// front-end to the CLI over the same orchestrator — "two processes, one core."
// No core behavior is changed; this server only consumes the two optional,
// backward-compatible seams added in this story (`onEvidence`, `signal`).
//
// Safety model (NFR9 / FR43), all enforced server-side:
//   - Every session is dryRun (forced in session-config.ts) — no SOL ever.
//   - The funded payer is never loaded; KEYPAIR_PATH is pointed at an ephemeral
//     non-funded key before loadConfig runs (sandbox-keypair.ts).
//   - Private creds (SolInfra RPC key, default LLM key) are server-env only and
//     never sent to the client. BYO LLM keys arrive per-request, live in memory
//     for the session, and are never logged or persisted.
//   - Sessions are rate-limited (HTTP) + max-concurrent-bounded + time-boxed.

import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { WebSocketServer, type WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import { loadConfig } from "../../src/config.js";
import { runSession } from "../../src/core/orchestrator.js";
import { writeEphemeralSandboxKeypair } from "./sandbox-keypair.js";
import { buildSessionConfig, ClientOverridesSchema } from "./session-config.js";
import { serializeEvidence } from "./serialize.js";

// ─── Tunables (named constants — no bare literals) ──────────────────────────
const PORT = Number(process.env["PORT"] ?? process.env["WEB_SERVER_PORT"] ?? 8787);
const HOST = "0.0.0.0";
const WS_PATH = "/ws";
const SANDBOX_PROFILE = "mainnet-ws"; // credential-free WSS slots (NOT gRPC)
const SESSION_TIMEOUT_MS = 90_000; // hard time-box per anonymous session
const MAX_CONCURRENT_SESSIONS = 3; // bounds long-lived streams
const HTTP_RATE_MAX = 30; // requests / window / IP (HTTP surface)
const HTTP_RATE_WINDOW = "1 minute";
const WS_PER_IP_COOLDOWN_MS = 2_000; // min gap between WS connects per IP

// Load server-side env (SolInfra RPC key, default LLM key) — same mechanism as
// the CLI (src/cli/run.ts). These secrets stay server-side and never reach the
// browser (AC7). Optional: production may inject env directly.
try {
  process.loadEnvFile(".env");
} catch {
  // .env optional
}

// ─── Startup: ephemeral non-funded key + base config (loaded ONCE) ──────────
// AC6: generate the sandbox key first, then force KEYPAIR_PATH to it BEFORE
// loadConfig — so the funded payer is never referenced by this process.
const sandboxKeypairPath = writeEphemeralSandboxKeypair();
process.env["KEYPAIR_PATH"] = sandboxKeypairPath;

// loadConfig calls process.exit(1) on missing env — acceptable at boot only
// (fail fast). It is NEVER called per-request; client overrides are validated
// with zod and merged onto this base.
const baseConfig = loadConfig(SANDBOX_PROFILE);

// ─── Session accounting ─────────────────────────────────────────────────────
let activeSessions = 0;
const lastConnectByIp = new Map<string, number>();

/** ws.send that can never throw out of the evidence callback (Dev Notes AC1). */
function safeSend(ws: WebSocket, data: string): void {
  try {
    if (ws.readyState === ws.OPEN) ws.send(data);
  } catch {
    // Subscriber-side failure is non-fatal to the session; swallow.
  }
}

function clientIp(req: IncomingMessage): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) return fwd.split(",")[0]!.trim();
  return req.socket.remoteAddress ?? "unknown";
}

// ─── WebSocket session handling ─────────────────────────────────────────────
const wss = new WebSocketServer({ noServer: true });

wss.on("connection", (ws: WebSocket) => {
  activeSessions++;
  let released = false;
  const release = (): void => {
    if (!released) {
      released = true;
      activeSessions--;
    }
  };

  const ac = new AbortController();
  const timeBox = setTimeout(() => {
    if (!ac.signal.aborted) ac.abort();
    if (ws.readyState === ws.OPEN) ws.close();
  }, SESSION_TIMEOUT_MS);

  // Client disconnect → tear the session down (AC3 external-cancel path).
  ws.on("close", () => {
    clearTimeout(timeBox);
    if (!ac.signal.aborted) ac.abort();
    release();
  });
  ws.on("error", () => {
    if (!ac.signal.aborted) ac.abort();
  });

  let started = false;
  ws.once("message", async (raw: Buffer) => {
    if (started) return;
    started = true;

    // zod-at-boundary: validate the client's session options. Never log `raw`
    // or the parsed object — it may carry a BYO LLM apiKey.
    let overrides;
    try {
      overrides = ClientOverridesSchema.parse(JSON.parse(raw.toString()));
    } catch {
      safeSend(ws, JSON.stringify({ error: "invalid session options" }));
      if (ws.readyState === ws.OPEN) ws.close();
      return;
    }

    const config = buildSessionConfig(baseConfig, sandboxKeypairPath, overrides);

    try {
      await runSession({
        config,
        profile: SANDBOX_PROFILE,
        // The evidence tap: stream exactly what is persisted to JSONL, bigints
        // as JSON numbers (serialize.ts). The bare EvidenceEvent is the WS
        // contract — no wrapper envelope (evidence integrity for the frontend).
        onEvidence: (event) => safeSend(ws, serializeEvidence(event)),
        signal: ac.signal,
      });
    } catch {
      // runSession resolves on internal errors; this is a backstop only.
      safeSend(ws, JSON.stringify({ error: "session error" }));
    } finally {
      clearTimeout(timeBox);
      if (ws.readyState === ws.OPEN) ws.close(); // → fires "close" → release()
    }
  });
});

// ─── Fastify HTTP surface + WS upgrade ──────────────────────────────────────
async function main(): Promise<void> {
  const fastify = Fastify({ logger: true });

  // Per-IP HTTP rate-limit (bounds the HTTP surface; WS abuse is additionally
  // bounded by the max-concurrent guard + per-IP cooldown + time-box below).
  await fastify.register(rateLimit, { max: HTTP_RATE_MAX, timeWindow: HTTP_RATE_WINDOW });

  fastify.get("/health", async () => ({ ok: true, activeSessions }));

  // Manual WS upgrade so we can apply the concurrency + per-IP guards that the
  // HTTP rate-limit plugin does not cover for raw WebSocket upgrades.
  fastify.server.on("upgrade", (req, socket, head) => {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (pathname !== WS_PATH) {
      socket.destroy();
      return;
    }

    if (activeSessions >= MAX_CONCURRENT_SESSIONS) {
      socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n");
      socket.destroy();
      return;
    }

    const ip = clientIp(req);
    const now = Date.now();
    const last = lastConnectByIp.get(ip) ?? 0;
    if (now - last < WS_PER_IP_COOLDOWN_MS) {
      socket.write("HTTP/1.1 429 Too Many Requests\r\n\r\n");
      socket.destroy();
      return;
    }
    lastConnectByIp.set(ip, now);
    // Opportunistic prune so the map cannot grow unbounded.
    if (lastConnectByIp.size > 1000) {
      for (const [k, t] of lastConnectByIp) {
        if (now - t > WS_PER_IP_COOLDOWN_MS) lastConnectByIp.delete(k);
      }
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  await fastify.listen({ port: PORT, host: HOST });
  fastify.log.info(`web/server ready — ws ${WS_PATH}, sandbox profile "${SANDBOX_PROFILE}", dryRun forced`);
}

main().catch((err) => {
  console.error("[web/server] fatal startup error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
