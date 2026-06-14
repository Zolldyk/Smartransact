// src/core/orchestrator.ts
//
// Sanctioned mediator — the ONE file in src/core/ that may import from src/agent/.
// Direction: core → agent, this file only. The graded boundary (agent → core) stays
// zero. See architecture.md §Architectural-Boundaries.

import { createSolanaRpc, type BlockhashLifetimeConstraint } from "@solana/kit";
import type { AppConfig } from "../config.js";
import { EvidenceLog } from "./evidence/evidence-log.js";
import { LifecycleStream } from "./stream/lifecycle-stream.js";
import { GrpcAdapter } from "./stream/grpc-adapter.js";
import { RpcWebSocketAdapter } from "./stream/ws-adapter.js";
import { withReconnect, DEFAULT_RECONNECT_POLICY } from "./stream/reconnect.js";
import { LeaderWindow } from "./leader/leader-window.js";
import { LifecycleTracker } from "./lifecycle/lifecycle-tracker.js";
import { classifyFailure, type ClassifiedFailure } from "./lifecycle/failure-classifier.js";
import { JitoClient } from "./jito/jito-client.js";
import { fetchLiveTipData } from "./jito/tip-data.js";
import { computeTip } from "./jito/tip-calculator.js";
import { buildBundle } from "./jito/bundle-builder.js";
import { injectBlockhashExpiry } from "./fault/blockhash-expiry.js";
import { executeDecision } from "./execute/decision-executor.js";
import { lamportsToNumber, slotsToNumber } from "./units.js";
import type { TxStatusChanged } from "../schemas/stream-event-schema.js";
import type { FailureContext, TipMarketData, PriorAttempt } from "../schemas/observation-schema.js";
import { runEpisode, type LoopContext, type AgentStep, type StepFeedback } from "../agent/agent-loop.js";
import { GeminiProvider } from "../agent/llm/gemini-provider.js";
import { GroqProvider } from "../agent/llm/groq-provider.js";
import type { LlmProvider } from "../agent/llm/llm-provider.js";

// Named constants — no bare literals in loop conditions (CM1)
const MAX_QUEUE_SIZE = 1_000;
const SLOT_TIMEOUT_SLOTS = 50n;

// ─── Public surface ───────────────────────────────────────────────────────────

export type SessionParams = {
  config: AppConfig;
  /** Active profile name written to `sessionStarted` evidence. Defaults to
   * `config.adapter` if omitted; CLI commands (5.2/5.3) pass the real name. */
  profile?: string;
};

// ─── Internal types ───────────────────────────────────────────────────────────

type SettlementOutcome =
  | { landed: true }
  | { landed: false; reason: string };

type SettlementEntry = {
  resolve: (outcome: SettlementOutcome) => void;
  submittedSlot: bigint;
};

// ─── Pure helpers (exported for unit tests) ───────────────────────────────────

/** Generates a session ID using only safe ASCII chars [A-Za-z0-9-] so it is
 * safe to embed in the log file path `logs/lifecycle-<id>.jsonl`. Never
 * interpolates user or profile input (closes deferred path-safety item). */
export function generateSessionId(): string {
  const hex = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0");
  return `${Date.now().toString(36)}-${hex}`;
}

/** Bridges a ClassifiedFailure (core type) → FailureContext (agent/schema type)
 * by injecting the failedAtSlot the orchestrator owns. All fields are numbers,
 * never bigints (agent layer is numbers-only). */
export function buildFailureContext(
  cf: ClassifiedFailure,
  failedAtSlot: number,
): FailureContext {
  return { classification: cf.classification, rawError: cf.rawError, failedAtSlot };
}

/** Returns true when this bundleIndex should receive fault injection.
 * The index comes from config — never hardcoded (AC6 / CM1). */
export function isFaultBundle(bundleIndex: number, atBundle: number): boolean {
  return bundleIndex === atBundle;
}

// ─── Session entry point ──────────────────────────────────────────────────────

