import { appendFileSync, mkdirSync } from "node:fs";
import { serializeBigInt } from "../units.js";
import {
  EvidenceEventSchema,
  type EvidenceEvent,
} from "../../schemas/evidence-event-schema.js";

function bigintReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") {
    return serializeBigInt(value);
  }
  return value;
}

export class EvidenceLog {
  private readonly filePath: string;
  private closed = false;
  private readonly onAppend?: (event: EvidenceEvent) => void;
  private readonly onSigint = (): void => {
    this.close();
    process.exit(0);
  };

  /** When `suppressSigint` is true the log does NOT register its own SIGINT
   * handler — used when the orchestrator owns shutdown and guarantees the log
   * is flushed before process.exit.
   *
   * `onAppend` is an optional subscriber invoked AFTER each event is validated
   * AND persisted (see `append()`); it is the evidence-streaming seam used by
   * the web backend (Story 8.1) to forward exactly what is written to JSONL.
   * `append()` remains the sole JSONL writer — the callback is read-only. */
  constructor(
    sessionId: string,
    options?: { suppressSigint?: boolean; onAppend?: (event: EvidenceEvent) => void },
  ) {
    mkdirSync("logs", { recursive: true });
    this.filePath = `logs/lifecycle-${sessionId}.jsonl`;
    this.onAppend = options?.onAppend;
    if (!options?.suppressSigint) {
      process.once("SIGINT", this.onSigint);
    }
  }

  append(event: EvidenceEvent): void {
    if (this.closed) {
      throw new Error("EvidenceLog is closed");
    }
    EvidenceEventSchema.parse(event);
    const line = JSON.stringify(event, bigintReplacer) + "\n";
    appendFileSync(this.filePath, line);
    // Fire LAST — post-validate, post-write — so a subscriber receives exactly
    // what is persisted (AC1). A throwing subscriber is the subscriber's bug;
    // core logic is intentionally not wrapped in try/catch here (the web
    // backend wraps its own ws.send defensively).
    this.onAppend?.(event);
  }

  close(): void {
    this.closed = true;
    process.removeListener("SIGINT", this.onSigint);
  }
}
