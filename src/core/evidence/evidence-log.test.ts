import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, rmSync, existsSync } from "node:fs";
import { EvidenceLog } from "./evidence-log.js";
import { EvidenceEventSchema } from "../../schemas/evidence-event-schema.js";

afterEach(() => {
  const files = [
    "logs/lifecycle-test-a.jsonl",
    "logs/lifecycle-test-b.jsonl",
    "logs/lifecycle-test-c.jsonl",
    "logs/lifecycle-test-d.jsonl",
  ];
  for (const f of files) {
    if (existsSync(f)) rmSync(f);
  }
});

describe("EvidenceLog", () => {
  it("(a) sessionStarted event round-trips through schema", () => {
    const log = new EvidenceLog("test-a");
    const event = {
      event: "sessionStarted" as const,
      at: "2026-06-11T00:00:00.000Z",
      sessionId: "test-a",
      profile: "testnet-ws",
      adapter: "ws" as const,
    };
    log.append(event);
    log.close();

    const raw = readFileSync("logs/lifecycle-test-a.jsonl", "utf-8").trim();
    const parsed = JSON.parse(raw);
    expect(() => EvidenceEventSchema.parse(parsed)).not.toThrow();
  });

  it("(b) bundleSubmitted bigint fields serialize as JSON numbers", () => {
    const log = new EvidenceLog("test-b");
    const event = {
      event: "bundleSubmitted" as const,
      at: "2026-06-11T00:00:00.000Z",
      bundleId: "bundle-xyz",
      slot: 414627551n,
      tipLamports: 1000000n,
    };
    log.append(event);
    log.close();

    const raw = readFileSync("logs/lifecycle-test-b.jsonl", "utf-8").trim();
    const parsed = JSON.parse(raw);
    expect(typeof parsed.slot).toBe("number");
    expect(parsed.slot).toBe(414627551);
    expect(typeof parsed.tipLamports).toBe("number");
    expect(parsed.tipLamports).toBe(1000000);
  });

  it("(c) schema-invalid event causes an immediate throw", () => {
    const log = new EvidenceLog("test-c");
    expect(() =>
      log.append({ event: "not-a-real-event" } as never),
    ).toThrow();
    log.close();
  });

  it("(d) onAppend fires exactly once, with the event, AFTER the file is written", () => {
    let callCount = 0;
    let receivedEvent: unknown;
    let fileContentsAtCallback = "";

    const log = new EvidenceLog("test-d", {
      suppressSigint: true,
      onAppend: (event) => {
        callCount++;
        receivedEvent = event;
        // The persisted line MUST already exist when the callback runs (AC1).
        fileContentsAtCallback = readFileSync(
          "logs/lifecycle-test-d.jsonl",
          "utf-8",
        );
      },
    });

    const event = {
      event: "bundleSubmitted" as const,
      at: "2026-06-11T00:00:00.000Z",
      bundleId: "bundle-onappend",
      slot: 414627551n,
      tipLamports: 1000000n,
    };
    log.append(event);
    log.close();

    expect(callCount).toBe(1);
    expect(receivedEvent).toBe(event);
    // Callback observed the persisted line — proves it fired post-write.
    expect(fileContentsAtCallback).toContain("bundle-onappend");
  });

  it("close() unregisters the SIGINT handler", () => {
    const before = process.listenerCount("SIGINT");
    const log = new EvidenceLog("test-c");
    expect(process.listenerCount("SIGINT")).toBe(before + 1);
    log.close();
    expect(process.listenerCount("SIGINT")).toBe(before);
  });
});
