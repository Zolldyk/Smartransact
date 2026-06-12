// scripts/smoke-test.ts
//
// End-to-end smoke test: gRPC stream → leader window → tip calc → bundle build → submit → lifecycle tracking.
// Verifies all Epic 3 components compose correctly against real mainnet before Epic 4.
//
// Env vars must be available before running. Two options:
//   A) Export in shell:
//      export SOLINFRA_GRPC_ENDPOINT=https://fra.grpc.solinfra.dev:443
//      export SOLINFRA_GRPC_TOKEN=<raw-token-without-grpc_-prefix>
//      export SOLINFRA_RPC_KEY=<rpc-key>
//      export KEYPAIR_PATH=/path/to/keypair.json
//   B) node --env-file=.env --import tsx/esm scripts/smoke-test.ts  (Node >= 20.12)
//
// dryRun=true (config default): full pipeline through buildBundle; prints tip info; no SOL spent.
// dryRun=false: submits a real bundle — fund the keypair with 0.06–0.1 SOL first.

import { readFileSync } from "node:fs";
import { createSolanaRpc, createKeyPairSignerFromBytes } from "@solana/kit";
import { loadConfig } from "../src/config.js";
import { EvidenceLog } from "../src/core/evidence/evidence-log.js";
import { LifecycleStream } from "../src/core/stream/lifecycle-stream.js";
import { GrpcAdapter } from "../src/core/stream/grpc-adapter.js";
import { withReconnect, DEFAULT_RECONNECT_POLICY } from "../src/core/stream/reconnect.js";
import { LeaderWindow } from "../src/core/leader/leader-window.js";
import { LifecycleTracker } from "../src/core/lifecycle/lifecycle-tracker.js";
import { classifyFailure } from "../src/core/lifecycle/failure-classifier.js";
import { JitoClient } from "../src/core/jito/jito-client.js";
import { fetchLiveTipData } from "../src/core/jito/tip-data.js";
import { computeTip } from "../src/core/jito/tip-calculator.js";
import { buildBundle } from "../src/core/jito/bundle-builder.js";
import type { TxStatusChanged } from "../src/schemas/stream-event-schema.js";

// Satisfy the GEMINI_API_KEY guard in loadConfig — not needed for the smoke test.
process.env["GEMINI_API_KEY"] ??= "not-needed-for-smoke-test";
const config = loadConfig();

if (config.adapter !== "grpc") {
  console.error("[smoke-test] Active profile must use adapter: grpc. Switch to mainnet-grpc in smartransact.config.json.");
  process.exit(1);
}

const sessionId = Date.now().toString();
const evidenceLog = new EvidenceLog(sessionId);

evidenceLog.append({
  event: "sessionStarted",
  at: new Date().toISOString(),
  sessionId,
  profile: "mainnet-grpc",
  adapter: config.adapter,
});

const ac = new AbortController();
const stream = new LifecycleStream(1000, evidenceLog, ac.signal);
const adapter = new GrpcAdapter(
  config.grpcEndpoint,
  config.grpcXToken,
  config.rpcEndpoint,
  stream,
);
const leaderWindow = new LeaderWindow();
const tracker = new LifecycleTracker(evidenceLog);
const jito = new JitoClient(config.jitoBlockEngineUrl);
const rpc = createSolanaRpc(config.rpcEndpoint);

void withReconnect(adapter, stream, evidenceLog, DEFAULT_RECONNECT_POLICY, ac.signal);

let submitted = false;
let bundleId: string | undefined;
let submittedSlot: bigint | undefined;
const sigToBundleId = new Map<string, string>();

