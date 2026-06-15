"use client";

// /live — THE CENTERPIECE (story 8.3). The transaction-flow pipeline, the agent
// recovery loop + reasoning drawer, and the global Basic⇄Technical depth toggle —
// all driven ENTIRELY by the evidence-event stream (AC3), through the single
// sanctioned reducer (lib/lifecycle-state.ts).
//
// Two sources, one code path (AC7): with a pending Run hand-off → the LIVE WS
// source (your dryRun session, dryRun-safe badge); otherwise → the REPLAY source
// (the committed real mainnet run, auto-played, "REAL MAINNET RUN" badge). The
// two are never confused. Honest empty/sparse states throughout (AC8): a dryRun
// session emits only sessionStarted→sessionEnded; the committed run carries no
// landing — and we render exactly that, fabricating nothing.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { takePendingSession } from "@/lib/pending-session";
import { openSession, type ConnectionState, type SessionHandle } from "@/lib/session-client";
import { makeReplaySource, type EvidenceSource } from "@/lib/replay-source";
import { parseEvidenceEvent } from "@/lib/evidence-events";
import { initialLiveState, latestEpisode, reduceEvidence, type LiveState } from "@/lib/lifecycle-state";
import { INPUT_COPY, useDepthMode, type DepthMode } from "@/lib/depth-mode";
import { DryRunSafeBadge, RealMainnetRunBadge } from "@/components/ui/badge";
import { SegmentedToggle } from "@/components/ui/segmented-toggle";
import { Gloss } from "@/components/ui/gloss";
import { Pipeline } from "@/components/flow/pipeline";
import { InputPill } from "@/components/flow/input-pill";
import { AgentLoopCard } from "@/components/flow/agent-loop-card";
import { AgentDrawer } from "@/components/flow/agent-drawer";

const DEPTH_OPTIONS = [
  { value: "basic" as const, label: "Basic" },
  { value: "technical" as const, label: "Technical" },
];

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

/** Plain-language (Basic) / data (Technical) caption — derived from state only. */
function caption(state: LiveState, mode: DepthMode, provenance: "live" | "replay"): ReactNode {
  if (!state.sessionStarted) {
    return mode === "technical" ? "Opening the evidence stream…" : "Connecting to mainnet…";
  }
  // dryRun terminal: a user session that submitted nothing (locked 8.1 contract).
  if (state.sessionEnded && !state.bundleSubmittedSeen) {
    return mode === "technical" ? (
      <>
        <span className="mono">dryRun</span> session — <span className="mono">sessionStarted → sessionEnded</span>, no{" "}
        <span className="mono">bundleSubmitted</span> (safe mode, no SOL).
      </>
    ) : (
      "Safe mode — this run prepared a transaction but submitted nothing (no SOL spent)."
    );
  }
  if (state.landed) {
    return mode === "technical"
      ? "Finalized — a real commitmentTransition lit the Landed stage."
      : "It landed — confirmed and final on-chain.";
  }
  if (state.recoveryActive || provenance === "replay") {
    return mode === "technical" ? (
      <>
        Submitted &amp; retried under live congestion — the agent ran{" "}
        <span className="mono">classifyFailure → AgentDecision → executeDecision</span> each time. No{" "}
        <span className="mono">commitmentTransition</span> yet: a confirmed landing needs Jito searcher access (see Evidence). Nothing here is staged.
      </>
    ) : (
      <>
        The transaction was sent and retried under live congestion — each time one attempt failed (an expired{" "}
        <Gloss term="blockhash">freshness stamp</Gloss>), the agent diagnosed it and re-decided. A confirmed landing needs Jito searcher
        access — so the Landed step stays honestly unlit. <b>Nothing here is staged.</b>
      </>
    );
  }
  return mode === "technical" ? "Streaming evidence…" : "Sending the transaction…";
}

