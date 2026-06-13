import { describe, it, expect } from "vitest";
import { becameStaleAtSlot, faultInjectedEvent } from "./blockhash-expiry.js";
import { MAX_PROCESSING_AGE_SLOTS } from "../protocol.js";
import { EvidenceEventSchema } from "../../schemas/evidence-event-schema.js";

describe("becameStaleAtSlot", () => {
  it("(a) expiry slot = fetchedAtSlot + MAX_PROCESSING_AGE_SLOTS + 1", () => {
    const fetchedAtSlot = 1_000n;
    expect(becameStaleAtSlot(fetchedAtSlot)).toBe(
      fetchedAtSlot + MAX_PROCESSING_AGE_SLOTS + 1n,
    );
    // concrete cross-check: 1000 + 150 + 1
    expect(becameStaleAtSlot(1_000n)).toBe(1_151n);
  });
});

describe("faultInjectedEvent", () => {
  it("(b) builds a schema-valid faultInjected event with correct stale slot", () => {
    const event = faultInjectedEvent("FakeBlockhash111", 500n);
    expect(() => EvidenceEventSchema.parse(event)).not.toThrow();
    expect(event.event).toBe("faultInjected");
    expect(event.fetchedAtSlot).toBe(500n);
    expect(event.becameStaleAtSlot).toBe(500n + MAX_PROCESSING_AGE_SLOTS + 1n);
  });
});
