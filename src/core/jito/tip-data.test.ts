import { describe, it, expect, vi, afterEach } from "vitest";
import { parseTipFloorResponse, fetchTipFloor, fetchObservedTips } from "./tip-data.js";

describe("tip-data", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("(a) parseTipFloorResponse converts SOL percentiles to lamports", () => {
    // The Jito tip_floor API reports SOL (fractional floats); the parser must
    // return lamports (× 1e9) so computeTip doesn't round them to ~0.
    const data = [
      {
        time: "2024-01-01T00:00:00Z",
        landed_tips_25th_percentile: 0.000001, // 1_000 lamports
        landed_tips_50th_percentile: 0.00001, // 10_000 lamports
        landed_tips_75th_percentile: 0.00007172, // 71_720 lamports
        landed_tips_95th_percentile: 0.00012, // 120_000 lamports
        landed_tips_99th_percentile: 0.0006263, // 626_300 lamports
        ema_landed_tips_50th_percentile: 8.494e-6, // 8_494 lamports
      },
    ];

    const result = parseTipFloorResponse(data);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.floorPercentiles.p25).toBe(1_000);
      expect(result.value.floorPercentiles.p50).toBe(10_000);
      expect(result.value.floorPercentiles.p75).toBe(71_720);
      expect(result.value.floorPercentiles.p95).toBe(120_000);
      expect(result.value.floorPercentiles.p99).toBe(626_300);
      expect(result.value.emaP50).toBe(8_494);
    }
  });

  it("(b) fetchTipFloor returns fail when fetch rejects", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("Network error")));

    const ctrl = new AbortController();
    const result = await fetchTipFloor(ctrl.signal);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.reason).toContain("Network error");
    }
  });

  it("(c) fetchObservedTips returns [] when getSignaturesForAddress returns empty", async () => {
    const mockRpc = {
      getSignaturesForAddress: () => ({
        send: () => Promise.resolve([]),
      }),
    } as unknown as Parameters<typeof fetchObservedTips>[1];

    const ctrl = new AbortController();
    const result = await fetchObservedTips(["DummyTipAccount1111111111111111111111111111"], mockRpc, ctrl.signal);
    expect(result).toEqual([]);
  });
});
