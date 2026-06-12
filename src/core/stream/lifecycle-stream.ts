import type { StreamEvent } from "../../schemas/stream-event-schema.js";
import { BoundedQueue } from "./bounded-queue.js";
import { EvidenceLog } from "../evidence/evidence-log.js";

export class LifecycleStream implements AsyncIterable<StreamEvent> {
  private readonly queue: BoundedQueue;
  private readonly signal: AbortSignal;
  private readonly wakeResolvers: Array<() => void> = [];

  constructor(maxQueueSize: number, evidenceLog: EvidenceLog, signal: AbortSignal) {
    this.queue = new BoundedQueue(maxQueueSize, evidenceLog);
    this.signal = signal;
    signal.addEventListener("abort", () => this.wakeAll(), { once: true });
  }

  push(event: StreamEvent): void {
    this.queue.enqueue(event);
    const resolve = this.wakeResolvers.shift();
    if (resolve) resolve();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<StreamEvent> {
    while (!this.signal.aborted) {
      const event = this.queue.dequeue();
      if (event !== undefined) {
        yield event;
        continue;
      }
      await new Promise<void>((resolve) => {
        this.wakeResolvers.push(resolve);
      });
    }
  }

  private wakeAll(): void {
    const resolvers = this.wakeResolvers.splice(0);
    for (const resolve of resolvers) resolve();
  }
}
