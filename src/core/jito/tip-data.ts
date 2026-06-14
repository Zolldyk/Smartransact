import { createSolanaRpc, type Address } from "@solana/kit";
import { ok, fail, type Result } from "../result.js";
import { lamportsToNumber } from "../units.js";

export type LiveTipData = {
  floorPercentiles: { p25: number; p50: number; p75: number; p95: number; p99: number };
  emaP50: number;
  observedRecentTips: number[];
};

type TipFloorData = Omit<LiveTipData, "observedRecentTips">;

const LAMPORTS_PER_SOL = 1_000_000_000;

/** The Jito tip_floor API reports landed tips in **SOL** (fractional floats, e.g.
 * 0.00001). The rest of the stack — computeTip, guardrails, the bundle tip
 * transfer — is in **lamports**. Convert here so a 0.00001 SOL median becomes
 * 10_000 lamports instead of rounding to 0 and clamping every bundle to the floor. */
const solToLamports = (sol: number): number => Math.round(sol * LAMPORTS_PER_SOL);

export function parseTipFloorResponse(data: unknown): Result<TipFloorData, { reason: string }> {
  try {
    if (!Array.isArray(data) || data.length === 0) {
      return fail({ reason: "tip_floor response is not a non-empty array" });
    }
    const el = data[0] as Record<string, unknown>;
    const p25 = el["landed_tips_25th_percentile"];
    const p50 = el["landed_tips_50th_percentile"];
    const p75 = el["landed_tips_75th_percentile"];
    const p95 = el["landed_tips_95th_percentile"];
    const p99 = el["landed_tips_99th_percentile"];
    const emaP50 = el["ema_landed_tips_50th_percentile"];
    if (
      typeof p25 !== "number" || typeof p50 !== "number" || typeof p75 !== "number" ||
      typeof p95 !== "number" || typeof p99 !== "number" || typeof emaP50 !== "number"
    ) {
      return fail({ reason: "tip_floor response missing expected numeric fields" });
    }
    return ok({
      floorPercentiles: {
        p25: solToLamports(p25),
        p50: solToLamports(p50),
        p75: solToLamports(p75),
        p95: solToLamports(p95),
        p99: solToLamports(p99),
      },
      emaP50: solToLamports(emaP50),
    });
  } catch (err) {
    return fail({ reason: err instanceof Error ? err.message : String(err) });
  }
}

export async function fetchTipFloor(
  signal: AbortSignal,
): Promise<Result<TipFloorData, { reason: string }>> {
  // Reflects mainnet landed tips — now matching the evidence network after the 2026-06-12 pivot.
  try {
    const res = await fetch("https://bundles.jito.wtf/api/v1/bundles/tip_floor", { signal });
    if (!res.ok) {
      return fail({ reason: `HTTP ${res.status} from tip_floor` });
    }
    const data: unknown = await res.json();
    return parseTipFloorResponse(data);
  } catch (err) {
    return fail({ reason: err instanceof Error ? err.message : String(err) });
  }
}

export async function fetchObservedTips(
  tipAccounts: string[],
  rpc: ReturnType<typeof createSolanaRpc>,
  signal: AbortSignal,
): Promise<number[]> {
  if (tipAccounts.length === 0) return [];
  const address = tipAccounts[0] as Address;
  const tips: number[] = [];
  try {
    const sigs = await rpc
      .getSignaturesForAddress(address, { limit: 10 })
      .send();
    for (const sig of sigs) {
      if (signal.aborted) break;
      try {
        const tx = await rpc
          .getTransaction(sig.signature, {
            commitment: "finalized",
            encoding: "json",
            maxSupportedTransactionVersion: 0,
          })
          .send();
        if (!tx?.meta) continue;
        const keys = tx.transaction.message.accountKeys;
        const idx = keys.findIndex((k) => k === address);
        if (idx === -1) continue;
        const delta = (tx.meta.postBalances[idx] as bigint) - (tx.meta.preBalances[idx] as bigint);
        if (delta > 0n) {
          tips.push(lamportsToNumber(delta));
        }
      } catch {
        // transient per-tx error — skip
      }
    }
  } catch {
    // graceful degradation — per AC5, floor is the primary signal
    return [];
  }
  return tips;
}

export async function fetchLiveTipData(
  tipAccounts: string[],
  rpc: ReturnType<typeof createSolanaRpc>,
  signal: AbortSignal,
): Promise<Result<LiveTipData, { reason: string }>> {
  const [floorResult, observedRecentTips] = await Promise.all([
    fetchTipFloor(signal),
    fetchObservedTips(tipAccounts, rpc, signal),
  ]);
  if (!floorResult.ok) return floorResult;
  return ok({ ...floorResult.value, observedRecentTips });
}
