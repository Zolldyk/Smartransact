// web/app/lib/types.ts
//
// Client-side shapes for the WebSocket evidence stream. The backend pushes BARE
// `EvidenceEvent` objects (one JSON message per event, bigints already converted
// to JSON numbers by web/server/serialize.ts) — no wrapper envelope. A backstop
// error frame is `{ error: string }`.
//
// Story 8.3 tightened `EvidenceEvent` from the loose `{ event: string; [k] }`
// placeholder to the real discriminated union (the single data model — AC3),
// re-exported from `evidence-events.ts`. The wire frame is still UNVALIDATED at
// runtime (session-client stays a thin pipe); the consumer runs
// `parseEvidenceEvent` to gate it before reducing. `ErrorFrame` / `isErrorFrame`
// are unchanged.

import type { EvidenceEvent } from "./evidence-events";

export type { EvidenceEvent } from "./evidence-events";

/** The server's backstop error frame (invalid options / session error). */
export interface ErrorFrame {
  error: string;
}

/** Every frame the server can push on the stream. */
export type StreamFrame = EvidenceEvent | ErrorFrame;

/** Type guard: is this frame the `{ error }` shape rather than an evidence event? */
export function isErrorFrame(frame: StreamFrame): frame is ErrorFrame {
  return typeof (frame as ErrorFrame).error === "string";
}
