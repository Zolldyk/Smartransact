// web/app/lib/session-client.ts
//
// The shared WebSocket seam to the streaming backend (web/server/index.ts). This
// is rendering-agnostic ON PURPOSE — story 8.2's /live placeholder and story
// 8.3's full lifecycle viz both consume it. It owns the locked 8.1 contract:
//   1. open `NEXT_PUBLIC_WS_URL` (default ws://localhost:8787/ws)
//   2. on open, send the `ClientOverrides` payload as the FIRST (and only) frame
//   3. thereafter parse each frame as a bare `EvidenceEvent` (or `{ error }`)
// Keep all UI/state out of here; consumers bind via the callbacks.

import type { ClientOverrides } from "./overrides";
import { isErrorFrame, type EvidenceEvent, type StreamFrame } from "./types";

const DEFAULT_WS_URL = "ws://localhost:8787/ws";

/** Resolved WS endpoint (env override at build time; safe default for local dev). */
export function resolveWsUrl(): string {
  return process.env["NEXT_PUBLIC_WS_URL"] ?? DEFAULT_WS_URL;
}

export type ConnectionState = "connecting" | "live" | "closed" | "error";

export interface SessionHandlers {
  /** Connection lifecycle (connecting → live → closed/error). */
  onState: (state: ConnectionState) => void;
  /** A bare evidence event arrived. */
  onEvent: (event: EvidenceEvent) => void;
  /** A calm, human error message (invalid key, server busy, dropped, …). */
  onError: (message: string) => void;
}

export interface SessionHandle {
  /** Tear down the socket (also fires when the consumer unmounts). */
  close: () => void;
}

/**
 * Open a sandbox session: connect, send the overrides once, stream events back.
 * Returns a handle the caller closes on unmount. Network failures are surfaced
 * as calm messages via `onError` (the browser WebSocket API cannot read the
 * upgrade's HTTP status, so a rejected upgrade — rate-limit/busy — is reported
 * as a generic "couldn't connect" with retry guidance).
 */
export function openSession(overrides: ClientOverrides, handlers: SessionHandlers): SessionHandle {
  let everOpened = false;
  let closedByCaller = false;

  handlers.onState("connecting");

  let ws: WebSocket;
  try {
    ws = new WebSocket(resolveWsUrl());
  } catch {
    handlers.onState("error");
    handlers.onError("Couldn't reach the session server. Is it running?");
    return { close: () => {} };
  }

  ws.onopen = () => {
    everOpened = true;
    handlers.onState("live");
    // The contract: exactly one JSON message first = the ClientOverrides object.
    ws.send(JSON.stringify(overrides));
  };

  ws.onmessage = (ev: MessageEvent) => {
    let frame: StreamFrame;
    try {
      frame = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data)) as StreamFrame;
    } catch {
      // A malformed frame is non-fatal; ignore it rather than crash the view.
      return;
    }
    if (isErrorFrame(frame)) {
      handlers.onError(humanizeError(frame.error));
      return;
    }
    handlers.onEvent(frame);
  };

  ws.onerror = () => {
    if (closedByCaller) return;
    handlers.onState("error");
  };

  ws.onclose = () => {
    if (closedByCaller) return;
    if (!everOpened) {
      // Rejected before the WS ever opened → busy / rate-limited / server down.
      handlers.onState("error");
      handlers.onError("Couldn't start a session — the server may be busy or rate-limiting. Try again in a moment.");
      return;
    }
    handlers.onState("closed");
  };

  return {
    close: () => {
      closedByCaller = true;
      try {
        ws.close();
      } catch {
        // already closing/closed — nothing to do
      }
    },
  };
}

/** Map a raw server error string to a calm, fix-oriented message. */
function humanizeError(raw: string): string {
  if (raw === "invalid session options") {
    return "The session options were rejected. If you chose Gemini or Claude, check your API key.";
  }
  if (raw === "session error") {
    return "The session hit an error and stopped. You can start a new one.";
  }
  return raw;
}
