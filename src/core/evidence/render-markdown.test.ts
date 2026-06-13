import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./render-markdown.js";

const submitted = JSON.stringify({
  event: "bundleSubmitted",
  at: "2026-06-13T10:00:00.000Z",
  bundleId: "bundle-abc123456789",
  slot: 123456,
  tipLamports: 5000,
});

const transition = (stage: string, slot: number, ms: number): string =>
  JSON.stringify({
    event: "commitmentTransition",
    at: "2026-06-13T10:00:01.000Z",
    bundleId: "bundle-abc123456789",
    stage,
    slot,
    latencyFromPrevMs: ms,
    source: { kind: "txStatusChanged", transport: "grpc", signature: "sig1", commitment: stage, slot },
  });

describe("renderMarkdown", () => {
  it("(a) complete bundle produces fully-populated row", () => {
    const lines = [
      submitted,
      transition("processed", 123457, 420),
      transition("confirmed", 123462, 2100),
      transition("finalized", 123470, 3200),
    ];
    const md = renderMarkdown(lines);

    expect(md).toContain("…23456789");
    expect(md).toContain("5000");
    expect(md).toContain("123456");
    expect(md).toContain("123457");
    expect(md).toContain("123462");
    expect(md).toContain("123470");
    expect(md).toContain("420");
    expect(md).toContain("2100");
    expect(md).toContain("3200");
    expect(md).toContain("1 bundles / 1 landed / 0 failed / 0 episodes");
  });

  it("(b) failed bundle shows classification and agent action", () => {
    const failure = JSON.stringify({
      event: "failureClassified",
      at: "2026-06-13T10:00:01.000Z",
      bundleId: "bundle-abc123456789",
      classification: "expired_blockhash",
      rawError: "blockhash expired",
    });
    const decision = JSON.stringify({
      event: "agentDecision",
      at: "2026-06-13T10:00:02.000Z",
      bundleId: "bundle-abc123456789",
      episodeId: "ep-001",
      attempt: 1,
      decision: { action: "refresh", diagnosis: "stale", rationale: "retry" },
      thinkingTrace: "",
    });
    const lines = [submitted, failure, decision];
    const md = renderMarkdown(lines);

    expect(md).toContain("expired_blockhash");
    expect(md).toContain("refresh");
    expect(md).toContain("1 bundles / 0 landed / 1 failed / 1 episodes");
  });

  it("(c) empty input produces header row only", () => {
    const md = renderMarkdown([]);

    expect(md).toContain("| Bundle ID |");
    expect(md).toContain("|---|");
    // no data rows or summary
    const lines = md.split("\n").filter((l) => l.trim());
    expect(lines).toHaveLength(2); // header + separator
  });
});
