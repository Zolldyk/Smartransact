import Link from "next/link";
import { MermaidDiagram } from "@/components/ui/mermaid-diagram";

const SYSTEM_OVERVIEW_MMD = `graph TD
  GrpcIn["SolInfra Ace mainnet gRPC"]-->YGA["YellowstoneGrpcAdapter\\n(primary)"]
  WsIn["Mainnet WebSocket\\n(ran the evidence session)"]-->RWA["RpcWebSocketAdapter"]
  YGA-->LS["LifecycleStream\\nbounded queue"]
  RWA-->LS
  LS-->ORC["Orchestrator\\n(single consumer)"]
  ORC-->LW["Leader Window\\nDetection"]
  ORC-->BB["Bundle Builder\\n+ JitoClient"]
  ORC-->LT["Lifecycle Tracker"]
  ORC-->FC["Failure Classifier"]
  ORC-->AL["Agent Loop"]
  ORC-->EL["EvidenceLogger\\nappend-only JSONL"]
  AL-->LLP["LlmProvider\\nGemini / Claude / Groq"]`;

const DATA_FLOW_MMD = `graph LR
  A["Adapter"] -->|"LifecycleEvent"| Q["Bounded Queue\\n(backpressure)"]
  Q -->|"slot / leader events"| ORC["Orchestrator"]
  ORC -->|"leader window"| LW["Leader Window"]
  LW -->|"target slot"| BB["Bundle Builder"]
  BB -->|"signed tx"| JC["JitoClient\\nsendBundle"]
  JC -->|"bundle ID"| LT["Lifecycle Tracker"]
  LT -->|"timeout / error"| FC["Failure Classifier"]
  FC -->|"classified failure"| OB["Observation Builder"]
  OB -->|"structured prompt"| LLP["LlmProvider"]
  LLP -->|"AgentDecision"| GR["Guardrails\\n(clamp + log)"]
  GR -->|"validated decision"| DE["Decision Executor"]
  DE -->|"refresh / adjust_tip"| JC
  ORC -->|"every stage event"| EL["EvidenceLogger"]`;

const LIFECYCLE_STATES_MMD = `stateDiagram-v2
  [*] --> submitted : bundleSubmitted
  submitted --> processed : validator picks up tx
  processed --> confirmed : 67% stake votes
  confirmed --> finalized : supermajority ~32 slots later
  finalized --> [*]
  submitted --> failed : bundle_failure\\n(timeout / dropped)
  processed --> failed : fee_too_low\\ncompute_exceeded\\nexpired_blockhash
  failed --> submitted : agent refresh / adjust_tip (retry)
  failed --> [*] : agent abort`;

const AGENT_EPISODE_LOOP_MMD = `graph TD
  FC["Failure Classifier\\nfailureClassified event"]-->OB["Observation Builder\\n(public data only, NFR4)"]
  OB-->LP["LlmProvider\\nGemini / Claude / Groq"]
  LP-->|"diagnosis + action\\n+ rationale + thinking trace"| GR["Guardrails\\n(clamp tip, check attempts)"]
  GR-->DE["Decision Executor"]
  DE-->|"refresh"| BH["Fetch fresh blockhash"]
  DE-->|"adjust_tip"| BT["Rebuild bundle\\nwith new tip"]
  DE-->|"hold"| W["Wait holdSlots"]
  DE-->|"abort"| STOP["End episode"]
  BH-->JS["Resubmit to\\nJito Block Engine"]
  BT-->JS
  W-->JS
  JS-->FC`;

