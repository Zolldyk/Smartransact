import {
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  type Signature,
} from "@solana/kit";
import type { LifecycleStream } from "./lifecycle-stream.js";
import { ok, fail, type Result } from "../result.js";

export type WsAdapterFailure = { reason: string };

const LEADER_POLL_MS = 30_000;

export function invertLeaderSchedule(
  raw: Record<string, readonly bigint[]>,
  epochStartSlot: bigint,
): Map<bigint, string> {
  const schedule = new Map<bigint, string>();
  for (const [validator, indices] of Object.entries(raw)) {
    for (const index of indices) {
      schedule.set(epochStartSlot + index, validator);
    }
  }
  return schedule;
}

export class RpcWebSocketAdapter {
  private readonly rpc: ReturnType<typeof createSolanaRpc>;
  private readonly rpcSubscriptions: ReturnType<typeof createSolanaRpcSubscriptions>;
  private _pollStarted = false;

  constructor(
    rpcEndpoint: string,
    wsEndpoint: string,
    private readonly stream: LifecycleStream,
    private readonly pollMs = LEADER_POLL_MS,
  ) {
    this.rpc = createSolanaRpc(rpcEndpoint);
    this.rpcSubscriptions = createSolanaRpcSubscriptions(wsEndpoint);
  }

  async start(signal: AbortSignal): Promise<Result<void, WsAdapterFailure>> {
    try {
      const slotIter = await this.rpcSubscriptions
        .slotNotifications()
        .subscribe({ abortSignal: signal });

      // Launch the leader-schedule poll loop once per adapter. withReconnect
      // re-invokes start() on every reconnect; without this guard each call
      // would spawn another concurrent poll loop (leaked RPC traffic).
      if (!this._pollStarted) {
        this._pollStarted = true;
        void this._pollLeaderSchedule(signal);
      }

      for await (const notification of slotIter) {
        this.stream.push({
          kind: "slotAdvanced",
          slot: notification.slot,
          parent: notification.parent,
        });
      }
      // The slot loop exited. If the session was not aborted, the subscription
      // ended unexpectedly (e.g. a server-side close) — surface it as a failure
      // so withReconnect retries instead of treating it as a clean session end.
      if (!signal.aborted) {
        return fail({ reason: "slot subscription ended unexpectedly" });
      }
      return ok(undefined);
    } catch (err) {
      return fail({ reason: err instanceof Error ? err.message : String(err) });
    }
  }

  trackSignature(signature: string, signal: AbortSignal): void {
    for (const commitment of ["processed", "confirmed", "finalized"] as const) {
      void this._subscribeSignature(signature, commitment, signal);
    }
  }

  private async _subscribeSignature(
    signature: string,
    commitment: "processed" | "confirmed" | "finalized",
    signal: AbortSignal,
  ): Promise<void> {
    try {
      const iter = await this.rpcSubscriptions
        .signatureNotifications(signature as Signature, {
          commitment,
          enableReceivedNotification: false,
        })
        .subscribe({ abortSignal: signal });

      for await (const notification of iter) {
        this.stream.push({
          kind: "txStatusChanged",
          signature,
          commitment,
          slot: notification.context.slot,
          transport: "ws",
        });
        break;
      }
    } catch {
      // Abort (expected), subscription closed before notification, or network drop.
      // Real subscription failures are NOT swallowed by intent — they are detected
      // indirectly: if a bundle never advances past a given stage, the orchestrator
      // (Story 5.1) classifies it bundle_failure via a stale-bundle timeout.
      // The adapter has no EvidenceLog access; surfacing errors here would require
      // injecting EvidenceLog into a stateless transport layer (violates the adapter
      // boundary). Design decision recorded here, implementation in Story 5.1.
    }
  }

  private async _pollLeaderSchedule(signal: AbortSignal): Promise<void> {
    let lastEpoch: bigint | undefined;

    while (!signal.aborted) {
      try {
        const epochInfo = await this.rpc.getEpochInfo().send();

        if (epochInfo.epoch !== lastEpoch) {
          const epochStartSlot = epochInfo.absoluteSlot - epochInfo.slotIndex;
          const raw = await this.rpc.getLeaderSchedule(null).send();
          if (raw !== null) {
            const schedule = invertLeaderSchedule(
              raw as Record<string, bigint[]>,
              epochStartSlot,
            );
            this.stream.push({
              kind: "leaderScheduleUpdated",
              schedule,
              at: new Date().toISOString(),
            });
            lastEpoch = epochInfo.epoch;
          }
        }
      } catch {
        // transient fetch error — retry on next poll
      }
      await _sleep(this.pollMs, signal);
    }
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
