import { describe, it, expect } from "vitest";
import {
  Keypair,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  SearcherClient,
  buildSearcherBundle,
  type JitoSearcherTransport,
} from "./searcher-client.js";

// Build a real base64 wire transaction WITHOUT touching the network — a fixed
// blockhash (any 32-byte base58 string works for serialization purposes).
function makeBase64Tx(): string {
  const payer = Keypair.generate();
  const blockhash = Keypair.generate().publicKey.toBase58();
  const ix = SystemProgram.transfer({
    fromPubkey: payer.publicKey,
    toPubkey: payer.publicKey,
    lamports: 1,
  });
  const msg = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions: [ix],
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign([payer]);
  return Buffer.from(tx.serialize()).toString("base64");
}

describe("buildSearcherBundle", () => {
  it("(a) deserializes base64 wire txs into a Bundle without re-tipping", () => {
    const b64 = makeBase64Tx();
    const bundle = buildSearcherBundle([b64]);
    // One input tx → exactly one packet (addTipTx would have added a second).
    expect(bundle.packets.length).toBe(1);
  });
});

describe("SearcherClient", () => {
  it("(a) sendBundle: builds the Bundle from base64, never calls addTipTx, returns bundle id", async () => {
    const b64 = makeBase64Tx();
    let received: import("jito-ts/dist/sdk/block-engine/types.js").Bundle | undefined;
    const transport: JitoSearcherTransport = {
      getTipAccounts: async () => ({ ok: true, value: ["tip1"] }),
      getNextScheduledLeader: async () => ({
        ok: true,
        value: { currentSlot: 1, nextLeaderSlot: 4, nextLeaderIdentity: "v" },
      }),
      sendBundle: async (bundle) => {
        received = bundle;
        return { ok: true, value: "bundle-id-xyz" };
      },
    };
    const c = new SearcherClient("host", "/dev/null", transport);
    const res = await c.sendBundle([b64]);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value).toBe("bundle-id-xyz");
    // One input tx → one packet (no tip tx appended by our path).
    expect(received?.packets.length).toBe(1);
  });

  it("(b) maps jito-ts { ok:false, error } → our fail({ reason })", async () => {
    const transport: JitoSearcherTransport = {
      getTipAccounts: async () => ({ ok: false, error: new Error("PERMISSION_DENIED") }),
      getNextScheduledLeader: async () => ({ ok: false, error: { msg: "denied" } }),
      sendBundle: async () => ({ ok: false, error: new Error("RESOURCE_EXHAUSTED") }),
    };
    const c = new SearcherClient("host", "/dev/null", transport);

    const tip = await c.getTipAccounts();
    expect(tip.ok).toBe(false);
    if (!tip.ok) expect(tip.failure.reason).toBe("PERMISSION_DENIED");

    const send = await c.sendBundle([makeBase64Tx()]);
    expect(send.ok).toBe(false);
    if (!send.ok) expect(send.failure.reason).toBe("RESOURCE_EXHAUSTED");

    const lead = await c.getNextScheduledLeader();
    expect(lead.ok).toBe(false);
    // non-Error errors are JSON-stringified
    if (!lead.ok) expect(lead.failure.reason).toContain("denied");
  });

  it("(c) getNextScheduledLeader: converts numeric slots → bigint", async () => {
    const transport: JitoSearcherTransport = {
      getTipAccounts: async () => ({ ok: true, value: [] }),
      getNextScheduledLeader: async () => ({
        ok: true,
        value: { currentSlot: 426838676, nextLeaderSlot: 426838680, nextLeaderIdentity: "v" },
      }),
      sendBundle: async () => ({ ok: true, value: "x" }),
    };
    const c = new SearcherClient("host", "/dev/null", transport);
    const res = await c.getNextScheduledLeader();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.currentSlot).toBe(426838676n);
      expect(res.value.nextLeaderSlot).toBe(426838680n);
    }
  });

  it("(d) getTipAccounts: passes through string pubkeys on success", async () => {
    const transport: JitoSearcherTransport = {
      getTipAccounts: async () => ({ ok: true, value: ["acc1", "acc2"] }),
      getNextScheduledLeader: async () => ({
        ok: true,
        value: { currentSlot: 1, nextLeaderSlot: 2, nextLeaderIdentity: "v" },
      }),
      sendBundle: async () => ({ ok: true, value: "x" }),
    };
    const c = new SearcherClient("host", "/dev/null", transport);
    const res = await c.getTipAccounts();
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value).toEqual(["acc1", "acc2"]);
  });
});
