// components/flow/agent-drawer.tsx
//
// The agent reasoning drawer (progressive depth, AC4). A right panel + scrim that
// dims the main view. Carries the diagnosis, the decision chip, the observation
// key-values, and the full thinking trace — ALL from the agentDecision event
// (AC3). Fully keyboard-operable (AC8): focus moves in on open, is trapped while
// open, Esc / × / scrim-click all close, and the page returns focus to the
// trigger. Closing is handled by the parent (it owns the trigger ref).
//
// Every field maps 1:1 to evidence:
//   diagnosis     ← decision.diagnosis / observation.failure.classification
//   decision chip ← decision.action (+ newTipLamports delta when present)
//   kv grid       ← observation (tip floor p75, blockhash age, next leader window)
//   thinking      ← agentDecision.thinkingTrace

"use client";

import { useEffect, useRef } from "react";
import type { DepthMode } from "@/lib/depth-mode";
import type { AgentEpisode } from "@/lib/lifecycle-state";

interface AgentDrawerProps {
  episode: AgentEpisode;
  mode: DepthMode;
  onClose: () => void;
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

/** Split a "Step 1: … Step 2: …" trace into lines for readable rendering. */
function traceLines(trace: string): string[] {
  const parts = trace.split(/(?=Step \d+:)/).map((s) => s.trim()).filter((s) => s !== "");
  return parts.length > 0 ? parts : [trace];
}

export function AgentDrawer({ episode, mode, onClose }: AgentDrawerProps) {
  const asideRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  // Move focus into the drawer on open; trap Tab; Esc closes.
  useEffect(() => {
    closeRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const root = asideRef.current;
      if (!root) return;
      const focusable = root.querySelectorAll<HTMLElement>(
        'button, [href], summary, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  const obs = episode.observation;
  const dec = episode.decision;
  const attemptsRemaining = obs?.guardrails.attemptsRemaining;
  const delta =
    episode.newTipLamports !== undefined && obs?.myLastTipLamports !== undefined
      ? `${fmt(obs.myLastTipLamports)} → ${fmt(episode.newTipLamports)} lamports`
      : episode.newTipLamports !== undefined
        ? `${fmt(episode.newTipLamports)} lamports`
        : undefined;

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} aria-hidden="true" />
      <div
        ref={asideRef}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`Agent reasoning for bundle ${shortId(episode.bundleId)}`}
      >
        <div className="dh">
          <span className="t mono">AGENT · BUNDLE {shortId(episode.bundleId)}</span>
          <button ref={closeRef} type="button" className="drawer-x" onClick={onClose} aria-label="Close reasoning">
            ×
          </button>
        </div>
        <div className="att mono">
          attempt {episode.attempt}
          {attemptsRemaining !== undefined ? ` · ${attemptsRemaining} retries left` : ""}
        </div>

        {dec?.rationale ? <p className="say">{dec.rationale}</p> : null}

        {obs ? (
          <div className="kv">
            <div className="o">
              <div className="k">diagnosis</div>
              <div className="v am">{episode.classification ?? episode.diagnosis}</div>
            </div>
            <div className="o">
              <div className="k">tip floor p75</div>
              <div className="v">{fmt(obs.tipMarket.floorPercentiles.p75)}</div>
            </div>
            <div className="o">
              <div className="k">blockhash age</div>
              <div className="v am">{fmt(obs.blockhashAgeSlots)} slots</div>
            </div>
            <div className="o">
              <div className="k">next leader window</div>
              <div className="v">{fmt(obs.leader.slotsUntilNextTargetWindow)} slots</div>
            </div>
          </div>
        ) : null}

        <div className="dec">
          <div>
            <span className="a mono">{dec?.action ?? episode.action}</span>
            {delta ? (
              <>
                <span className="x2">→</span>
                <span className="d mono">{delta}</span>
              </>
            ) : null}
          </div>
          {dec?.rationale ? (
            <div className="why">Chosen from live conditions, not a script — the same fault on a quieter market can produce a different call.</div>
          ) : null}
        </div>

        <details className="trace-wrap" open={mode === "technical"}>
          <summary className="trh">Thinking trace</summary>
          <div className="trace mono">
            {traceLines(episode.thinkingTrace).map((line, i) => (
              <div key={i}>
                <span className="q" aria-hidden="true">
                  ›
                </span>{" "}
                {line}
              </div>
            ))}
          </div>
        </details>

        <p className="verify">
          Sourced from <span className="mono">evidence/lifecycle-log.jsonl</span> · verify on a Solana explorer ↗
        </p>
      </div>
    </>
  );
}
