import { ok, fail, type Result } from "../result.js";

export type BundleStatus = {
  bundleId: string;
  transactions: string[];
  slot: number;
  confirmationStatus: "processed" | "confirmed" | "finalized";
  err: null | { ok: false; error: { err: unknown } };
};

export type InflightBundleStatus = {
  bundleId: string;
  status: "invalid" | "pending" | "failed" | "landed" | "windup";
  landed_slot: number | null;
};

export class JitoClient {
  private _lastRequestMs = 0;

  constructor(private readonly blockEngineUrl: string) {}

  private _sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      signal.addEventListener("abort", () => { clearTimeout(t); reject(signal.reason); }, { once: true });
    });
  }

  private async _rateLimit(signal: AbortSignal): Promise<void> {
    const now = Date.now();
    const wait = 1_000 - (now - this._lastRequestMs);
    // Reserve this request's slot synchronously (before any await) so concurrent
    // callers serialize ≥1 s apart instead of all reading the same stale timestamp
    // and firing together — the ≥1 req/s contract (Story 3.4 AC2) must hold under
    // concurrency, not just sequential use.
    this._lastRequestMs = wait > 0 ? now + wait : now;
    if (wait > 0) await this._sleep(wait, signal);
  }

  // Jito's public block engine rate-limits aggressively; a single 429 must not
  // sink the whole session. Retry 429/503 with exponential backoff + jitter.
  // A 429 means the request was rejected before processing, so retrying sendBundle
  // is safe (no risk of double-submission).
  private static readonly MAX_RETRIES = 5;

  private async _jsonRpc<T>(
    method: string,
    params: unknown[],
    signal: AbortSignal,
  ): Promise<Result<T, { reason: string }>> {
    for (let attempt = 0; attempt < JitoClient.MAX_RETRIES; attempt++) {
      try {
        await this._rateLimit(signal);
        const res = await fetch(`${this.blockEngineUrl}/api/v1/bundles`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          signal,
        });
        if ((res.status === 429 || res.status === 503) && attempt < JitoClient.MAX_RETRIES - 1) {
          const backoff = Math.min(1_000 * 2 ** attempt, 8_000) + Math.floor(Math.random() * 250);
          await this._sleep(backoff, signal);
          continue;
        }
        if (!res.ok) {
          return fail({ reason: `HTTP ${res.status} from ${method}` });
        }
        const body = (await res.json()) as { result?: T; error?: { message: string } };
        if (body.error) {
          return fail({ reason: body.error.message });
        }
        return ok(body.result as T);
      } catch (err) {
        if (signal.aborted) return fail({ reason: err instanceof Error ? err.message : String(err) });
        return fail({ reason: err instanceof Error ? err.message : String(err) });
      }
    }
    return fail({ reason: `HTTP 429 from ${method} (exhausted retries)` });
  }

  async sendBundle(
    transactions: string[],
    signal: AbortSignal,
  ): Promise<Result<string, { reason: string }>> {
    // bundle-builder.ts emits base64 wire transactions; Jito defaults to base58
    // and rejects with HTTP 400 unless the encoding is declared explicitly.
    return this._jsonRpc<string>("sendBundle", [transactions, { encoding: "base64" }], signal);
  }

  async getBundleStatuses(
    bundleIds: string[],
    signal: AbortSignal,
  ): Promise<Result<BundleStatus[], { reason: string }>> {
    return this._jsonRpc<BundleStatus[]>("getBundleStatuses", [bundleIds], signal);
  }

  async getTipAccounts(
    signal: AbortSignal,
  ): Promise<Result<string[], { reason: string }>> {
    return this._jsonRpc<string[]>("getTipAccounts", [], signal);
  }

  async getInflightBundleStatuses(
    bundleIds: string[],
    signal: AbortSignal,
  ): Promise<Result<InflightBundleStatus[], { reason: string }>> {
    return this._jsonRpc<InflightBundleStatus[]>("getInflightBundleStatuses", [bundleIds], signal);
  }
}
