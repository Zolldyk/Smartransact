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
