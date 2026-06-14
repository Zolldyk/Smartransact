// scripts/agent-integration-test.ts
//
// Thin harness: wires synthetic failure-context → runEpisode → real GeminiProvider →
// applyGuardrails → EvidenceLog. Proves FR19 (≥2 materially different outcomes) and
// verifies the core/agent boundary holds. No Jito bundle submission, no SOL spent.
//
// Required env vars:
//   GEMINI_API_KEY=<your-key>
//   SOLINFRA_RPC_KEY=<rpc-key>   (used to expand rpcEndpoint placeholder in config)
//   SOLINFRA_GRPC_ENDPOINT, SOLINFRA_GRPC_TOKEN   (required by loadConfig even if unused here)
//   KEYPAIR_PATH=<path>   (required by loadConfig; not used by this harness)
//
// Usage: npm run agent-integration-test
//        (or: npx tsx scripts/agent-integration-test.ts)

import { readFileSync } from "node:fs";
import { createSolanaRpc } from "@solana/kit";
import { loadConfig } from "../src/config.js";
import { EvidenceLog } from "../src/core/evidence/evidence-log.js";
import { JitoClient } from "../src/core/jito/jito-client.js";
import { fetchLiveTipData } from "../src/core/jito/tip-data.js";
import { applyGuardrails } from "../src/core/execute/guardrails.js";
import { GeminiProvider } from "../src/agent/llm/gemini-provider.js";
import { runEpisode } from "../src/agent/agent-loop.js";
import type { LoopContext, AgentStep, StepFeedback } from "../src/agent/agent-loop.js";
import type { TipMarketData } from "../src/schemas/observation-schema.js";

