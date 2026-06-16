/*
 * JITO LEADER IDENTIFICATION SPIKE — completed 2026-06-12
 *
 * CHOSEN PATH: Empirical fallback (primary). getNextScheduledLeader is part of the Jito
 * Searcher gRPC service (requires an approved Jito keypair + gRPC connection) — it is NOT
 * exposed via the Block Engine's HTTP JSON-RPC API. Both HTTP URL forms were tried and
 * failed (see below). The empirical fallback is therefore the primary path for Story 3.3,
 * with the gRPC searcher path available as a future enhancement if auth is provisioned.
 *
 * WHY empirical fallback over full-schedule filtering:
 *   Solana's getLeaderSchedule RPC lists ALL validators with no flag distinguishing
 *   Jito-Solana from stock Agave nodes. Maintaining an allowlist of Jito-Solana pubkeys
 *   is operationally brittle — the validator set changes over time. The Block Engine's
 *   architectural guarantee is stronger: it forwards bundles exclusively to Jito-Solana
 *   leaders, so any landed bundle self-certifies its slot as a Jito leader window.
 *
 * --- ATTEMPTED PRIMARY PATH: getNextScheduledLeader (HTTP JSON-RPC) ---
 *
 * Verified 2026-06-12 against https://frankfurt.mainnet.block-engine.jito.wtf:
 *
 * Option A — POST https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/bundles
 *   Body: {"jsonrpc":"2.0","id":1,"method":"getNextScheduledLeader","params":[]}
 *   Response: {"jsonrpc":"2.0","error":{"code":-32601,"message":"Invalid method","data":null},"id":1}
 *
 * Option B — POST https://frankfurt.mainnet.block-engine.jito.wtf/ (root path)
 *   Body: {"jsonrpc":"2.0","id":1,"method":"getNextScheduledLeader","params":[]}
 *   Response: HTTP 404 (empty body)
 *
 * Root cause: getNextScheduledLeader lives in the Jito Searcher gRPC service (searcher.proto).
 * The HTTP JSON-RPC at /api/v1/bundles only exposes: sendBundle, getBundleStatuses,
 * getTipAccounts, getInflightBundleStatuses. Calling it via fetch/curl is not possible
 * without gRPC transport and a Jito-approved keypair auth token.
 *
 * Update cadence (from Jito docs — not directly observed, method inaccessible without auth):
 *   Jito validators receive 4 consecutive slots (~1.6 s at 400 ms/slot). getNextScheduledLeader
 *   would return a stable nextLeaderSlot for ~4 slots before advancing by ≥4 slots.
 *
 * --- EMPIRICAL FALLBACK (PRIMARY PATH FOR STORY 3.3) ---
 *
 * Source: docs/jito-documentation.md §8 Tips:
 *   "Tips only matter for Jito-Solana leaders — tipping a non-Jito leader wastes money."
 * The Block Engine is the sole entry point for bundle submissions. It buffers bundles and
 * forwards them exclusively to the upcoming Jito-Solana leader. Non-Jito validator nodes
 * never receive bundles from the Block Engine.
 *
 * Therefore: any bundle that lands on-chain landed during a Jito-Solana leader's slot.
 * The slot recorded in the evidence log (bundleSubmitted.slot) cross-checks against a public
 * explorer — the block's validator identity will be a known Jito-Solana validator.
 * This satisfies FR8 post-hoc: the landed-bundle's slot IS the Jito leader window proof.
 * FR8 done-condition: a landed bundle's slot falls within the leader window identified for a
 * Jito-Solana validator, cross-checkable via the lifecycle log and a public explorer.
 *
 * --- FOR STORY 3.3: getNextJitoLeaderWindow() ---
 *
 * Implement as an additive async method on LeaderWindow (do NOT change existing methods):
 *
 *   async getNextJitoLeaderWindow(): Promise<{ startSlot: bigint; endSlot: bigint }>
 *
 * Implementation (empirical-primary):
 *   - Return the 4-slot window starting at this._currentSlot + 1n.
 *     { startSlot: this._currentSlot + 1n, endSlot: this._currentSlot + 4n }
 *   - Jito leaders receive 4 consecutive slots (indices 0–3); the window is [start, end] inclusive.
 *   - No network call required. Accuracy is confirmed post-hoc when the bundle lands on-chain
 *     (Block Engine guarantee makes this equivalent to predictive detection for our use case).
 *
 * gRPC searcher path (future enhancement, not required for Story 3.3):
 *   If a Jito-approved keypair is provisioned, inject a SearcherClient (jito-ts) and call
 *   getNextScheduledLeader() to get { currentSlot, nextLeaderSlot, nextLeaderIdentity }.
 *   Return { startSlot: BigInt(nextLeaderSlot), endSlot: BigInt(nextLeaderSlot) + 3n }.
 *   Fall back to the empirical path on any error.
 */
