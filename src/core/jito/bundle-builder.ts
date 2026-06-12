import {
  pipe,
  createTransactionMessage,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  getBase64EncodedWireTransaction,
  AccountRole,
  address,
  setTransactionMessageFeePayerSigner,
  createKeyPairSignerFromBytes,
  type BlockhashLifetimeConstraint,
  type KeyPairSigner,
  type Address,
} from "@solana/kit";
import { readFileSync } from "node:fs";
import { JITO_MAX_BUNDLE_TXS } from "../protocol.js";

const SYSTEM_PROGRAM = address("11111111111111111111111111111111");

function transferInstruction(signer: KeyPairSigner, to: Address, lamports: bigint) {
  const data = new Uint8Array(12);
  const view = new DataView(data.buffer);
  view.setUint32(0, 2, true);
  view.setBigUint64(4, lamports, true);
  return {
    programAddress: SYSTEM_PROGRAM,
    accounts: [
      { address: signer.address, role: AccountRole.WRITABLE_SIGNER, signer },
      { address: to, role: AccountRole.WRITABLE },
    ],
    data,
  };
}

export type BundleParams = {
  lifetimeConstraint: BlockhashLifetimeConstraint;
  keypairPath: string;
  tipAccount: string;
  tipLamports: bigint;
  txCount?: 1 | 2;
};

export async function buildBundle(params: BundleParams): Promise<string[]> {
  const txCount = params.txCount ?? 2;
  if (txCount > JITO_MAX_BUNDLE_TXS) {
    throw new Error(
      `bundle txCount ${txCount} exceeds JITO_MAX_BUNDLE_TXS (${JITO_MAX_BUNDLE_TXS})`,
    );
  }

  const keypairBytes = new Uint8Array(
    JSON.parse(readFileSync(params.keypairPath, "utf-8") as string) as number[],
  );
  const signer = await createKeyPairSignerFromBytes(keypairBytes);
  const tipAddr = address(params.tipAccount);

  // Transaction 1: self-transfer + tip (tip integrated per Jito best practice)
  const msg1 = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(signer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(params.lifetimeConstraint, m),
    (m) =>
      appendTransactionMessageInstructions(
        [
          transferInstruction(signer, signer.address, 1n),
          transferInstruction(signer, tipAddr, params.tipLamports),
        ],
        m,
      ),
  );
  const signed1 = await signTransactionMessageWithSigners(msg1);

  if (txCount === 1) {
    return [getBase64EncodedWireTransaction(signed1)];
  }

  // Transaction 2: self-transfer only
  const msg2 = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(signer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(params.lifetimeConstraint, m),
    (m) =>
      appendTransactionMessageInstructions(
        [transferInstruction(signer, signer.address, 1n)],
        m,
      ),
  );
  const signed2 = await signTransactionMessageWithSigners(msg2);

  return [
    getBase64EncodedWireTransaction(signed1),
    getBase64EncodedWireTransaction(signed2),
  ];
}
