// src/core/jito/searcher-client.ts
//
// The ONLY consumer of jito-ts / @solana/web3.js in src/. Wraps the authenticated
// Jito Searcher gRPC client (Story 5.8) behind our own Result type. Used only in
// "searcher mode" (an operator profile that sets both jitoSearcherUrl and
// JITO_AUTH_KEYPAIR_PATH); the hand-rolled JitoClient stays the path for every
// other profile (CD-1). The empirically-verified probe (scripts/jito-searcher-probe.ts)
// is the ground-truth reference this productionises.
//
// AC5 — Frankfurt endpoint + 2 req/s pacing: getTipAccounts + getNextScheduledLeader
// + sendBundle ALL share a single 500 ms rate limiter (the 2 req/s budget covers every
// searcher call). onBundleResult is deliberately NOT subscribed — it shares the budget
// and tripped 8 RESOURCE_EXHAUSTED in the probe; commitment is polled via the existing
// stream / trackSignature path.
import { readFileSync } from "node:fs";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { searcherClient as makeSearcherClient } from "jito-ts/dist/sdk/block-engine/searcher.js";
import { Bundle } from "jito-ts/dist/sdk/block-engine/types.js";
import { ok, fail, type Result } from "../result.js";
import { JITO_MAX_BUNDLE_TXS } from "../protocol.js";

/** jito-ts's own Result shape (`{ ok, value } | { ok, error }`) — distinct from
 * ours (`{ ok, value } | { ok, failure }`). Mapped at every boundary below. */
type JitoResult<T> = { ok: true; value: T } | { ok: false; error: unknown };

/** The narrow slice of the jito-ts SearcherClient we depend on. Declaring it as
 * an interface lets the unit tests inject a fake (no network — repo convention). */
export interface JitoSearcherTransport {
  getTipAccounts(): Promise<JitoResult<string[]>>;
  getNextScheduledLeader(): Promise<
    JitoResult<{ currentSlot: number; nextLeaderSlot: number; nextLeaderIdentity: string }>
  >;
  sendBundle(bundle: Bundle): Promise<JitoResult<string>>;
}

/** Pure impedance match (exported for unit tests). bundle-builder.ts emits base64
 * wire transactions with the agent's tip ALREADY integrated (FR18); jito-ts wants a
 * Bundle of @solana/web3.js VersionedTransactions. Deserialize and wrap — never
 * addTipTx (that would double-tip), never re-encode. */
export function buildSearcherBundle(base64Txs: string[]): Bundle {
  const vtxs = base64Txs.map((b) => VersionedTransaction.deserialize(Buffer.from(b, "base64")));
  return new Bundle(vtxs, JITO_MAX_BUNDLE_TXS);
}

function reasonOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/** 2 req/s budget → ≥500 ms between ANY two searcher calls (vs JitoClient's 1000 ms). */
const MIN_REQUEST_INTERVAL_MS = 500;

export class SearcherClient {
  private _lastRequestMs = 0;
  private readonly _transport: JitoSearcherTransport;

  /** `transportOverride` is the test seam (inject a fake — no network). In
   * production it is omitted: the fund-less auth keypair is loaded from
   * `authKeypairPath` and a real Frankfurt searcher client is built. */
  constructor(endpoint: string, authKeypairPath: string, transportOverride?: JitoSearcherTransport) {
    if (transportOverride !== undefined) {
      this._transport = transportOverride;
    } else {
      const auth = Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(readFileSync(authKeypairPath, "utf8")) as number[]),
      );
      // host only, no scheme (per the verified probe).
      this._transport = makeSearcherClient(endpoint, auth) as unknown as JitoSearcherTransport;
    }
  }

  private _sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      signal?.addEventListener("abort", () => { clearTimeout(t); reject(signal.reason); }, { once: true });
    });
  }

  // Reserve this request's slot synchronously (before any await) so concurrent
  // callers serialize ≥500 ms apart instead of all reading the same stale timestamp
  // and firing together — the 2 req/s contract (AC5) must hold under concurrency.
  private async _rateLimit(signal?: AbortSignal): Promise<void> {
    const now = Date.now();
    const wait = MIN_REQUEST_INTERVAL_MS - (now - this._lastRequestMs);
    this._lastRequestMs = wait > 0 ? now + wait : now;
    if (wait > 0) await this._sleep(wait, signal);
  }

  async getTipAccounts(signal?: AbortSignal): Promise<Result<string[], { reason: string }>> {
    try {
      // Inside the try (like JitoClient): an abort during the rate-limit wait
      // resolves to fail({reason}), never an unhandled rejection.
      await this._rateLimit(signal);
      const res = await this._transport.getTipAccounts();
      return res.ok ? ok(res.value) : fail({ reason: reasonOf(res.error) });
    } catch (err) {
      return fail({ reason: err instanceof Error ? err.message : String(err) });
    }
  }

  async getNextScheduledLeader(
    signal?: AbortSignal,
  ): Promise<Result<{ currentSlot: bigint; nextLeaderSlot: bigint }, { reason: string }>> {
    try {
      await this._rateLimit(signal);
      const res = await this._transport.getNextScheduledLeader();
      return res.ok
        ? ok({ currentSlot: BigInt(res.value.currentSlot), nextLeaderSlot: BigInt(res.value.nextLeaderSlot) })
        : fail({ reason: reasonOf(res.error) });
    } catch (err) {
      return fail({ reason: err instanceof Error ? err.message : String(err) });
    }
  }

  /** Same input shape as JitoClient.sendBundle (base64 wire txs); routes through the
   * authenticated searcher transport instead of the public HTTP block engine (CD-1). */
  async sendBundle(base64Txs: string[], signal?: AbortSignal): Promise<Result<string, { reason: string }>> {
    try {
      await this._rateLimit(signal);
      const bundle = buildSearcherBundle(base64Txs);
      const res = await this._transport.sendBundle(bundle);
      return res.ok ? ok(res.value) : fail({ reason: reasonOf(res.error) });
    } catch (err) {
      return fail({ reason: err instanceof Error ? err.message : String(err) });
    }
  }
}
