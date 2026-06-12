import { type EvidenceLog } from "../evidence/evidence-log.js";
import { type TxStatusChanged } from "../../schemas/stream-event-schema.js";

type BundleStage = "submitted" | "processed" | "confirmed" | "finalized";

const VALID_NEXT: Record<BundleStage, "processed" | "confirmed" | "finalized" | undefined> = {
  submitted:  "processed",
  processed:  "confirmed",
  confirmed:  "finalized",
  finalized:  undefined,
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

    const expectedNext = VALID_NEXT[record.stage];
    const newStage = event.commitment; // "processed" | "confirmed" | "finalized"

    if (newStage !== expectedNext) {
      throw new Error(
        `Illegal lifecycle transition for ${bundleId}: ${record.stage} → ${newStage}`,
      );
    }

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
