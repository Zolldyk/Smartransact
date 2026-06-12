import { describe, it, expect, vi, afterEach } from "vitest";
import { parseTipFloorResponse, fetchTipFloor, fetchObservedTips } from "./tip-data.js";

describe("tip-data", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("(a) parseTipFloorResponse maps REST array to floorPercentiles + emaP50", () => {
    const data = [
      {
        time: "2024-01-01T00:00:00Z",
        landed_tips_25th_percentile: 1000,
        landed_tips_50th_percentile: 1580,
        landed_tips_75th_percentile: 4458,
        landed_tips_95th_percentile: 100000,
        landed_tips_99th_percentile: 1000000,
        ema_landed_tips_50th_percentile: 3822,
      },
    ];

    const result = parseTipFloorResponse(data);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.floorPercentiles.p50).toBe(1580);
      expect(result.value.emaP50).toBe(3822);
      expect(result.value.floorPercentiles.p25).toBe(1000);
      expect(result.value.floorPercentiles.p75).toBe(4458);
      expect(result.value.floorPercentiles.p95).toBe(100000);
      expect(result.value.floorPercentiles.p99).toBe(1000000);
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
