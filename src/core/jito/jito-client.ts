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
    const wait = 1_000 - (Date.now() - this._lastRequestMs);
    if (wait > 0) await this._sleep(wait, signal);
    this._lastRequestMs = Date.now();
  }

  private async _jsonRpc<T>(
    method: string,
    params: unknown[],
    signal: AbortSignal,
  ): Promise<Result<T, { reason: string }>> {
    try {
      await this._rateLimit(signal);
      const res = await fetch(`${this.blockEngineUrl}/api/v1/bundles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal,
      });
      if (!res.ok) {
        return fail({ reason: `HTTP ${res.status} from ${method}` });
      }
      const body = (await res.json()) as { result?: T; error?: { message: string } };
      if (body.error) {
        return fail({ reason: body.error.message });
      }
      return ok(body.result as T);
    } catch (err) {
      return fail({ reason: err instanceof Error ? err.message : String(err) });
    }
  }

  async sendBundle(
    transactions: string[],
    signal: AbortSignal,
  ): Promise<Result<string, { reason: string }>> {
    return this._jsonRpc<string>("sendBundle", [transactions], signal);
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
