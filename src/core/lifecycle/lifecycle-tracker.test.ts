import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, rmSync, existsSync } from "node:fs";
import { LifecycleTracker } from "./lifecycle-tracker.js";
import { EvidenceLog } from "../evidence/evidence-log.js";

function cleanup(sessionId: string): void {
  const p = `logs/lifecycle-${sessionId}.jsonl`;
  if (existsSync(p)) rmSync(p);
}

describe("LifecycleTracker", () => {
  it("(a) full submitted → finalized emits 4 log entries with correct stages", () => {
    const sid = "test-lt-a";
    const log = new EvidenceLog(sid);
    const bundleId = "bundle-abc";

    // Simulate what the orchestrator writes before the tracker takes over
    log.append({
      event: "bundleSubmitted",
      at: new Date().toISOString(),
      bundleId,
      slot: 100n,
      tipLamports: 5_000n,
    });

    const tracker = new LifecycleTracker(log);
    tracker.register(bundleId);

    const commitments = ["processed", "confirmed", "finalized"] as const;
    commitments.forEach((commitment, i) => {
      tracker.consume(
        {
          kind: "txStatusChanged",
          signature: "sig-test",
          commitment,
          slot: BigInt(101 + i),
          transport: "ws",
        },
        bundleId,
      );
    });

    log.close();

    const lines = readFileSync(`logs/lifecycle-${sid}.jsonl`, "utf-8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as Record<string, unknown>);

    expect(lines).toHaveLength(4);
    expect(lines[0].event).toBe("bundleSubmitted");
    expect(lines[1]).toMatchObject({ event: "commitmentTransition", stage: "processed" });
    expect(lines[2]).toMatchObject({ event: "commitmentTransition", stage: "confirmed" });
    expect(lines[3]).toMatchObject({ event: "commitmentTransition", stage: "finalized" });

    cleanup(sid);
  });

  it("(b) illegal transition (submitted → confirmed) throws immediately", () => {
    const sid = "test-lt-b";
    const log = new EvidenceLog(sid);
    const tracker = new LifecycleTracker(log);
    tracker.register("bundle-bad");

    expect(() => {
      tracker.consume(
        {
          kind: "txStatusChanged",
          signature: "sig-bad",
          commitment: "confirmed", // illegal: current stage is "submitted", expected "processed"
          slot: 200n,
          transport: "ws",
        },
        "bundle-bad",
      );
    }).toThrow();

    log.close();
    cleanup(sid);
  });

  it("(c) commitmentTransition source field mirrors the triggering txStatusChanged event", () => {
    const sid = "test-lt-c";
    const log = new EvidenceLog(sid);
    const tracker = new LifecycleTracker(log);
    const bundleId = "bundle-src";
    tracker.register(bundleId);

    tracker.consume(
      {
        kind: "txStatusChanged",
        signature: "sig-xyz-123",
        commitment: "processed",
        slot: 555n,
        transport: "grpc",
        subscriptionId: "sub-42",
      },
      bundleId,
    );

    log.close();

    const line = JSON.parse(
      readFileSync(`logs/lifecycle-${sid}.jsonl`, "utf-8").trim(),
    ) as Record<string, unknown>;

    expect(line.event).toBe("commitmentTransition");
    const source = line.source as Record<string, unknown>;
    expect(source.kind).toBe("txStatusChanged");
    expect(source.signature).toBe("sig-xyz-123");
    expect(source.transport).toBe("grpc");
    expect(source.subscriptionId).toBe("sub-42");
    expect(source.commitment).toBe("processed");

    cleanup(sid);
  });
});
