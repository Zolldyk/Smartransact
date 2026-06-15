// components/flow/flow-connector.tsx
//
// The arrow between two stages. When `live`, the segment glows clay and carries a
// traveling packet (the packet's motion is gated by prefers-reduced-motion in
// globals.css — Task 7). Decorative: hidden from assistive tech (the ordered
// list of StageCards already conveys sequence).

interface FlowConnectorProps {
  live?: boolean;
}

export function FlowConnector({ live = false }: FlowConnectorProps) {
  return (
    <div className={live ? "conn live" : "conn"} aria-hidden="true">
      <svg viewBox="0 0 46 14">
        <path d="M0 7h38" />
        <path d="M36 3l5 4-5 4" />
        {live ? <circle className="pkt" cx="18" cy="7" r="3.4" /> : null}
      </svg>
    </div>
  );
}
