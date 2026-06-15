// components/flow/agent-loop-card.tsx
//
// The agent recovery-band card. The agent is shown as a CALM, factual annotation
// (DESIGN.md Don'ts: never a glowing AI mascot; failure is amber, never red).
// Basic = plain-language "reads why → decides a fix → resends"; Technical =
// the real path classifyFailure → AgentDecision → executeDecision with the
// episode's classification + action + tip delta. "See how it reasoned →" opens
// the reasoning drawer (progressive depth, AC4).

import type { ReactNode } from "react";
import { AGENT_VOICE, type DepthMode } from "@/lib/depth-mode";
import type { AgentEpisode } from "@/lib/lifecycle-state";

interface AgentLoopCardProps {
  mode: DepthMode;
  episode: AgentEpisode | null;
  onOpenReasoning: () => void;
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

/** The three mini-steps, data-driven in Technical and generic in Basic. */
function miniSteps(mode: DepthMode, episode: AgentEpisode | null): [ReactNode, ReactNode, ReactNode] {
  const voice = AGENT_VOICE[mode];
  if (mode === "basic" || !episode) {
    return [voice.steps[0], voice.steps[1], voice.steps[2]];
  }
  const classification = episode.classification ?? episode.diagnosis;
  const lastTip = episode.observation?.myLastTipLamports;
  const delta =
    episode.newTipLamports !== undefined && lastTip !== undefined
      ? `${fmt(lastTip)}→${fmt(episode.newTipLamports)}`
      : undefined;
  return [
    <b key="c">{classification}</b>,
    <>
      {episode.action}
      {delta ? (
        <>
          {" "}
          <b>{delta}</b>
        </>
      ) : null}
    </>,
    voice.steps[2],
  ];
}

export function AgentLoopCard({ mode, episode, onOpenReasoning }: AgentLoopCardProps) {
  const voice = AGENT_VOICE[mode];
  const steps = miniSteps(mode, episode);
  return (
    <div className="agentcard" role="group" aria-label="Agent recovery">
      <span className={mode === "technical" ? "tag mono" : "tag"}>{voice.tag}</span>
      <h3 className={mode === "technical" ? "mono" : undefined}>{voice.headline}</h3>
      <div className="mini">
        <span className={mode === "technical" ? "m mono" : "m"}>{steps[0]}</span>
        <span className="ar" aria-hidden="true">
          →
        </span>
        <span className={mode === "technical" ? "m mono" : "m"}>{steps[1]}</span>
        <span className="ar" aria-hidden="true">
          →
        </span>
        <span className={mode === "technical" ? "m mono" : "m"}>{steps[2]}</span>
      </div>
      <button type="button" className="agent-reason-link" onClick={onOpenReasoning} disabled={!episode}>
        See how it reasoned →
      </button>
    </div>
  );
}