for await (const event of stream) {
  leaderWindow.consume(event);

  // Submission: execute once when the gRPC stream is live and slot is known
  if (!submitted && leaderWindow.getCurrentSlot() > 0n) {
    submitted = true;

    // Derive wallet address for dryRun log output
    const keypairBytes = new Uint8Array(
      JSON.parse(readFileSync(config.keypairPath, "utf-8") as string) as number[],
    );
    const walletAddress = (await createKeyPairSignerFromBytes(keypairBytes)).address;

    const tipResult = await jito.getTipAccounts(ac.signal);
    if (!tipResult.ok) {
      const cf = classifyFailure(tipResult.failure.reason);
      evidenceLog.append({
        event: "failureClassified",
        at: new Date().toISOString(),
        classification: cf.classification,
        rawError: cf.rawError,
      });
      evidenceLog.append({
        event: "sessionEnded",
        at: new Date().toISOString(),
        sessionId,
        reason: "getTipAccounts failed",
      });
      break;
    }
    const tipAccounts = tipResult.value;
    if (tipAccounts.length === 0) {
      evidenceLog.append({
        event: "sessionEnded",
        at: new Date().toISOString(),
        sessionId,
        reason: "no tip accounts returned",
      });
      break;
    }

    const tipDataResult = await fetchLiveTipData(tipAccounts, rpc, ac.signal);
    if (!tipDataResult.ok) {
      const cf = classifyFailure(tipDataResult.failure.reason);
      evidenceLog.append({
        event: "failureClassified",
        at: new Date().toISOString(),
        classification: cf.classification,
        rawError: cf.rawError,
      });
      evidenceLog.append({
        event: "sessionEnded",
        at: new Date().toISOString(),
        sessionId,
        reason: "fetchLiveTipData failed",
      });
      break;
    }
    const tip = computeTip(tipDataResult.value, config.guardrails);

    const blockhashResult = await rpc.getLatestBlockhash().send();
    const { blockhash, lastValidBlockHeight } = blockhashResult.value;

    const bundleResult = await buildBundle({
      lifetimeConstraint: { blockhash, lastValidBlockHeight },
      keypairPath: config.keypairPath,
      tipAccount: tipAccounts[0],
      tipLamports: tip,
    });

    if (config.guardrails.dryRun) {
      console.log(`[smoke-test] dryRun=true`);
      console.log(`[smoke-test] wallet:  ${walletAddress}`);
      console.log(`[smoke-test] tip:     ${tip} lamports`);
      console.log(`[smoke-test] txCount: ${bundleResult.transactions.length}`);
      evidenceLog.append({
        event: "sessionEnded",
        at: new Date().toISOString(),
        sessionId,
        reason: "dryRun: submission skipped",
      });
      break;
    }

    const sendResult = await jito.sendBundle(bundleResult.transactions, ac.signal);
    if (!sendResult.ok) {
      const cf = classifyFailure(sendResult.failure.reason);
      evidenceLog.append({
        event: "failureClassified",
        at: new Date().toISOString(),
        classification: cf.classification,
        rawError: cf.rawError,
      });
      evidenceLog.append({
        event: "sessionEnded",
        at: new Date().toISOString(),
        sessionId,
        reason: "sendBundle failed",
      });
      break;
    }

    bundleId = sendResult.value;
    submittedSlot = leaderWindow.getCurrentSlot();

    evidenceLog.append({
      event: "bundleSubmitted",
      at: new Date().toISOString(),
      bundleId,
      slot: submittedSlot,
      tipLamports: tip,
    });

    tracker.register(bundleId);

    for (const sig of bundleResult.signatures) {
      adapter.trackSignature(sig, ac.signal);
      sigToBundleId.set(sig, bundleId);
    }
  }

  // Commitment tracking
  if (event.kind === "txStatusChanged" && sigToBundleId.has(event.signature)) {
    try {
      tracker.consume(event as TxStatusChanged, bundleId!);
    } catch (err) {
      console.error("[smoke-test] Illegal tracker transition:", err);
    }
    if (event.commitment === "finalized") {
      evidenceLog.append({
        event: "sessionEnded",
        at: new Date().toISOString(),
        sessionId,
        reason: "finalized",
      });
      break;
    }
  }

  // Slot timeout: 50 slots ≈ 20 s at 400 ms/slot
  if (submittedSlot !== undefined && leaderWindow.getCurrentSlot() - submittedSlot > 50n) {
    const cf = classifyFailure("Bundle timed out after 50 slots");
    evidenceLog.append({
      event: "failureClassified",
      at: new Date().toISOString(),
      bundleId,
      classification: cf.classification,
      rawError: cf.rawError,
    });
    evidenceLog.append({
      event: "sessionEnded",
      at: new Date().toISOString(),
      sessionId,
      reason: "timeout",
    });
    break;
  }
}

ac.abort();
evidenceLog.close();

console.log(`Session ID: ${sessionId}`);
console.log(`Log: logs/lifecycle-${sessionId}.jsonl`);