export async function runSession(params: SessionParams): Promise<void> {
  const { config } = params;
  const sessionId = generateSessionId();
  const ac = new AbortController();

  const onSigint = () => ac.abort();
  // Register BEFORE constructing EvidenceLog (ensures orchestrator's handler
  // fires first so abort() runs before any downstream SIGINT handlers).
  process.once("SIGINT", onSigint);

  // suppressSigint: orchestrator owns shutdown — EvidenceLog must NOT call
  // process.exit(0) on SIGINT. The finally block below guarantees sessionEnded
  // and log.close() run before any exit.
  const evidenceLog = new EvidenceLog(sessionId, { suppressSigint: true });

  evidenceLog.append({
    event: "sessionStarted",
    at: new Date().toISOString(),
    sessionId,
    profile: params.profile ?? config.adapter,
    adapter: config.adapter,
  });

  let endReason = "completed";

  try {
    // ── Construct all subsystems ─────────────────────────────────────────────
    const stream = new LifecycleStream(MAX_QUEUE_SIZE, evidenceLog, ac.signal);

    const adapter =
      config.adapter === "grpc"
        ? new GrpcAdapter(config.grpcEndpoint, config.grpcXToken, config.rpcEndpoint, stream)
        : new RpcWebSocketAdapter(config.rpcEndpoint, config.wsEndpoint, stream);

    const leaderWindow = new LeaderWindow();
    const tracker = new LifecycleTracker(evidenceLog);
    const jito = new JitoClient(config.jitoBlockEngineUrl);
    const rpc = createSolanaRpc(config.rpcEndpoint);

    // ── Session-scoped coordination state ────────────────────────────────────
    // All mutable session state lives here (architecture mandate).
    const settlements = new Map<string, SettlementEntry>();
    const sigToBundleId = new Map<string, string>();

    // Resolves when the first slotAdvanced event is observed — bundle loop
    // waits here before submitting (slot 0n means stream not yet live).
    let streamLiveResolve!: () => void;
    const streamLive = new Promise<void>((r) => {
      streamLiveResolve = r;
    });
    let streamLiveFlag = false;

    // ── Start adapter (sanctioned void — reconnect loop runs until aborted) ──
    void withReconnect(adapter, stream, evidenceLog, DEFAULT_RECONNECT_POLICY, ac.signal);

    // ── Bundle submission loop — runs concurrently with the stream event loop ─
    const submissionTask = _runBundleLoop(
      config,
      jito,
      rpc,
      adapter,
      tracker,
      leaderWindow,
      evidenceLog,
      settlements,
      sigToBundleId,
      streamLive,
      ac,
    )
      .catch((err: unknown) => {
        endReason = err instanceof Error ? err.message : "submission error";
      })
      .finally(() => {
        // Signal the stream loop to stop when submission is complete or errored.
        if (!ac.signal.aborted) ac.abort();
      });

    // ── Main stream event loop ───────────────────────────────────────────────
    for await (const event of stream) {
      if (ac.signal.aborted) break;

      leaderWindow.consume(event);

      // Wake the bundle loop when the stream becomes live.
      if (!streamLiveFlag && event.kind === "slotAdvanced") {
        streamLiveFlag = true;
        streamLiveResolve();
        console.log(`[stream] live at slot ${leaderWindow.getCurrentSlot()}`);
      }

      // Route txStatusChanged → tracker + settle completed bundles.
      if (event.kind === "txStatusChanged") {
        const bundleId = sigToBundleId.get(event.signature);
        if (bundleId !== undefined) {
          try {
            tracker.consume(event as TxStatusChanged, bundleId);
          } catch (err) {
            console.error("[orchestrator] Illegal tracker transition:", err);
          }
          console.log(`[${bundleId.slice(0, 8)}…] ${event.commitment} at slot ${event.slot}`);
          if (event.commitment === "finalized") {
            settlements.get(bundleId)?.resolve({ landed: true });
            settlements.delete(bundleId);
          }
        }
      }

      // Slot-timeout: resolve any in-flight bundle that has exceeded SLOT_TIMEOUT_SLOTS.
      if (event.kind === "slotAdvanced") {
        const currentSlot = leaderWindow.getCurrentSlot();
        for (const [bundleId, entry] of settlements) {
          if (currentSlot - entry.submittedSlot > SLOT_TIMEOUT_SLOTS) {
            entry.resolve({ landed: false, reason: "Bundle timed out after 50 slots" });
            settlements.delete(bundleId);
          }
        }
      }
    }

    await submissionTask;
  } catch (err) {
    endReason = err instanceof Error ? err.message : "error";
  } finally {
    process.removeListener("SIGINT", onSigint);
    // sessionEnded ALWAYS fires — normal completion, abort, timeout, or throw.
    evidenceLog.append({
      event: "sessionEnded",
      at: new Date().toISOString(),
      sessionId,
      reason: endReason,
    });
    evidenceLog.close();
  }
}

// ─── Bundle submission loop ───────────────────────────────────────────────────

