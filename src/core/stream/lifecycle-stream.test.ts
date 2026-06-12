import { describe, it, expect, afterEach } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { EvidenceLog } from "../evidence/evidence-log.js";
import { LifecycleStream } from "./lifecycle-stream.js";
import type { StreamEvent } from "../../schemas/stream-event-schema.js";

const makeSlotEvent = (slot: bigint): StreamEvent => ({ kind: "slotAdvanced", slot });

afterEach(() => {
  ["logs/lifecycle-ls-a.jsonl", "logs/lifecycle-ls-b.jsonl", "logs/lifecycle-ls-c.jsonl"].forEach(
    (f) => {
      if (existsSync(f)) rmSync(f);
    },
  );
});

describe("LifecycleStream", () => {
  it("(a) pushed events are yielded in FIFO order", async () => {
    const controller = new AbortController();
    const log = new EvidenceLog("ls-a");
    const stream = new LifecycleStream(10, log, controller.signal);

    stream.push(makeSlotEvent(1n));
    stream.push(makeSlotEvent(2n));

    const iter = stream[Symbol.asyncIterator]();
    const first = await iter.next();
    const second = await iter.next();

    expect(first.value).toEqual({ kind: "slotAdvanced", slot: 1n });
    expect(second.value).toEqual({ kind: "slotAdvanced", slot: 2n });
    controller.abort();
    log.close();
  });

  it("(b) abort signal terminates the iterator without throwing", async () => {
    const controller = new AbortController();
    const log = new EvidenceLog("ls-b");
    const stream = new LifecycleStream(10, log, controller.signal);

    const received: StreamEvent[] = [];
    const done = (async () => {
      for await (const event of stream) {
        received.push(event);
        controller.abort();
      }
    })();

    stream.push(makeSlotEvent(42n));
    await done;

    expect(received).toHaveLength(1);
    log.close();
  });

  it("(c) abort before any push terminates immediately", async () => {
    const controller = new AbortController();
    const log = new EvidenceLog("ls-c");
    const stream = new LifecycleStream(10, log, controller.signal);

    controller.abort();
    const received: StreamEvent[] = [];
    for await (const event of stream) {
      received.push(event);
    }

    expect(received).toHaveLength(0);
    log.close();
  });
});
