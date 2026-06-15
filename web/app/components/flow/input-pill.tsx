// components/flow/input-pill.tsx
//
// A live-input source chip (network speed / leader / tip market). Plain language
// in Basic; the real term + mono on-chain value in Technical. The sage "live"
// dot indicates the feed is active. The optional value is shown only when a real
// event has carried it (AC3) — never a synthesized ticker.

import type { ReactNode } from "react";

interface InputPillProps {
  label: string;
  /** Mono on-chain value (Technical), only when event-backed. */
  value?: ReactNode;
}

export function InputPill({ label, value }: InputPillProps) {
  return (
    <span className="src">
      <span className="ld" aria-hidden="true" />
      <span>{label}</span>
      {value !== undefined && value !== null ? <span className="src-v mono">{value}</span> : null}
    </span>
  );
}