export default function ArchitecturePage() {
  return (
    <div className="doc-wrap">
      <div className="doc-eyebrow">Architecture</div>
      <h1 className="doc-h1">How Smartransact works</h1>
      <p className="doc-lead">
        A single-process TypeScript backend that subscribes to a live Solana event stream,
        builds Jito bundles, tracks each bundle through the commitment lifecycle, and routes
        failures to an LLM-powered agent that decides how to recover, all evidenced in an
        append-only JSONL log.
      </p>

      <section className="doc-section">
        <h2 className="doc-h2">1. System Architecture</h2>
        <p className="doc-body">
          Smartransact is a single-process TypeScript backend that subscribes to a live Solana
          event stream, builds Jito bundles, tracks each bundle through the commitment lifecycle,
          and routes failures to an LLM-powered agent that decides how to recover. The system is
          designed around a config-driven transport seam: SolInfra Ace mainnet Yellowstone gRPC is the
          primary stream; a mainnet WebSocket profile is the verified fallback. Switching requires only a
          config profile change, and the committed evidence session ran on the mainnet WebSocket profile
          (see Infrastructure Decisions).
        </p>
        <MermaidDiagram id="diag-system-overview" definition={SYSTEM_OVERVIEW_MMD} title="System architecture" />
      </section>

      <section className="doc-section">
        <h2 className="doc-h2">2. Key Components</h2>
        <p className="doc-body">
          Each module has a single responsibility and a defined interface seam:
        </p>
        <ul className="doc-body" style={{ paddingLeft: "1.4em", marginBottom: 0 }}>
          <li><strong>LifecycleStream</strong> (<code className="doc-code">src/core/stream/lifecycle-stream.ts</code>):bounded async-iterable event bus; drops oldest events under backpressure (FR6); provides exactly one consumer seam.</li>
          <li><strong>YellowstoneGrpcAdapter</strong> (<code className="doc-code">src/core/stream/grpc-adapter.ts</code>):connects to SolInfra Ace hosted Yellowstone gRPC, normalizes slot + shred events into <code className="doc-code">LifecycleEvent</code> union.</li>
          <li><strong>RpcWebSocketAdapter</strong> (<code className="doc-code">src/core/stream/ws-adapter.ts</code>):mainnet WebSocket fallback (ran the committed evidence session); same event union; config-selected, zero core changes to switch.</li>
          <li><strong>Orchestrator</strong> (<code className="doc-code">src/core/orchestrator.ts</code>):the single stream consumer; drives all subsystems in sequence; owns all mutable session state.</li>
          <li><strong>JitoClient</strong> (<code className="doc-code">src/core/jito/jito-client.ts</code>):thin hand-rolled <code className="doc-code">fetch</code>-based Block Engine client (4 JSON-RPC methods + 1 REST); handles base64 encoding, rate limiting, and 429/503 backoff.</li>
          <li><strong>LifecycleTracker</strong> (<code className="doc-code">src/core/lifecycle/lifecycle-tracker.ts</code>):per-bundle state machine (<code className="doc-code">submitted → processed → confirmed → finalized</code> + failure exits); transitions driven exclusively by stream events with latency telemetry.</li>
          <li><strong>FailureClassifier</strong> (<code className="doc-code">src/core/lifecycle/failure-classifier.ts</code>):pure function: typed <code className="doc-code">Result&lt;T, ClassifiedFailure&gt;</code> in, one of four classification labels out (<code className="doc-code">expired_blockhash</code>, <code className="doc-code">fee_too_low</code>, <code className="doc-code">compute_exceeded</code>, <code className="doc-code">bundle_failure</code>); never throws.</li>
          <li><strong>AgentLoop</strong> (<code className="doc-code">src/agent/agent-loop.ts</code>):episodic retry coordinator; calls <code className="doc-code">ObservationBuilder</code> → <code className="doc-code">LlmProvider</code> → <code className="doc-code">Guardrails</code> → <code className="doc-code">DecisionExecutor</code> per failure; respects <code className="doc-code">maxRetries</code> hard stop.</li>
          <li><strong>EvidenceLogger</strong> (<code className="doc-code">src/core/evidence/evidence-log.ts</code>):append-only JSONL writer; fires <code className="doc-code">onAppend</code> callback (web streaming seam) after schema validation + file write.</li>
        </ul>
      </section>

      <section className="doc-section">
        <h2 className="doc-h2">3. Data Flow</h2>
        <p className="doc-body">
          At runtime, the Orchestrator consumes the <code className="doc-code">LifecycleStream</code> in a{" "}
          <code className="doc-code">for await</code> loop. For each slot-advance event, it checks the leader
          schedule and builds a bundle at the target leader window. The <code className="doc-code">JitoClient</code>{" "}
          submits to the Frankfurt Jito Block Engine. The <code className="doc-code">LifecycleTracker</code> records
          each commitment stage transition as the stream confirms progress. When a failure is classified, the{" "}
          <code className="doc-code">ObservationBuilder</code> packages the context (failure type, tip market data,
          prior attempts, guardrail state, no private keys, no wallet addresses, NFR4) and the{" "}
          <code className="doc-code">LlmProvider</code> returns a structured decision. The{" "}
          <code className="doc-code">DecisionExecutor</code> validates the decision against guardrails and acts.
          Every event at every stage is appended to the evidence log.
        </p>
        <MermaidDiagram id="diag-data-flow" definition={DATA_FLOW_MMD} title="Runtime data flow" />
      </section>

      <section className="doc-section">
        <h2 className="doc-h2">4. Lifecycle State Machine</h2>
        <p className="doc-body">
          Each bundle is an independent state machine. The happy path is{" "}
          <code className="doc-code">submitted → processed → confirmed → finalized</code>. Failures exit
          the machine early; the agent decision executor can re-enter at <code className="doc-code">submitted</code>{" "}
          (refresh or adjust_tip actions trigger a new bundle with a fresh blockhash). The state machine is
          declared in one transition map; illegal transitions throw (they are programmer errors, not operational
          failures).
        </p>
        <MermaidDiagram id="diag-lifecycle-states" definition={LIFECYCLE_STATES_MMD} title="Per-bundle lifecycle state machine" />
      </section>

      <section className="doc-section">
        <h2 className="doc-h2">5. Agent Episode Loop</h2>
        <p className="doc-body">
          When a failure is classified, the agent opens an episode. The{" "}
          <code className="doc-code">ObservationBuilder</code> assembles a structured prompt containing only
          public data: failure classification, blockhash age, current slot, next leader window, tip market
          percentiles (EMA p50, p75, p95), prior attempt history, and remaining guardrail budget. The LLM
          returns <code className="doc-code">{"{ diagnosis, action, rationale, newTipLamports? }"}</code> plus a
          thinking trace (FR21). Guardrails clamp the tip to the configured band and log any overrides. The
          decision executor acts: <code className="doc-code">refresh</code> fetches a fresh blockhash and
          resubmits; <code className="doc-code">adjust_tip</code> rebuilds with a new tip;{" "}
          <code className="doc-code">hold</code> waits; <code className="doc-code">abort</code> ends the episode.
          The agent never holds a connection, keypair, or transaction; it is a pure decision module (NFR3).
        </p>
        <MermaidDiagram id="diag-agent-episode" definition={AGENT_EPISODE_LOOP_MMD} title="Agent episode loop" />
      </section>

      <section className="doc-section">
        <h2 className="doc-h2">6. Infrastructure Decisions</h2>
        <p className="doc-body">
          <strong>Why mainnet?</strong> Jito&apos;s Block Engine has no devnet endpoint; it exists on mainnet
          and testnet only (verified via API, documented in{" "}
          <code className="doc-code">docs/jito-documentation.md</code>). The bounty §6 permits &ldquo;devnet or
          mainnet&rdquo;; the Jito bundle requirement (the core graded deliverable) forces mainnet. This is
          not a workaround; §6 is satisfied directly. SolInfra Ace provides production gRPC (hosted Yellowstone,
          Frankfurt co-located with the Jito Block Engine), eliminating the need for a local validator.{" "}
          <code className="doc-code">dryRun: true</code> makes development free: the orchestrator builds, signs,
          and tracks bundles through the evidence log without submitting to the network, so all agent and tracker
          logic runs at $0 until the final operator evidence run.
        </p>
      </section>

      <section className="doc-section">
        <h2 className="doc-h2">7. Failure-Handling Strategy</h2>
        <p className="doc-body">
          Failures are first-class events, not exceptions. Every external call returns a typed{" "}
          <code className="doc-code">Result&lt;T, ClassifiedFailure&gt;</code>: failures flow to the classifier,
          then to the agent, then to the evidence log. The classifier is a pure function (unit-tested,
          deterministic); classification is never delegated to the LLM. The agent diagnoses and decides; it
          never classifies. Guardrails clamp the agent&apos;s output to configured bounds (tip band, retry
          limit) and log any overrides; the agent has authority within policy, not above it. The four failure
          classes (<code className="doc-code">expired_blockhash</code>,{" "}
          <code className="doc-code">fee_too_low</code>,{" "}
          <code className="doc-code">compute_exceeded</code>,{" "}
          <code className="doc-code">bundle_failure</code>) match the four recovery strategies (
          <code className="doc-code">refresh</code>, <code className="doc-code">adjust_tip</code>,{" "}
          <code className="doc-code">hold</code>, <code className="doc-code">abort</code>) in a deliberate 1:1
          mapping that judges can trace through the evidence log.
        </p>
      </section>

      <section className="doc-section">
        <h2 className="doc-h2">8. Cost-Bounded Dual-Transport Architecture</h2>
        <p className="doc-body">
          Two adapters, one event union, zero core changes to switch. The{" "}
          <code className="doc-code">LifecycleStream</code> consumer (the Orchestrator) is transport-agnostic
          by construction; it iterates <code className="doc-code">LifecycleEvent</code> values regardless of
          source. Switching from the mainnet gRPC adapter to the mainnet WS adapter is a single config key
          change (<code className="doc-code">profile: &quot;mainnet-grpc&quot;</code> →{" "}
          <code className="doc-code">&quot;mainnet-ws&quot;</code>). This was operationally proven during
          development: the <code className="doc-code">mainnet-ws</code> profile (mainnet-beta WebSocket for slot
          streaming, SolInfra RPC for leader schedule and signature status, Frankfurt Jito for submission) ran
          the full committed evidence session when SolInfra&apos;s gRPC streaming hit a server-side
          concurrent-stream limit. Network parity holds either way: the stream network equals the submission
          network (mainnet), and landing is confirmed via live <code className="doc-code">signatureSubscribe</code>{" "}
          stream subscriptions, never RPC polling alone. <code className="doc-code">dryRun</code> is the third leg
          of cost control: it forces a zero-spend path through every code branch except the final{" "}
          <code className="doc-code">sendBundle</code> call, so the entire stack (stream, leader detection,
          bundle building, agent loop, evidence logging) was exercised on production infrastructure before a
          single lamport was spent.
        </p>
      </section>

      <p className="doc-footer">
        ← <Link href="/readme">README &amp; Setup</Link>
      </p>
    </div>
  );
}
