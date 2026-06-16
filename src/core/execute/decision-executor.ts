import { createSolanaRpc, type BlockhashLifetimeConstraint } from "@solana/kit";
import type { AgentDecision } from "../../schemas/decision-schema.js";
import type { AgentObservation } from "../../schemas/observation-schema.js";
import type { Guardrails } from "../../schemas/config-schema.js";
import { applyGuardrails } from "./guardrails.js";
import { buildBundle } from "../jito/bundle-builder.js";
import type { Result } from "../result.js";
import type { EvidenceLog } from "../evidence/evidence-log.js";

/** Minimal bundle-send contract shared by the hand-rolled `JitoClient` (fallback
 * profiles) and the authenticated `SearcherClient` (searcher mode). Both expose
 * `sendBundle(base64Txs, signal)` with this exact shape, so the agent-episode
 * resubmit path can route through whichever transport the session is using —
 * keeping recovery on the SAME path as the primary submit (Story 5.8 review). */
export interface BundleSubmitter {
  sendBundle(
    transactions: string[],
    signal: AbortSignal,
  ): Promise<Result<string, { reason: string }>>;
}

const APPROX_SLOT_DURATION_MS = 400;

function _sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

export type ExecutorParams = {
  decision: AgentDecision;
  observation: AgentObservation;
  thinkingTrace: string;
  bundleId: string;
  lifetimeConstraint: BlockhashLifetimeConstraint;
  keypairPath: string;
  tipAccount: string;
  /** Active bundle transport — `SearcherClient` in searcher mode, else `JitoClient`.
   * Resubmits land on the same path as the primary submit (Story 5.8 review). */
  submitter: BundleSubmitter;
  rpc: ReturnType<typeof createSolanaRpc>;
  evidenceLog: EvidenceLog;
  guardrails: Guardrails;
  signal: AbortSignal;
};

export type ExecutorOutcome =
  | {
      continued: true;
      newBundleId: string;
      signatures: string[];
      tipLamports: bigint;
      lifetimeConstraint: BlockhashLifetimeConstraint;
    }
  | { continued: false };

export async function executeDecision(params: ExecutorParams): Promise<ExecutorOutcome> {
  const { decision, observation, thinkingTrace, bundleId, lifetimeConstraint,
          keypairPath, tipAccount, submitter, rpc, evidenceLog, guardrails, signal } = params;

  const { decision: clampedDecision, clamped } =
    applyGuardrails(decision, guardrails, observation.guardrails.attemptsRemaining);

  // must fire before dispatch so abort path also has the event
  evidenceLog.append({
    event: "agentDecision",
    at: new Date().toISOString(),
    bundleId,
    episodeId: observation.episodeId,
    attempt: observation.attempt,
    observation,
    decision: clampedDecision,
    ...(clamped ? { originalDecision: decision } : {}),
    thinkingTrace,
    clamped,
  });

  if (clampedDecision.action === "abort") {
    evidenceLog.append({
      event: "failureClassified",
      at: new Date().toISOString(),
      bundleId,
      classification: observation.failure.classification,
      rawError: observation.failure.rawError,
    });
    return { continued: false };
  }

  let constraint = lifetimeConstraint;
  if (clampedDecision.action === "refresh") {
    const { value } = await rpc.getLatestBlockhash().send();
    constraint = { blockhash: value.blockhash, lastValidBlockHeight: value.lastValidBlockHeight };
  }

  if (clampedDecision.action === "hold") {
    await _sleep(clampedDecision.holdSlots! * APPROX_SLOT_DURATION_MS, signal);
  }

  const tipLamports =
    clampedDecision.newTipLamports !== undefined
      ? BigInt(clampedDecision.newTipLamports)
      : BigInt(observation.myLastTipLamports);

  const { transactions, signatures } = await buildBundle({
    lifetimeConstraint: constraint,
    keypairPath,
    tipAccount,
    tipLamports,
  });

  const sendResult = await submitter.sendBundle(transactions, signal);
  if (!sendResult.ok) {
    evidenceLog.append({
      event: "failureClassified",
      at: new Date().toISOString(),
      bundleId,
      classification: "bundle_failure",
      rawError: sendResult.failure.reason,
    });
    return { continued: false };
  }

  return {
    continued: true,
    newBundleId: sendResult.value,
    signatures,
    tipLamports,
    lifetimeConstraint: constraint,
  };
}
