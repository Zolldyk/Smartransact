import ClientDefault from "@triton-one/yellowstone-grpc";
import type { SubscribeUpdate } from "@triton-one/yellowstone-grpc";
import * as YellowstoneGrpc from "@triton-one/yellowstone-grpc";
import { createSolanaRpc, type Signature } from "@solana/kit";
import type { LifecycleStream } from "./lifecycle-stream.js";
import { invertLeaderSchedule } from "./ws-adapter.js";
import { ok, fail, type Result } from "../result.js";

const LEADER_POLL_MS = 30_000;

// This is a CommonJS package and the runtime export shape differs by loader.
// Under tsx's ESM interop (the only runtime this project uses — tsconfig is noEmit),
// the *default* import resolves to the module-namespace OBJECT: the real Client
// constructor hangs off `.default` and enums like `CommitmentLevel` are sibling
// keys. Under plain Node ESM the default import IS the Client constructor and the
// enums arrive as named exports. A static `import { CommitmentLevel }` throws at
// instantiation under tsx, and `new ClientDefault()` throws "not a constructor"
// because the default is the namespace object — both were latent until the gRPC
// path first ran live (Story 5.6). Resolve both defensively across loaders.
const grpcDefault = ClientDefault as unknown as Record<string, unknown>;
const grpcExports: Record<string, unknown> =
  typeof ClientDefault === "function" ? (YellowstoneGrpc as unknown as Record<string, unknown>) : grpcDefault;

type YellowstoneClientInstance = {
  connect(): Promise<void>;
  subscribe(): Promise<AsyncIterable<SubscribeUpdate>>;
};
const YellowstoneClient = (typeof ClientDefault === "function"
  ? ClientDefault
  : grpcDefault.default) as unknown as new (
  endpoint: string,
  xToken: string | undefined,
  channelOptions: undefined,
) => YellowstoneClientInstance;

const CommitmentLevel = (grpcExports.CommitmentLevel ??
  grpcDefault.CommitmentLevel) as { PROCESSED: number };

export function normalizeEndpoint(endpoint: string): string {
  if (endpoint.includes("://")) return endpoint;
  return `https://${endpoint}`;
}

/**
 * The napi (Rust/tonic) gRPC client nests the real failure under `.cause`
 * (e.g. top-level "failed to open subscribe stream" wrapping the actual
 * "max concurrent streams (1) reached for your tier"). Walk the chain so the
 * deepest, most specific message reaches the operator instead of the generic top.
 */
export function describeGrpcError(err: unknown): string {
  const messages: string[] = [];
  let current: unknown = err;
  const seen = new Set<unknown>();
  while (current && !seen.has(current)) {
    seen.add(current);
    const maybeMessage = (current as { message?: unknown }).message;
    const msg = typeof maybeMessage === "string" ? maybeMessage : String(current);
    if (msg && !messages.includes(msg)) messages.push(msg);
    current = (current as { cause?: unknown }).cause;
  }
  // Deepest message is the most specific; surface it, with the top for context.
  if (messages.length === 0) return "unknown gRPC error";
  if (messages.length === 1) return messages[0]!;
  return `${messages[messages.length - 1]} (${messages[0]})`;
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
      return fail({ reason: describeGrpcError(err) });
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
