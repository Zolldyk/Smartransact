#!/usr/bin/env bash
# Generate a dedicated mainnet keypair for the Smartransact evidence run.
# Fund the printed address with 0.06–0.1 SOL before running smartransact run --live.
set -euo pipefail

OUT="keypair-mainnet.json"
if [[ -f "$OUT" ]]; then
  echo "Keypair already exists at $OUT — delete it first to regenerate."
  exit 1
fi

solana-keygen new --no-bip39-passphrase --outfile "$OUT"
echo ""
echo "Public key: $(solana-keygen pubkey $OUT)"
echo ""
echo "Next steps:"
echo "  1. Fund the above address with 0.06–0.1 SOL on mainnet."
echo "  2. Add to .env: KEYPAIR_PATH=$(pwd)/$OUT"
echo "  3. Run: smartransact run --profile mainnet-grpc --live"