async function _runBundleLoop(
  config: AppConfig,
  jito: JitoClient,
  rpc: ReturnType<typeof createSolanaRpc>,
  adapter: GrpcAdapter | RpcWebSocketAdapter,
  tracker: LifecycleTracker,
  leaderWindow: LeaderWindow,
  evidenceLog: EvidenceLog,
  settlements: Map<string, SettlementEntry>,
  sigToBundleId: Map<string, string>,
  streamLive: Promise<void>,
  ac: AbortController,
): Promise<void> {
  // Wait for the first slot before submitting anything.
  await streamLive;
  if (ac.signal.aborted) return;

  // Fetch tip accounts once for the session.
  const tipAccountsResult = await jito.getTipAccounts(ac.signal);
  if (ac.signal.aborted) return;
  if (!tipAccountsResult.ok) {
    const cf = classifyFailure(tipAccountsResult.failure.reason);
    evidenceLog.append({
      event: "failureClassified",
      at: new Date().toISOString(),
      classification: cf.classification,
      rawError: cf.rawError,
    });
    return;
  }
  const tipAccounts = tipAccountsResult.value;
  if (tipAccounts.length === 0) return;
  const tipAccount = tipAccounts[0]!;

  const provider: LlmProvider =
    config.llm.provider === "groq"
      ? new GroqProvider(config.llmApiKey, config.llm.model)
      : new GeminiProvider(config.llmApiKey, config.llm.model);

  console.log(`[session] submitting ${config.bundleCount} bundles — dryRun: ${config.guardrails.dryRun}`);

  // Bundle loop: 0-based index matching config.faultInjection.atBundle semantics.
  for (let bundleIndex = 0; bundleIndex < config.bundleCount; bundleIndex++) {
    if (ac.signal.aborted) break;

    // Refresh tip data for each bundle (market conditions change).
    const tipDataResult = await fetchLiveTipData(tipAccounts, rpc, ac.signal);
    if (ac.signal.aborted) break;
    if (!tipDataResult.ok) {
      const cf = classifyFailure(tipDataResult.failure.reason);
      evidenceLog.append({
        event: "failureClassified",
        at: new Date().toISOString(),
        classification: cf.classification,
        rawError: cf.rawError,
      });
      continue;
    }
    const tipMarket: TipMarketData = tipDataResult.value;
    const tip = computeTip(tipMarket, config.guardrails);

    // Blockhash: fault-inject a stale one at the configured index (live only;
    // dryRun skips submission so fault injection is meaningless there).
    let lifetimeConstraint: BlockhashLifetimeConstraint;
    let blockhashFetchedAtSlot: bigint;

    if (!config.guardrails.dryRun && isFaultBundle(bundleIndex, config.faultInjection.atBundle)) {
      const stale = await injectBlockhashExpiry(rpc, evidenceLog, ac.signal);
      if (ac.signal.aborted) break;
      lifetimeConstraint = stale.lifetimeConstraint;
      blockhashFetchedAtSlot = stale.fetchedAtSlot;
    } else {
      blockhashFetchedAtSlot = leaderWindow.getCurrentSlot();
      const bh = await rpc.getLatestBlockhash().send();
      lifetimeConstraint = {
        blockhash: bh.value.blockhash,
        lastValidBlockHeight: bh.value.lastValidBlockHeight,
      };
    }
    if (ac.signal.aborted) break;

    // Build the bundle transactions.
    const bundleResult = await buildBundle({
      lifetimeConstraint,
      keypairPath: config.keypairPath,
      tipAccount,
      tipLamports: tip,
    });

    // dryRun: log and skip — no SOL spent.
    if (config.guardrails.dryRun) {
      console.log(`[bundle ${bundleIndex + 1}/${config.bundleCount}] dryRun — tip=${tip} lamports, slot=${leaderWindow.getCurrentSlot()}`);
      continue;
    }

    // Capture leader window before submission for the bundleSubmitted event.
    const leaderWin = await leaderWindow.getNextJitoLeaderWindow();
    const submittedSlot = leaderWindow.getCurrentSlot();

    // Submit the bundle.
    const sendResult = await jito.sendBundle(bundleResult.transactions, ac.signal);
    if (ac.signal.aborted) break;

    if (!sendResult.ok) {
      // Immediate send failure — classify and enter agent episode.
      const cf = classifyFailure(sendResult.failure.reason);
      evidenceLog.append({
        event: "failureClassified",
        at: new Date().toISOString(),
        classification: cf.classification,
        rawError: cf.rawError,
      });
      await _runAgentEpisode({
        bundleIndex,
        cf,
        blockhashFetchedAtSlot,
        failedAtSlot: submittedSlot,
        lifetimeConstraint,
        tip,
        tipAccounts,
        tipAccount,
        tipMarket,
        provider,
        config,
        jito,
        rpc,
        adapter,
        tracker,
        leaderWindow,
        evidenceLog,
        settlements,
        sigToBundleId,
        ac,
        priorBundleId: undefined,
      });
      continue;
    }

    const bundleId = sendResult.value;

    evidenceLog.append({
      event: "bundleSubmitted",
      at: new Date().toISOString(),
      bundleId,
      slot: submittedSlot,
      tipLamports: tip,
      leaderWindow: { startSlot: leaderWin.startSlot, endSlot: leaderWin.endSlot },
    });
    console.log(`[bundle ${bundleIndex + 1}/${config.bundleCount}] submitted id=${bundleId} slot=${submittedSlot} tip=${tip}`);

    tracker.register(bundleId);

    // Track all bundle signatures for commitment events.
    for (const sig of bundleResult.signatures) {
      sigToBundleId.set(sig, bundleId);
      adapter.trackSignature(sig, ac.signal);
    }

    // Await bundle settlement (stream loop resolves this promise).
    const settlement = await _awaitSettlement(bundleId, submittedSlot, settlements);
    if (ac.signal.aborted) break;

    if (settlement.landed) {
      console.log(`[bundle ${bundleIndex + 1}/${config.bundleCount}] finalized`);
      continue;
    }

    // Timeout or failure — classify and enter agent episode.
    const cf = classifyFailure(settlement.reason);
    evidenceLog.append({
      event: "failureClassified",
      at: new Date().toISOString(),
      bundleId,
      classification: cf.classification,
      rawError: cf.rawError,
    });
    console.log(`[bundle ${bundleIndex + 1}/${config.bundleCount}] failed — ${cf.classification}`);
    await _runAgentEpisode({
      bundleIndex,
      cf,
      blockhashFetchedAtSlot,
      failedAtSlot: submittedSlot,
      lifetimeConstraint,
      tip,
      tipAccounts,
      tipAccount,
      tipMarket,
      provider,
      config,
      jito,
      rpc,
      adapter,
      tracker,
      leaderWindow,
      evidenceLog,
      settlements,
      sigToBundleId,
      ac,
      priorBundleId: bundleId,
    });
  }
}

