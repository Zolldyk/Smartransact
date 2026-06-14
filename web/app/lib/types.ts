// web/app/lib/types.ts
//
// Client-side shapes for the WebSocket evidence stream. The backend pushes BARE
// `EvidenceEvent` objects (one JSON message per event, bigints already converted
// to JSON numbers by web/server/serialize.ts) — no wrapper envelope. A backstop
// error frame is `{ error: string }`.
//
// We keep this intentionally light: 8.2's /live is a minimal placeholder that
// only proves the pipe (connection state + event count). Story 8.3 renders the
// rich lifecycle and will tighten these types against the real event union.

/** A bare evidence event as it arrives over the wire (bigints are JSON numbers). */
export interface EvidenceEvent {
  event: string;
  at: string;
  [key: string]: unknown;
}

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
