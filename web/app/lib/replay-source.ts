// web/app/lib/replay-source.ts
//
// The committed-run player. Loads evidence/lifecycle-log.jsonl (exposed as the
// static asset /lifecycle-run.jsonl by scripts/copy-evidence.mjs — Task 6) and
// emits its events through the SAME handler shape as session-client.ts
// (onState / onEvent / onError → { close() }), so /live binds to either source
// through one code path. The only differences between live and replay are
// construction + provenance.
//
// Cadence: gentle and cinematic, paced by the events' own relative `at`
// timestamps but COMPRESSED into a watchable window and floor/ceiling-clamped so
// a 136-event run neither races nor stalls. Under prefers-reduced-motion we emit
// EVERYTHING immediately (snap to end-state) — paired with the CSS reduced-motion
// block (Task 7), the page renders the final, honest state with no animation.
//
// Evidence integrity (AC3): every emitted frame is the real JSONL line, gated by
// parseEvidenceEvent. Nothing is synthesized.

import { parseEvidenceEvent, type EvidenceEvent } from "./evidence-events";
import type { SessionHandle, SessionHandlers } from "./session-client";

/** Which run is on screen — drives the provenance badge (AC7). */
export type Provenance = "live" | "replay";

/** The tiny shared shape /live binds to (live WS or committed replay). */
export interface EvidenceSource {
  provenance: Provenance;
  open: (handlers: SessionHandlers) => SessionHandle;
}

/** The static asset path (generated from evidence/lifecycle-log.jsonl at build). */
export const REPLAY_ASSET_URL = "/lifecycle-run.jsonl";

/** Total wall-clock window the whole run is compressed into (watchable). */
const TARGET_TOTAL_MS = 42_000;
/** Per-step clamp so no beat is imperceptible or a dead pause. */
const MIN_STEP_MS = 90;
const MAX_STEP_MS = 1_200;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Parse JSONL text → ordered, validated events (unknown lines dropped). */
export function parseJsonl(text: string): EvidenceEvent[] {
  const out: EvidenceEvent[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    let raw: unknown;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      continue; // a malformed line is non-fatal
    }
    const event = parseEvidenceEvent(raw);
    if (event) out.push(event);
  }
  return out;
}

/**
 * Compute the per-step delays (ms) from the events' `at` timestamps, compressed
 * into TARGET_TOTAL_MS and clamped per step. Pure — unit-testable, and keeps the
 * relative rhythm (a real pause stays comparatively longer). The first event
 * fires immediately (delay 0).
 */
export function computeStepDelays(events: EvidenceEvent[]): number[] {
  if (events.length <= 1) return events.map(() => 0);
  const times = events.map((e) => Date.parse(e.at));
  const first = times[0]!;
  const last = times[times.length - 1]!;
  const span = Math.max(1, last - first);
  const scale = TARGET_TOTAL_MS / span;
  const delays: number[] = [0];
  for (let i = 1; i < times.length; i++) {
    const rawDelta = Math.max(0, times[i]! - times[i - 1]!);
    delays.push(Math.min(MAX_STEP_MS, Math.max(MIN_STEP_MS, rawDelta * scale)));
  }
  return delays;
}

/**
 * Build the committed-run replay source. Provenance is always `replay`.
 * Construction is lazy: `open(handlers)` kicks off the fetch + cadence and
 * returns a handle whose `close()` cancels any pending timers / in-flight fetch.
 */
export function makeReplaySource(): EvidenceSource {
  return {
    provenance: "replay",
    open(handlers: SessionHandlers): SessionHandle {
      let cancelled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const controller = new AbortController();

      handlers.onState("connecting");

      void fetch(REPLAY_ASSET_URL, { signal: controller.signal })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.text();
        })
        .then((text) => {
          if (cancelled) return;
          const events = parseJsonl(text);
          handlers.onState("live");

          if (events.length === 0) {
            // Honest empty: the asset exists but carried nothing renderable.
            handlers.onState("closed");
            return;
          }

          if (prefersReducedMotion()) {
            // Snap to end-state — emit all, then close. No timed cadence.
            for (const event of events) handlers.onEvent(event);
            handlers.onState("closed");
            return;
          }

          const delays = computeStepDelays(events);
          let i = 0;
          const step = () => {
            if (cancelled || i >= events.length) {
              if (!cancelled) handlers.onState("closed");
              return;
            }
            handlers.onEvent(events[i]!);
            i += 1;
            if (i < events.length) {
              timer = setTimeout(step, delays[i]!);
            } else {
              handlers.onState("closed");
            }
          };
          step();
        })
        .catch(() => {
          if (cancelled) return;
          handlers.onState("error");
          handlers.onError("Couldn't load the committed mainnet run. The replay asset may be missing.");
        });

      return {
        close: () => {
          cancelled = true;
          if (timer) clearTimeout(timer);
          controller.abort();
        },
      };
    },
  };
}
