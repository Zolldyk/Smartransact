// components/flow/flow-connector.tsx
//
// The arrow between two stages. When `live`, the segment glows clay (the current
// stage's connector). When `animate`, it carries a ONE-SHOT traveling packet that
// fires once per real stage-advance (Story 8.7): the packet's travel duration is
// the genuine wall-clock latency (`durationMs`), and `seq` keys the element so a
// re-fire for a new bundle restarts cleanly. Motion is gated by
// prefers-reduced-motion in globals.css (the .pkt rule sets animation:none).
// Decorative: hidden from assistive tech (the ordered list of StageCards already
// conveys sequence).

interface FlowConnectorProps {
  /** Clay glow on the segment — the connector after the live stage. */
  live?: boolean;
  /** Fire a single packet traverse on this connector (a real advance entered the
   *  next stage). Only ever true for the one entering connector. */
  animate?: boolean;
  /** Packet travel duration in ms — the clamped real latency (AC2). */
  durationMs?: number;
  /** Monotonic advance seq; keys the packet so each advance restarts cleanly. */
  seq?: number;
}

export function FlowConnector({ live = false, animate = false, durationMs, seq }: FlowConnectorProps) {
  return (
    <div className={live ? "conn live" : "conn"} aria-hidden="true">
      <svg viewBox="0 0 46 14">
        <path d="M0 7h38" />
        <path d="M36 3l5 4-5 4" />
        {animate ? (
          <circle
            key={seq}
            className="pkt"
            cx="18"
            cy="7"
            r="3.4"
            style={durationMs !== undefined ? { animationDuration: `${durationMs}ms` } : undefined}
          />
        ) : null}
      </svg>
    </div>
  );
}