import type { StreamEvent } from "../../schemas/stream-event-schema.js";
import type { Result } from "../result.js";

/** Narrow contract the LeaderWindow depends on for searcher-confirmed windows
 * (Story 5.8). Declared structurally so the pure leader module NEVER imports
 * jito-ts — SearcherClient satisfies it; tests inject a fake. `signal` is
 * optional so the existing no-arg `getNextJitoLeaderWindow()` call sites stay
 * unchanged (AC3). */
export interface LeaderSearcher {
  getNextScheduledLeader(
    signal?: AbortSignal,
  ): Promise<Result<{ currentSlot: bigint; nextLeaderSlot: bigint }, { reason: string }>>;
}

// A Jito leader holds 4 consecutive slots; refresh the searcher window at most
// once per window (CD-2 budget safety — the agent re-queries this 3-4× per episode,
// back-to-back, and must NOT blow the 2 req/s searcher budget).
const SEARCHER_CACHE_TTL_SLOTS = 4n;

export class LeaderWindow {
  private _currentSlot: bigint = 0n;
  private _schedule: Map<bigint, string> = new Map();

  // ── Searcher-mode state (Story 5.8) — inert when no searcher is injected. ──
  private readonly _searcher?: LeaderSearcher;
  private _cachedWindow?: { startSlot: bigint; endSlot: bigint };
  private _cachedAtSlot: bigint = 0n;

  /** Pass a searcher to enable confirmed-leader targeting (operator searcher
   * mode). Omit it (existing call sites) to keep the empirical +1n/+4n guess. */
  constructor(searcher?: LeaderSearcher) {
    this._searcher = searcher;
  }

  consume(event: StreamEvent): void {
    if (event.kind === "slotAdvanced") {
      this._currentSlot = event.slot;
    } else if (event.kind === "leaderScheduleUpdated") {
      this._schedule = event.schedule;
    }
  }

  getCurrentSlot(): bigint {
    return this._currentSlot;
  }

  getLeaderSchedule(): Map<bigint, string> {
    return this._schedule;
  }

  /** The 4-slot window to aim the next bundle at. No searcher → the empirical
   * `currentSlot+1..+4` guess (unchanged — AC3). With a searcher → the cached
   * window derived from `getNextScheduledLeader()`, refreshed from the wire only
   * when stale (CD-2). On a searcher error, falls back to the empirical guess
   * for that call (never throws out of an observation build). */
  async getNextJitoLeaderWindow(): Promise<{ startSlot: bigint; endSlot: bigint }> {
    if (this._searcher === undefined) {
      return this._empiricalWindow();
    }

    const stale =
      this._cachedWindow === undefined ||
      this._currentSlot - this._cachedAtSlot >= SEARCHER_CACHE_TTL_SLOTS ||
      this._cachedWindow.endSlot < this._currentSlot;

    if (stale) {
      const res = await this._searcher.getNextScheduledLeader();
      if (res.ok) {
        this._cachedWindow = {
          startSlot: res.value.nextLeaderSlot,
          endSlot: res.value.nextLeaderSlot + 3n,
        };
        this._cachedAtSlot = this._currentSlot;
      } else {
        // Surface the reason, but keep the session alive on the empirical path.
        console.error(
          `[leader-window] searcher getNextScheduledLeader failed: ${res.failure.reason}; using empirical guess`,
        );
        return this._empiricalWindow();
      }
    }

    return this._cachedWindow!;
  }

  private _empiricalWindow(): { startSlot: bigint; endSlot: bigint } {
    return { startSlot: this._currentSlot + 1n, endSlot: this._currentSlot + 4n };
  }
}
