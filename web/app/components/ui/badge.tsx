// Badge — the dryRun-safe affordance (sage soft pill, lock glyph). DESIGN.md ›
// Components / Badge. Persistent on the anonymous session (AC5).
import type { ReactNode } from "react";

export function DryRunSafeBadge() {
  return (
    <span className="badge-safe" role="status">
      <span aria-hidden="true">🔒</span>
      <span>
        <b>dryRun</b> — safe mode, no SOL spent
      </span>
    </span>
  );
}

export function Badge({ children }: { children: ReactNode }) {
  return <span className="badge-safe">{children}</span>;
}

/** Provenance badge for the auto-played committed run (AC7) — clay, "this is the
 * real thing" framing. Distinct from the sage dryRun-safe badge so the two views
 * (committed replay vs your own dryRun session) are never confused. */
export function RealMainnetRunBadge() {
  return (
    <span className="badge-real" role="status">
      <span aria-hidden="true">◆</span>
      <span>
        <b>REAL MAINNET RUN</b> — replayed from the evidence log
      </span>
    </span>
  );
}
