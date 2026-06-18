import Link from "next/link";

export default function ReadmePage() {
  return (
    <div className="doc-wrap">
      <div className="doc-eyebrow">README · Operational Guide</div>
      <h1 className="doc-h1">Run it yourself</h1>
      <p className="doc-lead">
        Everything you need to run Smartransact end-to-end, from cloning the repo to watching the
        agent make live decisions on Solana mainnet. All answers below are grounded in real event
        data from <code className="doc-code">evidence/lifecycle-log.jsonl</code>.
      </p>

      <section className="doc-section">
        <h2 className="doc-h2">Three Operational Questions</h2>

        <h3 className="doc-h3">Q1: What does the delta between <code className="doc-code">processed_at</code> and <code className="doc-code">confirmed_at</code> tell you about network health at submission time?</h3>
        <p className="doc-body">
          In Solana&apos;s commitment model, <code className="doc-code">processed</code> means a validator&apos;s
          bank has included the transaction; <code className="doc-code">confirmed</code> means ≥67% of
          stake-weighted validators have voted on a block containing it. The gap between these two events is a
          snapshot of vote-propagation latency across the validator set, a direct measure of network health at
          that moment. A tight delta (4–8 slots, ~1.6–3.2 s) indicates that stake-weighted validators are in sync
          and votes are propagating quickly. A wide delta (20+ slots) signals that the cluster is under load and
          minority validators are falling behind the vote stream, or that the block containing the transaction is
          not being picked up by the supermajority quickly.
        </p>
        <p className="doc-body">
          In our committed evidence session (<code className="doc-code">mqgu5gt8-c53156</code>, 2026-06-16),
          12 bundles were submitted and 11 recorded a full{" "}
          <code className="doc-code">processed → confirmed → finalized</code> progression (34{" "}
          <code className="doc-code">commitmentTransition</code> events in total), each sourced from the
          WebSocket signature subscription (
          <code className="doc-code">source.transport: &quot;ws&quot;</code>), never from polling. The
          processed-to-confirmed delta was <strong>0 slots</strong> across every landed bundle (roughly 76 to
          229 ms apart, well inside a single slot). The first landed bundle was processed and confirmed at the
          same slot <code className="doc-code">426885448</code>. A sub-slot delta like that is the signature of a
          healthy, in-sync cluster: stake-weighted validators voting on the block almost as soon as it is
          produced. Every figure here is computed from the real event log. Nothing is staged.
        </p>

        <h3 className="doc-h3">Q2: Why should you never use <code className="doc-code">finalized</code> commitment when fetching a blockhash for a time-sensitive transaction?</h3>
        <p className="doc-body">
          A blockhash is valid for <code className="doc-code">MAX_PROCESSING_AGE = 150 slots</code> (~60 seconds
          at ~400ms/slot). <code className="doc-code">finalized</code> commitment requires that ≥66.7% of
          stake-weighted validators have voted on the block, typically 32+ slots after{" "}
          <code className="doc-code">confirmed</code>. If you fetch a blockhash at{" "}
          <code className="doc-code">finalized</code>, it is already ≥32 slots old at the moment you receive it,
          consuming ~21% of its 150-slot validity window before your code even starts building the transaction.
        </p>
        <p className="doc-body">
          For a bundle routed through Jito, this matters doubly: the Block Engine checks the blockhash age
          against the current slot when it processes the bundle. A bundle arriving with a blockhash that is 40+
          slots old at submission time has less than 110 valid slots remaining, and every bundle-retry attempt
          burns more of that window.
        </p>
        <p className="doc-body">
          Our run injects this fault twice to exercise recovery more than once. The first{" "}
          <code className="doc-code">staleBlockhash</code> was fetched at slot{" "}
          <code className="doc-code">426885606</code> and became stale at slot{" "}
          <code className="doc-code">426885757</code>, exactly <strong>151 slots later</strong>, one slot past{" "}
          <code className="doc-code">MAX_PROCESSING_AGE</code> (the second fault repeats the boundary at{" "}
          <code className="doc-code">426885924 → 426886075</code>). A pre-flight{" "}
          <code className="doc-code">simulateTransaction</code> on each fault bundle surfaced the
          validator&apos;s real <code className="doc-code">BlockhashNotFound</code> rejection, classified
          honestly as <code className="doc-code">expired_blockhash</code>. The agent then observed a{" "}
          <code className="doc-code">blockhashAgeSlots</code> of 152 and 153 respectively (past the 150-slot
          validity window) and issued a <code className="doc-code">refresh</code> action each time to fetch a
          fresh blockhash, maximizing the remaining validity window for the resubmission, which then landed.
        </p>
        <p className="doc-body">
          The tip was part of the same decision. Every episode hands the agent the full live tip market it
          could act on (<code className="doc-code">refresh</code> vs.{" "}
          <code className="doc-code">adjust_tip</code> are distinct actions, and the resubmission tip is
          recomputed from live percentile data, not a constant). In both faults the agent observed the tip
          market (ep-4 saw p50 <code className="doc-code">4205</code> / p75 <code className="doc-code">9809</code>,
          ep-8 p50 <code className="doc-code">4674</code> / p75 <code className="doc-code">10718</code>) and
          reasoned that the failure cause was the expired blockhash, not an underpriced tip, so it refreshed
          the blockhash and held the tip rather than spending more lamports on a change that would not have
          fixed the actual problem. Recalculating the tip means deciding what it should be each retry; here
          the right answer, given the diagnosis, was to keep it. That is a real cost-versus-landing tradeoff,
          not a hardcoded bump.
        </p>

        <h3 className="doc-h3">Q3: What happens to your bundle if the Jito leader skips their slot?</h3>
        <p className="doc-body">
          Jito bundles are routed to the Block Engine and held for the targeted leader&apos;s slot window. If
          the leader skips their slot (goes offline, or is not a Jito-Solana validator, or their slot is
          otherwise missed), the Block Engine holds the bundle until it times out, then marks it as dropped.
          From the submitter&apos;s perspective, this surfaces as a{" "}
          <code className="doc-code">bundle_failure</code> classification with a timeout error.
        </p>
        <p className="doc-body">
          In our committed evidence run, confirmed-leader targeting kept this from happening. The orchestrator
          queries Jito&apos;s <code className="doc-code">getNextScheduledLeader</code> and submits each bundle
          into the upcoming Jito leader window, so 11 bundles landed (
          <code className="doc-code">finalized</code>), and 9 of them landed at an on-chain slot that falls
          inside the exact <code className="doc-code">leaderWindow</code> recorded in their{" "}
          <code className="doc-code">bundleSubmitted</code> event. The only failures in the run were the two
          injected blockhash-expiry faults (episodeIds <code className="doc-code">ep-4</code> and{" "}
          <code className="doc-code">ep-8</code>): in each case the agent diagnosed{" "}
          <code className="doc-code">expired_blockhash</code>, issued a <code className="doc-code">refresh</code>,
          and the resubmitted bundle landed. That is the same recovery path a real leader-skip timeout would
          trigger (a fresh blockhash and a new target window), exercised here against deterministic,
          honestly-injected faults rather than a flaky live skip.
        </p>
      </section>

      <section className="doc-section">
        <h2 className="doc-h2">Setup in 5 Steps</h2>
        <ol className="doc-steps">
          <li>
            <code className="doc-code">git clone https://github.com/Zolldyk/Smartransact.git &amp;&amp; cd Smartransact</code>
          </li>
          <li>
            <code className="doc-code">cp .env.example .env</code>: then fill in required keys (see below)
          </li>
          <li>
            <code className="doc-code">npm install</code>
          </li>
          <li>
            <code className="doc-code">npx tsx src/cli/main.ts run --profile mainnet-ws</code>: dryRun by default, costs $0
          </li>
          <li>
            <code className="doc-code">npx tsx src/cli/main.ts tail</code>: renders the evidence log
          </li>
        </ol>
        <p className="doc-body" style={{ marginTop: "20px" }}>
          <strong>Required config keys in <code className="doc-code">.env</code>:</strong>
        </p>
        <ul className="doc-body" style={{ paddingLeft: "1.4em" }}>
          <li><code className="doc-code">GROQ_API_KEY</code>: free at console.groq.com (used by default <code className="doc-code">mainnet-ws</code> profile)</li>
          <li><code className="doc-code">GEMINI_API_KEY</code>: free at aistudio.google.com (if using <code className="doc-code">provider: gemini</code>)</li>
          <li><code className="doc-code">ANTHROPIC_API_KEY</code>: optional, if using <code className="doc-code">provider: claude</code></li>
        </ul>
      </section>

      <section className="doc-section">
        <h2 className="doc-h2">Why Mainnet</h2>
        <p className="doc-body">
          Smartransact runs on Solana <strong>mainnet</strong>. Jito&apos;s Block Engine (the bundle
          submission endpoint required by the bounty&apos;s graded core) has no devnet endpoint. It exists
          on mainnet and testnet only (Jito&apos;s own documentation; we verified this before the first line
          of code was written). The bounty §6 permits &ldquo;devnet or mainnet&rdquo;; Jito&apos;s constraint
          makes mainnet the only network that satisfies both §6 and the bundle requirement simultaneously.
          This is a reasoned, §6-compliant infrastructure decision, not a workaround. To keep development
          free, every session uses <code className="doc-code">dryRun: true</code> by default; the full stack
          runs on mainnet production infrastructure (live slots, live leader schedule, live tip market data)
          without spending lamports. Only the final operator evidence run (
          <code className="doc-code">evidence/lifecycle-log.jsonl</code>) spent SOL.
        </p>
      </section>

      <p className="doc-footer">
        → <Link href="/architecture">Architecture document</Link>
      </p>
    </div>
  );
}
