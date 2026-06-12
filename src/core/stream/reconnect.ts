import type { RpcWebSocketAdapter } from "./ws-adapter.js";
import type { LifecycleStream } from "./lifecycle-stream.js";
import type { EvidenceLog } from "../evidence/evidence-log.js";

export type ReconnectPolicy = {
  initialDelayMs: number;
  maxDelayMs: number;
};

export const DEFAULT_RECONNECT_POLICY: ReconnectPolicy = {
  initialDelayMs: 500,
  maxDelayMs: 30_000,
};

/**
 * Pure backoff computation. `rand` defaults to Math.random; inject for tests.
 * base = min(initialDelayMs * 2^attempt, maxDelayMs)
 * jitter = floor(rand() * base * 0.25)  — adds 0–25% of base
 * result = base + jitter
 */
export function computeBackoffDelay(
  attempt: number,
  policy: ReconnectPolicy,
  rand: () => number = Math.random,
): number {
  const base = Math.min(policy.initialDelayMs * (2 ** attempt), policy.maxDelayMs);
  const jitter = Math.floor(rand() * base * 0.25);
  return base + jitter;
}

/**
 * Wraps adapter.start() with reconnect-on-failure logic.
 * Exits when signal is aborted or start() returns ok (clean session end).
 * On connection failure: sleeps the computed backoff delay, then pushes
 * streamReconnected to the stream and evidence log before retrying.
 */
export async function withReconnect(
  adapter: RpcWebSocketAdapter,
  stream: LifecycleStream,
  evidenceLog: EvidenceLog,
  policy: ReconnectPolicy,
  signal: AbortSignal,
): Promise<void> {
  let attempt = 0;
  while (!signal.aborted) {
    const result = await adapter.start(signal);
    if (signal.aborted || result.ok) break;
    const delayMs = computeBackoffDelay(attempt, policy);
    await _sleep(delayMs, signal);
    if (signal.aborted) break;
    stream.push({ kind: "streamReconnected", at: new Date().toISOString(), attempt });
    evidenceLog.append({
      event: "streamReconnected",
      at: new Date().toISOString(),
      attempt,
      delayMs,
    });
    attempt++;
  }
}

function _sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => { clearTimeout(timer); resolve(); },
      { once: true },
    );
  });
}
