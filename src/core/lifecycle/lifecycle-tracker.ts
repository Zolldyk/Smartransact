import { type EvidenceLog } from "../evidence/evidence-log.js";
import { type TxStatusChanged } from "../../schemas/stream-event-schema.js";

type BundleStage = "submitted" | "processed" | "confirmed" | "finalized";

// Commitment is monotonic: submitted < processed < confirmed < finalized. Real
// WS/gRPC signature subscriptions deliver duplicate, out-of-order, and
// stage-skipping notifications, so progression is gated by rank, not by an
// exact next-stage match.
const STAGE_RANK: Record<BundleStage, number> = {
  submitted: 0,
  processed: 1,
  confirmed: 2,
  finalized: 3,
};

type BundleRecord = {
  stage: BundleStage;
  lastMs: number; // performance.now() at last state entry
};

export class LifecycleTracker {
  private readonly bundles = new Map<string, BundleRecord>();

  constructor(private readonly evidenceLog: EvidenceLog) {}

  register(bundleId: string): void {
    this.bundles.set(bundleId, { stage: "submitted", lastMs: performance.now() });
  }

  consume(event: TxStatusChanged, bundleId: string): void {
    const record = this.bundles.get(bundleId);
    if (record === undefined) return; // unknown bundle — not this tracker's scope

    if (record.stage === "finalized") return; // terminal — ignore further events

    const newStage = event.commitment; // "processed" | "confirmed" | "finalized"

    // Only a STRICTLY FORWARD stage is a real advance. Same-stage (duplicate)
    // or backward (stale / reordered) notifications are ignored silently — no
    // throw, no fabricated event. A forward jump (e.g. submitted → confirmed
    // when the `processed` notification was missed) is accepted and recorded as
    // the stage actually observed; the skipped intermediate is NEVER synthesized
    // (that would be staged data). Commitment is monotonic, so the later stage
    // is a true, on-chain-backed progression.
    if (STAGE_RANK[newStage] <= STAGE_RANK[record.stage]) return;

    const nowMs = performance.now();
    const latencyFromPrevMs = nowMs - record.lastMs;

    this.evidenceLog.append({
      event: "commitmentTransition",
      at: new Date().toISOString(),
      bundleId,
      stage: newStage,
      slot: event.slot,
      latencyFromPrevMs,
      source: {
        kind: "txStatusChanged",
        transport: event.transport,
        signature: event.signature,
        commitment: event.commitment,
        slot: event.slot,
        subscriptionId: event.subscriptionId,
      },
    });

    record.stage = newStage;
    record.lastMs = nowMs;
  }
}
