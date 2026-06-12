import { describe, it, expect } from "vitest";
import { LeaderWindow } from "./leader-window.js";

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
});