// ─── Settlement helper ────────────────────────────────────────────────────────

function _awaitSettlement(
  bundleId: string,
  submittedSlot: bigint,
  settlements: Map<string, SettlementEntry>,
): Promise<SettlementOutcome> {
  return new Promise<SettlementOutcome>((resolve) => {
    settlements.set(bundleId, { resolve, submittedSlot });
  });
}

// ─── Agent episode ────────────────────────────────────────────────────────────

type AgentEpisodeParams = {
  bundleIndex: number;
  cf: ClassifiedFailure;
  blockhashFetchedAtSlot: bigint;
  failedAtSlot: bigint;
  lifetimeConstraint: BlockhashLifetimeConstraint;
  tip: bigint;
  tipAccounts: string[];
  tipAccount: string;
  tipMarket: TipMarketData;
  provider: LlmProvider;
  config: AppConfig;
  jito: JitoClient;
  rpc: ReturnType<typeof createSolanaRpc>;
  adapter: GrpcAdapter | RpcWebSocketAdapter;
  tracker: LifecycleTracker;
  leaderWindow: LeaderWindow;
  evidenceLog: EvidenceLog;
  settlements: Map<string, SettlementEntry>;
  sigToBundleId: Map<string, string>;
  ac: AbortController;
  /** bundleId of the bundle that failed; undefined when sendBundle itself errored. */
  priorBundleId: string | undefined;
};

