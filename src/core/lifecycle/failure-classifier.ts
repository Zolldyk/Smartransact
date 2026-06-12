export type ClassifiedFailure = {
  classification:
    | "expired_blockhash"
    | "fee_too_low"
    | "compute_exceeded"
    | "bundle_failure";
  rawError: string;
};

const PATTERNS: Array<[RegExp, ClassifiedFailure["classification"]]> = [
  [
    /BlockhashNotFound|Blockhash not found|block height exceeded|blockhash.*expired|transaction.*too old|transaction.*expired/i,
    "expired_blockhash",
  ],
  [
    /InsufficientFundsForFee|insufficient funds for fee|insufficient lamports.*fee/i,
    "fee_too_low",
  ],
  [
    /ComputationalBudgetExceeded|exceeded.*compute units|compute budget exceeded/i,
    "compute_exceeded",
  ],
];

export function classifyFailure(error: unknown): ClassifiedFailure {
  const rawError = error instanceof Error ? error.message : String(error);
  for (const [pattern, classification] of PATTERNS) {
    if (pattern.test(rawError)) return { classification, rawError };
  }
  return { classification: "bundle_failure", rawError };
}
