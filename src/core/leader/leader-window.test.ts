import { describe, it, expect } from "vitest";
import { LeaderWindow, type LeaderSearcher } from "./leader-window.js";
import { ok, fail } from "../result.js";

/** Fake searcher (no network) — counts wire calls and returns a configurable
 * nextLeaderSlot, or a failure to exercise the fallback path. */
function fakeSearcher(nextLeaderSlot: bigint): LeaderSearcher & { calls: number } {
  return {
    calls: 0,
    async getNextScheduledLeader() {
      this.calls++;
      return ok({ currentSlot: nextLeaderSlot - 4n, nextLeaderSlot });
    },
  };
}

describe("LeaderWindow", () => {
  it("(a) initial state: getCurrentSlot is 0n and schedule is empty", () => {
    const lw = new LeaderWindow();
    expect(lw.getCurrentSlot()).toBe(0n);
    expect(lw.getLeaderSchedule().size).toBe(0);
  });

  it("(b) slotAdvanced events: getCurrentSlot returns the latest slot", () => {
    const lw = new LeaderWindow();
    lw.consume({ kind: "slotAdvanced", slot: 100n });
    lw.consume({ kind: "slotAdvanced", slot: 101n });
    lw.consume({ kind: "slotAdvanced", slot: 102n });
    expect(lw.getCurrentSlot()).toBe(102n);
  });

  it("(c) leaderScheduleUpdated replaces the internal schedule", () => {
    const lw = new LeaderWindow();
    const schedule = new Map<bigint, string>([[100n, "validatorA"], [101n, "validatorB"]]);
    lw.consume({ kind: "leaderScheduleUpdated", schedule, at: new Date().toISOString() });
    expect(lw.getLeaderSchedule().get(100n)).toBe("validatorA");
    expect(lw.getLeaderSchedule().get(101n)).toBe("validatorB");
  });

  it("(d) window from current slot: after slot 500n, returns startSlot 501n and endSlot 504n", async () => {
    const lw = new LeaderWindow();
    lw.consume({ kind: "slotAdvanced", slot: 500n });
    const window = await lw.getNextJitoLeaderWindow();
    expect(window.startSlot).toBe(501n);
    expect(window.endSlot).toBe(504n);
  });

  it("(e) window is non-empty and starts in the future", async () => {
    const lw = new LeaderWindow();
    lw.consume({ kind: "slotAdvanced", slot: 500n });
    const window = await lw.getNextJitoLeaderWindow();
    expect(window.endSlot - window.startSlot).toBe(3n);
    expect(window.startSlot > lw.getCurrentSlot()).toBe(true);
  });

  it("(f) window from initial state (slot 0): returns startSlot 1n and endSlot 4n", async () => {
    const lw = new LeaderWindow();
    const window = await lw.getNextJitoLeaderWindow();
    expect(window.startSlot).toBe(1n);
    expect(window.endSlot).toBe(4n);
  });

  // ── Story 5.8 searcher-backed path ──────────────────────────────────────────

  it("(g) no searcher → keeps the empirical +1n/+4n guess (AC3 regression lock)", async () => {
    const lw = new LeaderWindow(); // no searcher injected
    lw.consume({ kind: "slotAdvanced", slot: 426838676n });
    const window = await lw.getNextJitoLeaderWindow();
    expect(window.startSlot).toBe(426838677n);
    expect(window.endSlot).toBe(426838680n);
  });

  it("(h) with searcher returning nextLeaderSlot=N → returns { N, N+3n }", async () => {
    const searcher = fakeSearcher(426838680n);
    const lw = new LeaderWindow(searcher);
    lw.consume({ kind: "slotAdvanced", slot: 426838676n });
    const window = await lw.getNextJitoLeaderWindow();
    expect(window.startSlot).toBe(426838680n);
    expect(window.endSlot).toBe(426838683n);
  });

  it("(i) caching: two calls within the same slot hit the searcher exactly once", async () => {
    const searcher = fakeSearcher(500n);
    const lw = new LeaderWindow(searcher);
    lw.consume({ kind: "slotAdvanced", slot: 496n });
    const w1 = await lw.getNextJitoLeaderWindow();
    const w2 = await lw.getNextJitoLeaderWindow();
    expect(searcher.calls).toBe(1);
    expect(w1).toEqual(w2);
    expect(w1.startSlot).toBe(500n);
  });

  it("(j) cache refresh after the slot advances past the cached window", async () => {
    const searcher = fakeSearcher(500n);
    const lw = new LeaderWindow(searcher);
    lw.consume({ kind: "slotAdvanced", slot: 496n });
    await lw.getNextJitoLeaderWindow(); // caches { 500, 503 } at slot 496
    expect(searcher.calls).toBe(1);

    // Advance well past the window end (503) → stale → refresh.
    lw.consume({ kind: "slotAdvanced", slot: 510n });
    await lw.getNextJitoLeaderWindow();
    expect(searcher.calls).toBe(2);
  });

  it("(k) searcher error → falls back to the empirical guess, does not throw", async () => {
    const searcher: LeaderSearcher = {
      async getNextScheduledLeader() {
        return fail({ reason: "8 RESOURCE_EXHAUSTED" });
      },
    };
    const lw = new LeaderWindow(searcher);
    lw.consume({ kind: "slotAdvanced", slot: 700n });
    const window = await lw.getNextJitoLeaderWindow();
    expect(window.startSlot).toBe(701n);
    expect(window.endSlot).toBe(704n);
  });
});