async function _runAgentEpisode(p: AgentEpisodeParams): Promise<void> {
  const currentSlot = p.leaderWindow.getCurrentSlot();
  const leaderWin = await p.leaderWindow.getNextJitoLeaderWindow();

  const blockhashAgeSlots = Math.max(
    0,
    slotsToNumber(currentSlot) - slotsToNumber(p.blockhashFetchedAtSlot),
  );

  const slotsUntilWindow =
    leaderWin.startSlot > currentSlot
      ? slotsToNumber(leaderWin.startSlot - currentSlot)
      : 0;

  const initialCtx: LoopContext = {
    failure: buildFailureContext(p.cf, slotsToNumber(p.failedAtSlot)),
    blockhashAgeSlots,
    currentSlot: slotsToNumber(currentSlot),
    leader: {
      slotsUntilNextTargetWindow: slotsUntilWindow,
      windowLengthSlots: slotsToNumber(leaderWin.endSlot - leaderWin.startSlot),
    },
    tipMarket: p.tipMarket,
    lastTipLamports: lamportsToNumber(p.tip),
  };

  const episodeId = `ep-${p.bundleIndex}-${Date.now().toString(36)}`;

  // Synthetic bundleId when the initial send failed before Jito returned an ID.
  let currentBundleId = p.priorBundleId ?? `send-failed-${p.bundleIndex}`;
  let currentConstraint = p.lifetimeConstraint;

  // The executeStep closure mediates between the agent loop (pure) and core
  // execution (executeDecision). It tracks the current bundleId as it evolves
  // across resubmissions, and awaits settlement via the stream event loop.
  const executeStep = async (step: AgentStep): Promise<StepFeedback> => {
    const outcome = await executeDecision({
      decision: step.decision,
      observation: step.observation,
      thinkingTrace: step.thinkingTrace,
      bundleId: currentBundleId,
      lifetimeConstraint: currentConstraint,
      keypairPath: p.config.keypairPath,
      tipAccount: p.tipAccount,
      jitoClient: p.jito,
      rpc: p.rpc,
      evidenceLog: p.evidenceLog,
      guardrails: p.config.guardrails,
      signal: p.ac.signal,
    });

    if (!outcome.continued) return { done: true };

    // Resubmission succeeded — update current bundle tracking.
    currentBundleId = outcome.newBundleId;
    currentConstraint = outcome.lifetimeConstraint;

    const resubmitSlot = p.leaderWindow.getCurrentSlot();

    p.tracker.register(outcome.newBundleId);
    for (const sig of outcome.signatures) {
      p.sigToBundleId.set(sig, outcome.newBundleId);
      p.adapter.trackSignature(sig, p.ac.signal);
    }

    // Write bundleSubmitted for the resubmitted bundle.
    const resubLeaderWin = await p.leaderWindow.getNextJitoLeaderWindow();
    p.evidenceLog.append({
      event: "bundleSubmitted",
      at: new Date().toISOString(),
      bundleId: outcome.newBundleId,
      slot: resubmitSlot,
      tipLamports: outcome.tipLamports,
      leaderWindow: {
        startSlot: resubLeaderWin.startSlot,
        endSlot: resubLeaderWin.endSlot,
      },
    });

    // Await commitment — the stream event loop resolves this promise.
    const settlement = await _awaitSettlement(outcome.newBundleId, resubmitSlot, p.settlements);

    if (settlement.landed) return { done: true };

    // Retry also failed — build fresh LoopContext for next attempt.
    const failedSlot = p.leaderWindow.getCurrentSlot();
    const nextLeaderWin = await p.leaderWindow.getNextJitoLeaderWindow();
    const nextTipResult = await fetchLiveTipData(p.tipAccounts, p.rpc, p.ac.signal);
    const nextTipMarket: TipMarketData = nextTipResult.ok ? nextTipResult.value : p.tipMarket;

    const priorAttempt: PriorAttempt = {
      action: step.decision.action,
      tipLamports: lamportsToNumber(outcome.tipLamports),
      outcome: "not_landed",
      slot: slotsToNumber(failedSlot),
    };

    const nextSlotsUntil =
      nextLeaderWin.startSlot > failedSlot
        ? slotsToNumber(nextLeaderWin.startSlot - failedSlot)
        : 0;
    const newAge = Math.max(0, slotsToNumber(failedSlot) - slotsToNumber(resubmitSlot));
    const retryCf = classifyFailure(settlement.reason);

    const nextCtx: LoopContext = {
      failure: buildFailureContext(retryCf, slotsToNumber(failedSlot)),
      blockhashAgeSlots: newAge,
      currentSlot: slotsToNumber(failedSlot),
      leader: {
        slotsUntilNextTargetWindow: nextSlotsUntil,
        windowLengthSlots: slotsToNumber(nextLeaderWin.endSlot - nextLeaderWin.startSlot),
      },
      tipMarket: nextTipMarket,
      lastTipLamports: lamportsToNumber(outcome.tipLamports),
    };

    return { done: false, priorAttempt, next: nextCtx };
  };

  const result = await runEpisode({
    episodeId,
    context: initialCtx,
    guardrails: p.config.guardrails,
    provider: p.provider,
    executeStep,
  });

  if (!result.ok) {
    console.error(
      `[orchestrator] LLM failure in episode ${episodeId}:`,
      result.failure.llmError.reason,
    );
  }
}
