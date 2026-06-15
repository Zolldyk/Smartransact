// components/flow/commit-pip.tsx
//
// The Track-stage commitment dots: submitted · processed · confirmed · finalized
// → "N of 4". Each dot lights ONLY from real evidence (submitted from
// bundleSubmitted, the rest from commitmentTransition) — the honesty rule (AC3):
// the committed run, which carries no commitmentTransition, shows "1 of 4" with
// no live/finalized pip, never a fabricated landing. Status is dot SHAPE +
// the "N of 4" text + an sr-only phrase, not color alone (AC8).

import type { CommitPips } from "@/lib/lifecycle-state";

interface CommitPipProps {
  pips: CommitPips;
  /** Whether the focal bundle has actually been submitted. */
  submitted: boolean;
  /** Whether the Track stage is the live (in-flight) stage. */
  trackLive: boolean;
}

export function CommitPip({ pips, submitted, trackLive }: CommitPipProps) {
  // Dot order mirrors a bundle's life: submitted → processed → confirmed → final.
  const filled = [submitted, pips.processed, pips.confirmed, pips.finalized];
  const count = filled.filter(Boolean).length;
  // The single "live" dot is the first not-yet-filled dot while Track is in-flight.
  const liveIndex = trackLive ? filled.findIndex((f) => !f) : -1;

  return (
    <div className="pips" role="group" aria-label={`Commitment progress: ${count} of 4`}>
      {filled.map((isFilled, i) => {
        const cls = isFilled ? "ok" : i === liveIndex ? "live" : "";
        return <i key={i} className={cls} aria-hidden="true" />;
      })}
      <span className="pl mono">{count} of 4</span>
    </div>
  );
}
