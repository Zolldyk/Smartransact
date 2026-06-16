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

  it("(b) a forward stage-skip (submitted → confirmed) is accepted and recorded, never throws", () => {
    // Real WS subscriptions can miss the `processed` notification and deliver
    // `confirmed` first. Commitment is monotonic, so confirmed is a true forward
    // advance: record it as observed, do NOT synthesize the skipped `processed`,
    // and do NOT throw.
    const sid = "test-lt-b";
    const log = new EvidenceLog(sid);
    const tracker = new LifecycleTracker(log);
    tracker.register("bundle-skip");

    expect(() => {
      tracker.consume(
        {
          kind: "txStatusChanged",
          signature: "sig-skip",
          commitment: "confirmed",
          slot: 200n,
          transport: "ws",
        },
        "bundle-skip",
      );
    }).not.toThrow();

    log.close();

    const lines = readFileSync(`logs/lifecycle-${sid}.jsonl`, "utf-8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    // Exactly one commitmentTransition (confirmed) — the skipped processed is NOT fabricated.
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ event: "commitmentTransition", stage: "confirmed" });

    cleanup(sid);
  });

  it("(d) duplicate and backward notifications are ignored silently (no extra log entries, no throw)", () => {
    const sid = "test-lt-d";
    const log = new EvidenceLog(sid);
    const tracker = new LifecycleTracker(log);
    const bundleId = "bundle-dup";
    tracker.register(bundleId);

    const ev = (commitment: "processed" | "confirmed" | "finalized", slot: bigint) => ({
      kind: "txStatusChanged" as const,
      signature: "sig-dup",
      commitment,
      slot,
      transport: "ws" as const,
    });

    // Real stream: processed, processed(dup), confirmed, processed(stale/backward),
    // confirmed(dup), finalized. Only 3 forward advances should be recorded.
    expect(() => {
      tracker.consume(ev("processed", 10n), bundleId);
      tracker.consume(ev("processed", 10n), bundleId); // duplicate
      tracker.consume(ev("confirmed", 11n), bundleId);
      tracker.consume(ev("processed", 10n), bundleId); // backward / reordered
      tracker.consume(ev("confirmed", 11n), bundleId); // duplicate
      tracker.consume(ev("finalized", 12n), bundleId);
      tracker.consume(ev("finalized", 12n), bundleId); // after terminal
    }).not.toThrow();

    log.close();

    const lines = readFileSync(`logs/lifecycle-${sid}.jsonl`, "utf-8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines).toHaveLength(3);
    expect(lines.map((l) => l.stage)).toEqual(["processed", "confirmed", "finalized"]);

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
