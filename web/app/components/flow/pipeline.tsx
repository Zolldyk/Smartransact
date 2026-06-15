// components/flow/pipeline.tsx
//
// The transaction-flow pipeline centerpiece (AC1): the 5 stages Package → Aim →
// Send → Track → Landed, floated on the canvas with FlowConnectors between them
// and the Landed terminal at the end. The 4 process stages are an ordered,
// labeled <ol> so assistive tech reads "Step 3 of 5: Send it — in progress"
// (AC8); the Landed terminal is the 5th step.
//
// Dumb: every status / value comes from the reducer's LiveState (AC3). The single
// clay glow is whichever stage is `live`. In Basic the cards show plain language;
// in Technical they add a mono on-chain data line — the GEOMETRY is identical in
// both modes (AC2). The Landed terminal stays UNLIT until a real
// commitmentTransition:finalized lights it — never a fabricated green ✓.

import { Fragment, type ReactNode } from "react";
import { STAGE_COPY, type DepthMode } from "@/lib/depth-mode";
import { STAGE_ORDER, type LiveState, type StageId } from "@/lib/lifecycle-state";
import { StageCard } from "./stage-card";
import { FlowConnector } from "./flow-connector";
import { CommitPip } from "./commit-pip";

const STAGE_ICONS: Record<StageId, ReactNode> = {
  package: (
    <svg viewBox="0 0 24 24">
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M4 9h16" />
    </svg>
  ),
  aim: (
    <svg viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  ),
  send: (
    <svg viewBox="0 0 24 24">
      <path d="M21 3L11 13" />
      <path d="M21 3l-6 18-4-8-8-4 18-6z" />
    </svg>
  ),
  track: (
    <svg viewBox="0 0 24 24">
      <path d="M5 12l4 4 10-10" />
    </svg>
  ),
  landed: null,
};

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

/** Mono on-chain data line for a stage — Technical mode only, event-backed only. */
function dataLine(stage: StageId, state: LiveState): ReactNode {
  switch (stage) {
    case "package":
      return state.inputs.tipLamports !== undefined ? `tip ${fmt(state.inputs.tipLamports)} lamports` : undefined;
    case "aim":
      return state.inputs.leaderWindow
        ? `slots ${fmt(state.inputs.leaderWindow.startSlot)}–${fmt(state.inputs.leaderWindow.endSlot)}`
        : undefined;
    case "send":
      return state.currentBundleId ? `bundle ${shortId(state.currentBundleId)}` : undefined;
    case "track": {
      const { processed, confirmed, finalized } = state.pips;
      if (finalized) return "finalized";
      if (confirmed) return "confirmed";
      if (processed) return "processed";
      return undefined;
    }
    default:
      return undefined;
  }
}

interface PipelineProps {
  state: LiveState;
  mode: DepthMode;
}

const PROCESS_STAGES = STAGE_ORDER.slice(0, 4) as StageId[]; // package, aim, send, track
const TOTAL = STAGE_ORDER.length; // 5

export function Pipeline({ state, mode }: PipelineProps) {
  const copy = STAGE_COPY[mode];
  const landedStatus = state.stages.landed;
  const landedDone = landedStatus === "done";

  return (
    <div className="pipe" role="list" aria-label="Transaction lifecycle stages">
      {PROCESS_STAGES.map((stage, i) => {
        const status = state.stages[stage];
        return (
          <Fragment key={stage}>
            <StageCard
              index={i + 1}
              total={TOTAL}
              status={status}
              title={copy[stage].title}
              description={copy[stage].description}
              icon={STAGE_ICONS[stage]}
              dataLine={mode === "technical" ? dataLine(stage, state) : undefined}
              footer={
                stage === "track" ? (
                  <CommitPip pips={state.pips} submitted={state.bundleSubmittedSeen} trackLive={status === "live"} />
                ) : undefined
              }
            />
            <FlowConnector live={status === "live"} />
          </Fragment>
        );
      })}

      {/* Landed terminal — the 5th step. Stays unlit until a real finalized event. */}
      <div
        className={landedDone ? "landed done" : "landed"}
        role="listitem"
        aria-label={`Step 5 of 5: ${copy.landed.title} — ${landedDone ? "done" : "not yet — no landing event"}`}
      >
        <div className={landedDone ? "ring done" : "ring"} aria-hidden="true">
          {landedDone ? "✓" : ""}
        </div>
        <b>{copy.landed.title}</b>
        {landedDone ? (
          <span className="mono">{state.inputs.latestSlot !== undefined ? fmt(state.inputs.latestSlot) : "on-chain"}</span>
        ) : (
          <span className="landed-wait">{mode === "technical" ? "no commitmentTransition yet" : "not yet"}</span>
        )}
      </div>
    </div>
  );
}
