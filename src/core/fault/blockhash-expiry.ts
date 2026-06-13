import { createSolanaRpc, type BlockhashLifetimeConstraint } from "@solana/kit";
import { MAX_PROCESSING_AGE_SLOTS } from "../protocol.js";
import type { EvidenceLog } from "../evidence/evidence-log.js";
import type { FaultInjected } from "../../schemas/evidence-event-schema.js";

/** The slot at which a blockhash fetched at `fetchedAtSlot` becomes stale —
 * one slot past the validity window. A bundle built on this blockhash at or
 * after this slot will genuinely fail submission with an expired-blockhash
 * error. Pure: no I/O. The sole site of the staleness arithmetic. */
export function becameStaleAtSlot(fetchedAtSlot: bigint): bigint {
  return fetchedAtSlot + MAX_PROCESSING_AGE_SLOTS + 1n;
}

/** Build the faultInjected evidence event. Pure — the caller appends it. */
export function faultInjectedEvent(
  staleBlockhash: string,
  fetchedAtSlot: bigint,
): FaultInjected {
  return {
    event: "faultInjected",
    at: new Date().toISOString(),
    staleBlockhash,
    fetchedAtSlot,
    becameStaleAtSlot: becameStaleAtSlot(fetchedAtSlot),
  };
}

export type StaleBlockhash = {
  /** Drops directly into buildBundle's `lifetimeConstraint` param. */
  lifetimeConstraint: BlockhashLifetimeConstraint;
  fetchedAtSlot: bigint;
  becameStaleAtSlot: bigint;
};

const DEFAULT_POLL_MS = 1_000;

export async function injectBlockhashExpiry(
  rpc: ReturnType<typeof createSolanaRpc>,
  evidenceLog: EvidenceLog,
  signal: AbortSignal,
  pollMs = DEFAULT_POLL_MS,
): Promise<StaleBlockhash> {
  const fetchedAtSlot = await rpc.getSlot().send();
  const { blockhash, lastValidBlockHeight } = (
    await rpc.getLatestBlockhash().send()
  ).value;
  const staleSlot = becameStaleAtSlot(fetchedAtSlot);

  // Wait for the chain to advance past the validity window. After this loop
  // the blockhash is genuinely expired on-chain — submitting a bundle built
  // on it will produce a real expired-blockhash failure (no faked state).
  while (!signal.aborted) {
    const current = await rpc.getSlot().send();
    if (current >= staleSlot) break;
    await _sleep(pollMs, signal);
  }

  evidenceLog.append(faultInjectedEvent(blockhash, fetchedAtSlot));

  return {
    lifetimeConstraint: { blockhash, lastValidBlockHeight },
    fetchedAtSlot,
    becameStaleAtSlot: staleSlot,
  };
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