export default function LivePage() {
  const { mode, setMode } = useDepthMode();
  const [overrides] = useState(() => takePendingSession());
  const provenance: "live" | "replay" = overrides ? "live" : "replay";

  const [state, setState] = useState<LiveState>(initialLiveState);
  const [conn, setConn] = useState<ConnectionState>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);

  // Build the source once: live (WS) when launched from Run, else committed replay.
  const source = useMemo<EvidenceSource>(() => {
    if (overrides) {
      return { provenance: "live", open: (handlers) => openSession(overrides, handlers) };
    }
    return makeReplaySource();
  }, [overrides]);

  useEffect(() => {
    setState(initialLiveState);
    const handle: SessionHandle = source.open({
      onState: setConn,
      onEvent: (raw) => {
        const parsed = parseEvidenceEvent(raw);
        if (parsed) setState((prev) => reduceEvidence(prev, parsed));
      },
      onError: (msg) => setError(msg),
    });
    return () => handle.close();
  }, [source]);

  const episode = latestEpisode(state);

  function openDrawer() {
    triggerRef.current = (typeof document !== "undefined" ? (document.activeElement as HTMLElement) : null) ?? null;
    setDrawerOpen(true);
  }
  function closeDrawer() {
    setDrawerOpen(false);
    triggerRef.current?.focus();
  }

  const inputCopy = INPUT_COPY[mode];
  const showInputValue = mode === "technical";

  return (
    <div className="flow-wrap">
      <div className="flow-head">
        <div>
          <div className="eyebrow">The transaction stack · live</div>
          <h1 className="flow-h1">
            {mode === "technical" ? "Bundle lifecycle, on mainnet" : "Watch a transaction move through Solana"}
          </h1>
          <p className="flow-sub">
            {mode === "technical"
              ? "Real terms, on-chain data, and the agent’s decision path."
              : "Follow it through every stage — and watch the agent step in when one fails."}
          </p>
        </div>
        <div className="flow-toggle">
          <span className="seg-pre" aria-hidden="true">
            view
          </span>
          <SegmentedToggle options={DEPTH_OPTIONS} value={mode} onChange={setMode} ariaLabel="Explanation depth" />
        </div>
      </div>

      <div className="flow-prov">
        {provenance === "replay" ? <RealMainnetRunBadge /> : <DryRunSafeBadge />}
      </div>

      {/* live-input chips feeding the pipeline */}
      <div className="inputs" aria-label="Live inputs">
        <span className="il">live inputs</span>
        <InputPill
          label={inputCopy.network}
          value={showInputValue && state.inputs.latestSlot !== undefined ? `slot ${fmt(state.inputs.latestSlot)}` : undefined}
        />
        <InputPill
          label={inputCopy.leader}
          value={
            showInputValue && state.inputs.leaderWindow
              ? `${fmt(state.inputs.leaderWindow.startSlot)}–${fmt(state.inputs.leaderWindow.endSlot)}`
              : undefined
          }
        />
        <InputPill
          label={inputCopy.tip}
          value={showInputValue && state.inputs.tipLamports !== undefined ? `${fmt(state.inputs.tipLamports)} lamports` : undefined}
        />
        <span className="feed" aria-hidden="true" />
      </div>

      {conn === "connecting" && !state.sessionStarted ? (
        <p className="flow-connecting" role="status">
          <span className="conn-dot connecting" aria-hidden="true" /> connecting…
        </p>
      ) : null}

      <Pipeline state={state} mode={mode} />

      {/* agent recovery band — only when a real failure activated it */}
      {state.recoveryActive ? (
        <div className="recovery-outer">
          <span className="faillabel r" aria-hidden="true">
            ↘ {mode === "technical" ? "!ok" : "if it fails"}
          </span>
          <div className="recovery">
            <svg className="loop" viewBox="0 0 1152 184" preserveAspectRatio="none" aria-hidden="true">
              <path d="M760 0 C760 34 720 46 600 46" />
              <path className="ah" d="M604 41 l-10 5 l10 5 z" />
              <path d="M552 138 C420 138 300 128 300 30" />
              <path className="ah" d="M295 34 l5 -10 l5 10 z" />
            </svg>
            <AgentLoopCard mode={mode} episode={episode} onOpenReasoning={openDrawer} />
          </div>
          <span className="faillabel l" aria-hidden="true">
            ↻ {mode === "technical" ? "resubmit" : "resend"}
          </span>
        </div>
      ) : null}

      {error ? (
        <p className="flow-error" role="alert">
          {error}
        </p>
      ) : null}

      <p className="caption" aria-live="polite">
        {caption(state, mode, provenance)}
      </p>

      <div className="foot">
        <span>
          Real Solana mainnet ·{" "}
          <a href="https://explorer.solana.com" target="_blank" rel="noreferrer">
            verify every step on an explorer ↗
          </a>
        </span>
        <span className="foot-sep" aria-hidden="true">
          ·
        </span>
        <span>
          switch to{" "}
          <button type="button" className="foot-link" onClick={() => setMode(mode === "basic" ? "technical" : "basic")}>
            {mode === "basic" ? "Technical" : "Basic"}
          </button>{" "}
          for {mode === "basic" ? "slots, tips & the agent’s full reasoning" : "the plain-language walkthrough"}
        </span>
      </div>

      <div className="foot-cta">
        <Link href="/run" className="btn-ghost">
          Run your own →
        </Link>
        <Link href="/evidence" className="btn-ghost">
          Explore the evidence →
        </Link>
      </div>

      {drawerOpen && episode ? <AgentDrawer episode={episode} mode={mode} onClose={closeDrawer} /> : null}
    </div>
  );
}
