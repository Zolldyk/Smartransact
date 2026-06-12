import { describe, it, expect, afterEach } from "vitest";
import { existsSync, rmSync, readFileSync } from "node:fs";
import { EvidenceLog } from "../evidence/evidence-log.js";
import { BoundedQueue } from "./bounded-queue.js";
import type { StreamEvent } from "../../schemas/stream-event-schema.js";

const makeSlotEvent = (slot: bigint): StreamEvent => ({
  kind: "slotAdvanced",
  slot,
});

afterEach(() => {
  ["logs/lifecycle-bq-a.jsonl", "logs/lifecycle-bq-b.jsonl", "logs/lifecycle-bq-c.jsonl"].forEach(
    (f) => { if (existsSync(f)) rmSync(f); }
  );
});

describe("BoundedQueue", () => {
  it("(a) enqueue up to maxSize — zero drops", () => {
    const log = new EvidenceLog("bq-a");
    const q = new BoundedQueue(3, log);
    q.enqueue(makeSlotEvent(1n));
    q.enqueue(makeSlotEvent(2n));
    q.enqueue(makeSlotEvent(3n));
    expect(q.size).toBe(3);
    expect(q.drops).toBe(0);
    log.close();
  });

  it("(b) one beyond maxSize drops oldest, increments counter, writes evidence", () => {
    const log = new EvidenceLog("bq-b");
    const q = new BoundedQueue(3, log);
    q.enqueue(makeSlotEvent(1n));
    q.enqueue(makeSlotEvent(2n));
    q.enqueue(makeSlotEvent(3n));
    q.enqueue(makeSlotEvent(4n)); // overflow — drops slot 1
    expect(q.drops).toBe(1);
    expect(q.size).toBe(3);
    // oldest (slot=1n) is gone; next dequeue returns slot=2n
    const first = q.dequeue() as Extract<StreamEvent, { kind: "slotAdvanced" }>;
    expect(first.slot).toBe(2n);
    // evidence file must contain an eventsDropped line
    const raw = readFileSync("logs/lifecycle-bq-b.jsonl", "utf-8").trim();
    const parsed = JSON.parse(raw);
    expect(parsed.event).toBe("eventsDropped");
    expect(parsed.count).toBe(1);
    log.close();
  });

  it("(c) dequeue on empty queue returns undefined", () => {
    const log = new EvidenceLog("bq-c");
    const q = new BoundedQueue(5, log);
    expect(q.dequeue()).toBeUndefined();
    log.close();
  });
});
