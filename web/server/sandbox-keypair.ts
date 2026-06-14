// web/server/sandbox-keypair.ts
//
// NFR9 SAFETY (AC6): the public sandbox server must NEVER load the funded payer
// (`keypair-mainnet.json`). But `buildBundle` (src/core/jito/bundle-builder.ts)
// reads AND signs with `config.keypairPath` at orchestrator.ts:312 — BEFORE the
// dryRun skip at orchestrator.ts:320. So a dryRun session still loads and signs
// with the keypair file; it just never submits the signed bundle.
//
// Therefore the only safe design is to point `config.keypairPath` at a key that
// holds NO funds. We generate a brand-new ephemeral ed25519 keypair at server
// startup and write it to an OS temp path. It can never have a balance (its
// private key is created in-process and discarded on shutdown), so even if a
// signed-but-unsent bundle leaked, it would move zero SOL.
//
// We use Node's built-in crypto (no extra dependency, no extractable-CryptoKey
// gymnastics): an ed25519 PKCS8 DER ends with the 32-byte seed and an SPKI DER
// ends with the 32-byte public key. The Solana keypair file format is exactly
// `seed(32) || publicKey(32)` = 64 bytes — the same shape
// `createKeyPairSignerFromBytes` consumes in `buildBundle`.

import { generateKeyPairSync } from "node:crypto";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Builds a fresh, never-funded 64-byte Solana secret key (seed || pubkey). */
export function generateSandboxSecretKey(): number[] {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pkcs8 = privateKey.export({ type: "pkcs8", format: "der" });
  const seed = pkcs8.subarray(pkcs8.length - 32);
  const spki = publicKey.export({ type: "spki", format: "der" });
  const pub = spki.subarray(spki.length - 32);

  const secret = new Uint8Array(64);
  secret.set(seed, 0);
  secret.set(pub, 32);
  return Array.from(secret);
}

/**
 * Generates an ephemeral sandbox keypair and writes it to a temp file as a JSON
 * byte array (the format `buildBundle` reads via `readFileSync` + `JSON.parse`).
 * Returns the absolute path to use as `config.keypairPath`. The directory lives
 * under the OS temp dir and is never committed; the key holds zero funds.
 */
export function writeEphemeralSandboxKeypair(): string {
  const dir = mkdtempSync(join(tmpdir(), "smartransact-sandbox-"));
  const path = join(dir, "sandbox-keypair.json");
  writeFileSync(path, JSON.stringify(generateSandboxSecretKey()));
  return path;
}
