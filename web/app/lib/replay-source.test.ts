// web/app/lib/replay-source.test.ts
//
// Pure tests for the replay player's two testable seams: JSONL parsing (drops
// malformed/unknown lines, never throws) and the cadence clamp (compresses a run
// into a watchable window, floor/ceiling per step). No DOM, no fetch, no timers.

import { describe, it, expect } from "vitest";
import { parseJsonl, computeStepDelays } from "./replay-source";

const REAL_LINES = [
  '{"event":"sessionStarted","at":"2026-06-14T03:14:57.395Z","sessionId":"s","profile":"mainnet-ws","adapter":"ws"}',
  '{"event":"bundleSubmitted","at":"2026-06-14T03:15:01.610Z","bundleId":"a","slot":426332922,"tipLamports":4746}',
  "   ", // blank → skipped
  "{ not json", // malformed → skipped
  '{"event":"slotTick","at":"2026-06-14T03:15:02.000Z"}', // unknown event → skipped
  '{"event":"sessionEnded","at":"2026-06-14T04:13:11.955Z","sessionId":"s","reason":"completed"}',
].join("\n");

describe("parseJsonl", () => {
  it("parses valid lines and drops blank / malformed / unknown ones", () => {
    const events = parseJsonl(REAL_LINES);
    expect(events.map((e) => e.event)).toEqual(["sessionStarted", "bundleSubmitted", "sessionEnded"]);
  });

  it("returns [] for empty input", () => {
    expect(parseJsonl("")).toEqual([]);
    expect(parseJsonl("\n\n")).toEqual([]);
  });
});

describe("computeStepDelays", () => {
  it("first event fires immediately; later steps are clamped into [90, 1200]ms", () => {
    const events = parseJsonl(REAL_LINES);
    const delays = computeStepDelays(events);
    expect(delays.length).toBe(events.length);
    expect(delays[0]).toBe(0);
    for (const d of delays.slice(1)) {
      expect(d).toBeGreaterThanOrEqual(90);
      expect(d).toBeLessThanOrEqual(1200);
    }
  });

  it("handles 0 or 1 events without dividing by zero", () => {
    expect(computeStepDelays([])).toEqual([]);
    expect(computeStepDelays(parseJsonl(REAL_LINES).slice(0, 1))).toEqual([0]);
  });
});
