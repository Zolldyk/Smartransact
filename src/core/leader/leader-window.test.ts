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
});
