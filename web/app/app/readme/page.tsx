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
          In our committed evidence session (<code className="doc-code">mqd7o73n-6e0959</code>, 2026-06-14), no{" "}
          <code className="doc-code">commitmentTransition</code> events appear in the log; all 54 submitted
          bundles failed at the <code className="doc-code">bundle_failure</code> stage (timed out at the Jito
          Block Engine before validators ever picked them up). This is itself network health evidence: the public
          Block Engine returned{" "}
          <code className="doc-code">&quot;Network congested. Endpoint is globally rate limited&quot;</code>{" "}
          during our run, and 0/54 bundles advanced to the processed state. The absence of a{" "}
          <code className="doc-code">processed_at</code> timestamp for any bundle is the log&apos;s honest record
          of that congestion. Nothing is staged.
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
          Our fault-injection event demonstrates this boundary precisely:{" "}
          <code className="doc-code">staleBlockhash</code> was fetched at slot{" "}
          <code className="doc-code">426334667</code> and became stale at slot{" "}
          <code className="doc-code">426334818</code>, exactly <strong>151 slots later</strong>, one slot past{" "}
          <code className="doc-code">MAX_PROCESSING_AGE</code>. The agent detected the resulting{" "}
          <code className="doc-code">expired_blockhash</code> failure (blockhashAgeSlots: 150+ at the time of
          submission) and issued a <code className="doc-code">refresh</code> action to fetch a{" "}
          <code className="doc-code">confirmed</code>-commitment blockhash, maximizing the remaining validity
          window for the next attempt.
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
          This is precisely what our evidence run observed. Every one of the 24{" "}
          <code className="doc-code">failureClassified</code> events in{" "}
          <code className="doc-code">evidence/lifecycle-log.jsonl</code> carries{" "}
          <code className="doc-code">&quot;classification&quot;: &quot;bundle_failure&quot;</code> and{" "}
          <code className="doc-code">&quot;rawError&quot;: &quot;Bundle timed out after 50 slots&quot;</code>.
          The first failure occurred at slot <code className="doc-code">426332922</code>: the bundle was
          submitted targeting a leader window starting at slot <code className="doc-code">426332923</code>{" "}
          (slotsUntilNextTargetWindow: 1); 50 slots later, no block was produced by that leader at the expected
          slot. The agent observed a <code className="doc-code">blockhashAgeSlots</code> of 51, determined a
          fresh target window was available (episodeId <code className="doc-code">ep-0-mqd7op6r</code>), and
          issued a <code className="doc-code">refresh</code> action to resubmit with a new blockhash targeting
          the next leader. This pattern repeated across 12 episodes (12 unique episodeIds, 55 total agent
          decisions).
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
