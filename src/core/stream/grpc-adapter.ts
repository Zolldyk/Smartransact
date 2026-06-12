import ClientDefault, { CommitmentLevel, type SubscribeUpdate } from "@triton-one/yellowstone-grpc";
import { createSolanaRpc, type Signature } from "@solana/kit";
import type { LifecycleStream } from "./lifecycle-stream.js";
import { invertLeaderSchedule } from "./ws-adapter.js";
import { ok, fail, type Result } from "../result.js";

const LEADER_POLL_MS = 30_000;

// TypeScript 6 + NodeNext resolves the default import of this CJS package to the
// module namespace rather than the exported class constructor. Cast it explicitly.
type YellowstoneClientInstance = {
  connect(): Promise<void>;
  subscribe(): Promise<AsyncIterable<SubscribeUpdate>>;
};
const YellowstoneClient = ClientDefault as unknown as new (
  endpoint: string,
  xToken: string | undefined,
  channelOptions: undefined,
) => YellowstoneClientInstance;

export function normalizeEndpoint(endpoint: string): string {
  if (endpoint.includes("://")) return endpoint;
  return `https://${endpoint}`;
}

export class GrpcAdapter {
  private readonly rpc: ReturnType<typeof createSolanaRpc>;
  private _pollStarted = false;

  constructor(
    private readonly grpcEndpoint: string,
    private readonly grpcXToken: string | undefined,
    rpcEndpoint: string,
    private readonly stream: LifecycleStream,
    private readonly pollMs = LEADER_POLL_MS,
  ) {
    this.rpc = createSolanaRpc(rpcEndpoint);
  }

  async start(signal: AbortSignal): Promise<Result<void, { reason: string }>> {
    try {
      const client = new YellowstoneClient(normalizeEndpoint(this.grpcEndpoint), this.grpcXToken, undefined);
      await client.connect();
      const grpcStream = await client.subscribe();

      // Write slot subscription request
      (grpcStream as AsyncIterable<SubscribeUpdate> & { write(req: unknown): void }).write({
        accounts: {},
        slots: { client: { filterByCommitment: false } },
        transactions: {},
        transactionsStatus: {},
        blocks: {},
        blocksMeta: {},
        entry: {},
        accountsDataSlice: [],
        commitment: CommitmentLevel.PROCESSED,
      });

      if (!this._pollStarted) {
        this._pollStarted = true;
        void this._pollLeaderSchedule(signal);
      }

      for await (const update of grpcStream) {
        if (signal.aborted) break;
        if (update.slot) {
          this.stream.push({
            kind: "slotAdvanced",
            slot: BigInt(update.slot.slot),
            parent: update.slot.parent != null ? BigInt(update.slot.parent) : undefined,
          });
        }
      }

      if (!signal.aborted) {
        return fail({ reason: "gRPC slot stream ended unexpectedly" });
      }
      return ok(undefined);
    } catch (err) {
      return fail({ reason: err instanceof Error ? err.message : String(err) });
    }
  }

  // RPC-sourced: polls getSignatureStatuses until each commitment level is reached.
  trackSignature(signature: string, signal: AbortSignal): void {
    void this._pollSignatureStatus(signature, signal);
  }

  private async _pollSignatureStatus(signature: string, signal: AbortSignal): Promise<void> {
    const emitted = new Set<string>();
    const allCommitments = ["processed", "confirmed", "finalized"] as const;

    while (!signal.aborted && emitted.size < allCommitments.length) {
      try {
        const result = await this.rpc
          .getSignatureStatuses([signature as Signature], { searchTransactionHistory: false })
          .send();
        const status = result.value[0];
        if (status) {
          const level = status.confirmationStatus;
          const slot = BigInt(status.slot);
          if (!emitted.has("processed")) {
            emitted.add("processed");
            this.stream.push({ kind: "txStatusChanged", signature, commitment: "processed", slot, transport: "grpc" });
          }
          if ((level === "confirmed" || level === "finalized") && !emitted.has("confirmed")) {
            emitted.add("confirmed");
            this.stream.push({ kind: "txStatusChanged", signature, commitment: "confirmed", slot, transport: "grpc" });
          }
          if (level === "finalized" && !emitted.has("finalized")) {
            emitted.add("finalized");
            this.stream.push({ kind: "txStatusChanged", signature, commitment: "finalized", slot, transport: "grpc" });
          }
        }
      } catch {
        // transient error — retry on next poll
      }
      if (emitted.size < allCommitments.length) {
        await _sleep(1_000, signal);
      }
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
