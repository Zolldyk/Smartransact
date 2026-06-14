// web/server/serialize.ts
//
// Bigint-safe serialization for the WebSocket evidence frame. Evidence events
// still carry bigint fields (`slot`, `tipLamports`, …) when they reach the
// `onEvidence` callback — `JSON.stringify` throws on bigint. We reuse the
// project's single sanctioned bigint→number path (`serializeBigInt` from
// src/core/units.ts, the same one `evidence-log.ts`'s `bigintReplacer` uses),
// so the browser receives EXACTLY what is persisted to the JSONL file — bigints
// as JSON numbers. The WS contract is the bare EvidenceEvent object, one JSON
// message per event (no wrapper envelope — evidence integrity for the frontend).

import { serializeBigInt } from "../../src/core/units.js";
import type { EvidenceEvent } from "../../src/schemas/evidence-event-schema.js";

export function serializeEvidence(event: EvidenceEvent): string {
  return JSON.stringify(event, (_key, value) =>
    typeof value === "bigint" ? serializeBigInt(value) : value,
  );
}
