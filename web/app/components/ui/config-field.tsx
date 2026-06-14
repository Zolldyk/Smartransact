// ConfigField primitives — stepper, toggle, and a labeled field row. DESIGN.md ›
// ConfigField. Each control is a real, keyboard-operable element with a visible
// label association (AC accessibility floor: label + control, not color alone).

import type { ReactNode } from "react";

/** A labeled row: <label> on the left, control on the right. */
export function FieldRow({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="fld">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  );
}

interface StepperProps {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  ariaLabel: string;
}

/** –/+ stepper with a mono value readout. Clamped to [min, max]. */
export function Stepper({ value, onChange, min = 0, max = Number.MAX_SAFE_INTEGER, step = 1, ariaLabel }: StepperProps) {
  const clamp = (n: number) => Math.min(Math.max(n, min), max);
  return (
    <div className="stepper" role="group" aria-label={ariaLabel}>
      <button type="button" aria-label={`decrease ${ariaLabel}`} disabled={value <= min} onClick={() => onChange(clamp(value - step))}>
        –
      </button>
      <b className="mono" aria-live="polite">
        {value}
      </b>
      <button type="button" aria-label={`increase ${ariaLabel}`} disabled={value >= max} onClick={() => onChange(clamp(value + step))}>
        +
      </button>
    </div>
  );
}

interface ToggleProps {
  on: boolean;
  onChange: (next: boolean) => void;
  ariaLabel: string;
}

/** Clay-on / panel-off switch. A real <button> with aria-pressed. */
export function Toggle({ on, onChange, ariaLabel }: ToggleProps) {
  return (
    <button
      type="button"
      className={on ? "toggle" : "toggle off"}
      role="switch"
      aria-checked={on}
      aria-label={ariaLabel}
      onClick={() => onChange(!on)}
    />
  );
}