(async () => {
  const config = loadConfig();
  const sessionId = `ait-${Date.now()}`;
  const logPath = `logs/lifecycle-${sessionId}.jsonl`;
  const evidenceLog = new EvidenceLog(sessionId);
  const ac = new AbortController();
  const { signal } = ac;

  const rpc = createSolanaRpc(config.rpcEndpoint);
  const jito = new JitoClient(config.jitoBlockEngineUrl);
  const currentSlot = Number(await rpc.getSlot().send());
  const tipAccountsResult = await jito.getTipAccounts(signal);
  const tipAccounts = tipAccountsResult.ok ? tipAccountsResult.value : [];
  const liveTipResult = await fetchLiveTipData(tipAccounts, rpc, signal);
  const liveTipData: TipMarketData = liveTipResult.ok
    ? liveTipResult.value
    : { floorPercentiles: { p25: 1000, p50: 1500, p75: 2000, p95: 5000, p99: 10000 }, emaP50: 1500, observedRecentTips: [] };

  function makeExecuteStep(bundleId: string): (step: AgentStep) => Promise<StepFeedback> {
    return async (step: AgentStep): Promise<StepFeedback> => {
      const { decision: clamped, clamped: wasClamped } = applyGuardrails(
        step.decision,
        config.guardrails,
        step.observation.guardrails.attemptsRemaining,
      );
      evidenceLog.append({
        event: "agentDecision",
        at: new Date().toISOString(),
        bundleId,
        episodeId: step.observation.episodeId,
        attempt: step.observation.attempt,
        observation: step.observation,
        decision: clamped,
        ...(wasClamped ? { originalDecision: step.decision } : {}),
        thinkingTrace: step.thinkingTrace,
        clamped: wasClamped,
      });
      return { done: true };
    };
  }

  // Episode 1: low market, leader close, low tip — agent should prefer refresh or small adjust_tip
  const ctx1: LoopContext = {
    failure: { classification: "expired_blockhash", rawError: "BlockhashNotFound", failedAtSlot: currentSlot - 2 },
    blockhashAgeSlots: 155,
    currentSlot,
    leader: { slotsUntilNextTargetWindow: 2, windowLengthSlots: 4 },
    tipMarket: liveTipData,
    lastTipLamports: 2000,
  };

  // Episode 2: spiked market, leader far, same low tip — agent should see tip is below market,
  // leader window is distant, and decide differently from Episode 1.
  const ctx2: LoopContext = {
    failure: { classification: "expired_blockhash", rawError: "BlockhashNotFound", failedAtSlot: currentSlot },
    blockhashAgeSlots: 162,
    currentSlot: currentSlot + 12,
    leader: { slotsUntilNextTargetWindow: 18, windowLengthSlots: 4 },
    tipMarket: {
      floorPercentiles: { p25: 5000, p50: 15000, p75: 30000, p95: 200000, p99: 1000000 },
      emaP50: 20000,
      observedRecentTips: [8000, 12000, 18000],
    },
    lastTipLamports: 2000,
  };

  const provider = new GeminiProvider(config.llmApiKey, config.llm.model);

  console.log("[ep-001] Running episode 1 — low market, leader close...");
  const result1 = await runEpisode({
    episodeId: "ep-001",
    context: ctx1,
    guardrails: config.guardrails,
    provider,
    executeStep: makeExecuteStep("integration-ep-001"),
  });
  if (!result1.ok) {
    console.error("[ep-001] LLM failure:", result1.failure.llmError.reason);
    process.exit(1);
  }
  console.log("[ep-001] Done.");

  console.log("[ep-002] Running episode 2 — spiked market, leader far...");
  const result2 = await runEpisode({
    episodeId: "ep-002",
    context: ctx2,
    guardrails: config.guardrails,
    provider,
    executeStep: makeExecuteStep("integration-ep-002"),
  });
  if (!result2.ok) {
    console.error("[ep-002] LLM failure:", result2.failure.llmError.reason);
    process.exit(1);
  }
  console.log("[ep-002] Done.");

  evidenceLog.close();
  ac.abort();

  const lines = readFileSync(logPath, "utf-8").trim().split("\n").filter(Boolean);
  const events = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
  const decisions = events.filter((e) => e["event"] === "agentDecision");

  let allPass = true;
  function assert(cond: boolean, msg: string): void {
    if (cond) {
      console.log(`[PASS] ${msg}`);
    } else {
      console.error(`[FAIL] ${msg}`);
      allPass = false;
    }
  }

  // AC2: at least 2 agentDecision entries
  assert(decisions.length >= 2, `evidence log has ≥2 agentDecision entries (got ${decisions.length})`);

  // AC2: per-entry checks
  const [tipMin, tipMax] = config.guardrails.tipBand;
  for (const d of decisions) {
    const dec = d["decision"] as Record<string, unknown>;
    const eps = d["episodeId"] as string;
    assert(
      typeof dec["rationale"] === "string" && dec["rationale"].length > 0,
      `${eps}: rationale is non-empty`,
    );
    assert(
      typeof d["thinkingTrace"] === "string" && (d["thinkingTrace"] as string).length > 0,
      `${eps}: thinkingTrace is non-empty`,
    );
    assert(
      ["refresh", "adjust_tip", "hold", "abort"].includes(dec["action"] as string),
      `${eps}: action is valid enum (got "${dec["action"]}")`,
    );
    if (dec["newTipLamports"] !== undefined) {
      const tip = dec["newTipLamports"] as number;
      assert(
        tip >= tipMin && tip <= tipMax,
        `${eps}: newTipLamports ${tip} is within tipBand [${tipMin}, ${tipMax}]`,
      );
    }
  }

  // AC3: FR19 — the two episodes differ
  const d1 = decisions.find((d) => d["episodeId"] === "ep-001") as Record<string, unknown> | undefined;
  const d2 = decisions.find((d) => d["episodeId"] === "ep-002") as Record<string, unknown> | undefined;
  if (d1 && d2) {
    const dec1 = d1["decision"] as Record<string, unknown>;
    const dec2 = d2["decision"] as Record<string, unknown>;
    const differ =
      dec1["action"] !== dec2["action"] ||
      dec1["newTipLamports"] !== dec2["newTipLamports"];
    assert(differ, `FR19: ep-001 and ep-002 differ in action or newTipLamports (ep-001: ${dec1["action"]}/${dec1["newTipLamports"]}, ep-002: ${dec2["action"]}/${dec2["newTipLamports"]})`);
  }

  console.log(`\nLog: ${logPath}`);
  process.exit(allPass ? 0 : 1);
})().catch((err) => {
  console.error("[agent-integration-test] Fatal:", err);
  process.exit(1);
});
