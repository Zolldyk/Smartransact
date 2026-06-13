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
  private readonly onSigint = (): void => {
    this.close();
    process.exit(0);
  };

  /** When `suppressSigint` is true the log does NOT register its own SIGINT
   * handler — used when the orchestrator owns shutdown and guarantees the log
   * is flushed before process.exit. */
  constructor(sessionId: string, options?: { suppressSigint?: boolean }) {
    mkdirSync("logs", { recursive: true });
    this.filePath = `logs/lifecycle-${sessionId}.jsonl`;
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
  }

  close(): void {
    this.closed = true;
    process.removeListener("SIGINT", this.onSigint);
  }
}
