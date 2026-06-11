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

  constructor(sessionId: string) {
    mkdirSync("logs", { recursive: true });
    this.filePath = `logs/lifecycle-${sessionId}.jsonl`;
    process.once("SIGINT", () => {
      this.close();
      process.exit(0);
    });
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
  }
}
