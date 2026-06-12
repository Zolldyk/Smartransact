import type { StreamEvent } from "../../schemas/stream-event-schema.js";

export class LeaderWindow {
  private _currentSlot: bigint = 0n;
  private _schedule: Map<bigint, string> = new Map();

  consume(event: StreamEvent): void {
    if (event.kind === "slotAdvanced") {
      this._currentSlot = event.slot;
    } else if (event.kind === "leaderScheduleUpdated") {
      this._schedule = event.schedule;
    }
  }

  getCurrentSlot(): bigint {
    return this._currentSlot;
  }

  getLeaderSchedule(): Map<bigint, string> {
    return this._schedule;
  }
}
