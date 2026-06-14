import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { JitoClient } from "./jito-client.js";

describe("JitoClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("(a) rate limiter: two rapid calls are spaced ≥ 1000 ms apart", async () => {
    const ctrl = new AbortController();
    const client = new JitoClient("https://frankfurt.mainnet.block-engine.jito.wtf");

    let callCount = 0;
    vi.stubGlobal("fetch", () => {
      callCount++;
      return Promise.resolve(
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: [] }), { status: 200 }),
      );
    });

    const start = Date.now();
    await client.getTipAccounts(ctrl.signal);
    await client.getTipAccounts(ctrl.signal);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(900);
    expect(callCount).toBe(2);
  }, 3000);

  it("(d) rate limiter: concurrent calls serialize ≥ 1000 ms apart (no stale-timestamp race)", async () => {
    const ctrl = new AbortController();
    const client = new JitoClient("https://frankfurt.mainnet.block-engine.jito.wtf");

    let callCount = 0;
    vi.stubGlobal("fetch", () => {
      callCount++;
      return Promise.resolve(
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: [] }), { status: 200 }),
      );
    });

    // Prime: one call sets _lastRequestMs to ~now so the next two both compute wait > 0.
    await client.getTipAccounts(ctrl.signal);

    const start = Date.now();
    // Fire two calls concurrently. With a stale-timestamp race both would read the
    // same _lastRequestMs, wake together, and fire ~0 ms apart (total ≈ 1000 ms).
    // Correctly serialized, the second waits behind the first (total ≈ 2000 ms).
    await Promise.all([
      client.getTipAccounts(ctrl.signal),
      client.getTipAccounts(ctrl.signal),
    ]);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(1800);
    expect(callCount).toBe(3);
  }, 5000);

  it("(b) sendBundle builds correct JSON-RPC body", async () => {
    const ctrl = new AbortController();
    const client = new JitoClient("https://frankfurt.mainnet.block-engine.jito.wtf");

    let capturedBody: unknown;
    vi.stubGlobal("fetch", (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string);
      return Promise.resolve(
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "abc123" }), { status: 200 }),
      );
    });

    const result = await client.sendBundle(["tx1"], ctrl.signal);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("abc123");
    expect(capturedBody).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      method: "sendBundle",
      params: [["tx1"], { encoding: "base64" }],
    });
  });

  it("(c) a transient 429 is retried and recovers on the next attempt", async () => {
    const ctrl = new AbortController();
    const client = new JitoClient("https://frankfurt.mainnet.block-engine.jito.wtf");

    let calls = 0;
    vi.stubGlobal("fetch", () => {
      calls++;
      if (calls === 1) return Promise.resolve(new Response("Too Many Requests", { status: 429 }));
      return Promise.resolve(
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: ["tipAcct"] }), { status: 200 }),
      );
    });

    const result = await client.getTipAccounts(ctrl.signal);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(["tipAcct"]);
    expect(calls).toBe(2); // 429 once, then success
  }, 4000);

  it("(e) a non-retryable HTTP error (e.g. 400) fails immediately without retry", async () => {
    const ctrl = new AbortController();
    const client = new JitoClient("https://frankfurt.mainnet.block-engine.jito.wtf");

    let calls = 0;
    vi.stubGlobal("fetch", () => {
      calls++;
      return Promise.resolve(new Response("Bad Request", { status: 400 }));
    });

    const result = await client.getTipAccounts(ctrl.signal);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.reason).toContain("400");
    expect(calls).toBe(1); // no retry on 400
  });
});
