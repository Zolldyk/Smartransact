// components/flow/stage-card.tsx
//
// One pipeline stage card (Package / Aim / Send / Track). Dumb: it renders the
// status it's handed — all derivation lives in the reducer (lifecycle-state.ts).
// The `.focus` variant is the SINGLE clay glow per view (only the live stage).
// Status is conveyed by label + SHAPE + an sr-only phrase, never color alone
// (AC8). Each card is a list item exposing "Step N of 5: <title> — <status>".

import type { ReactNode } from "react";
import type { StageStatus } from "@/lib/lifecycle-state";

const STATUS_PHRASE: Record<StageStatus, string> = {
  pending: "waiting",
  live: "in progress",
  done: "done",
  fault: "needs recovery",
};

interface StageCardProps {
  index: number; // 1-based
  total: number;
  status: StageStatus;
  title: string;
  description: string;
  /** Mono on-chain data line (Technical mode only). */
  dataLine?: ReactNode;
  /** SVG icon for the stage. */
  icon: ReactNode;
  /** Footer slot (e.g. commit pips on the Track stage). */
  footer?: ReactNode;
}

export function StageCard({ index, total, status, title, description, dataLine, icon, footer }: StageCardProps) {
  const cls =
    status === "live" ? "stage focus" : status === "done" ? "stage done" : status === "fault" ? "stage fault" : "stage";
  return (
    <div className={cls} role="listitem" aria-label={`Step ${index} of ${total}: ${title} — ${STATUS_PHRASE[status]}`}>
      <span className="step-n mono" aria-hidden="true">
        {String(index).padStart(2, "0")}
      </span>
      <span className="stage-ico" aria-hidden="true">
        {icon}
      </span>
      <h3>{title}</h3>
      <div className="stage-d">{description}</div>
      {/* shape + word status for AT and reduced-color users */}
      <span className="sr-only">Status: {STATUS_PHRASE[status]}</span>
      {dataLine ? <div className="stage-data mono">{dataLine}</div> : null}
      {footer}
    </div>
  );
}
