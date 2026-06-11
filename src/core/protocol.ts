/**
 * Protocol facts about Solana and the Jito Block Engine. These are NOT tunable
 * values — they are constants of the protocol itself. Tunables (tip amounts,
 * retry counts, endpoints) belong in smartransact.config.json, never here.
 *
 * Zero imports by design.
 */

/** Solana blockhash validity window in slots. A blockhash is expired after this
 * many slots have passed since it was fetched. bigint — used in arithmetic with
 * slot bigint values.
 * @see https://docs.solanalabs.com/consensus/commitments — ~150 slots ≈ 60 seconds
 */
export const MAX_PROCESSING_AGE_SLOTS = 150n;

/** Maximum number of transactions per Jito bundle. number — used in count
 * comparisons such as `bundle.length > JITO_MAX_BUNDLE_TXS`.
 * @see https://jito-labs.gitbook.io/mev/searcher-resources/bundles
 */
export const JITO_MAX_BUNDLE_TXS = 5;

/** Minimum tip required by the Jito Block Engine, in lamports. bigint — used in
 * arithmetic with lamport bigint values.
 * @see https://jito-labs.gitbook.io/mev/searcher-resources/bundles
 */
export const JITO_MIN_TIP_LAMPORTS = 1_000n;

/** Solana commitment levels in ascending finality order.
 * @see https://docs.solana.com/developing/clients/jsonrpc-api#configuring-state-commitment
 */
export const COMMITMENT_LEVELS = ["processed", "confirmed", "finalized"] as const;
export type CommitmentLevel = (typeof COMMITMENT_LEVELS)[number];
