import { EvidenceLog } from "../evidence/evidence-log.js";
import type { StreamEvent } from "../../schemas/stream-event-schema.js";

export class BoundedQueue {
  private readonly items: StreamEvent[] = [];
  private dropCount = 0;

  constructor(
    private readonly maxSize: number,
    private readonly evidenceLog: EvidenceLog,
  ) {
    if (maxSize <= 0) {
      throw new Error(`BoundedQueue: maxSize must be > 0 (got ${maxSize})`);
    }
  }

  enqueue(event: StreamEvent): void {
    if (this.items.length >= this.maxSize) {
      this.items.shift();
      this.dropCount++;
      this.evidenceLog.append({
        event: "eventsDropped",
        at: new Date().toISOString(),
        count: 1,
      });
    }
    this.items.push(event);
  }

  dequeue(): StreamEvent | undefined {
    return this.items.shift();
  }

  get size(): number {
    return this.items.length;
  }

  get drops(): number {
    return this.dropCount;
  }
}
