import { z } from "zod";

/**
 * Contract #2 — the LifecycleStream unified event model. A discriminated union
 * on `kind` that every stream transport (WebSocket, gRPC) normalizes into.
 *
 * Stream events are never serialized to JSON (only evidence events are), so
 * using a real Map for the leader schedule is fine here. Slot fields are bigint.
 */

export const SlotAdvancedSchema = z.object({
  kind: z.literal("slotAdvanced"),
  slot: z.bigint(),
  parent: z.bigint().optional(),
});

export const LeaderScheduleUpdatedSchema = z.object({
  kind: z.literal("leaderScheduleUpdated"),
  schedule: z.map(z.bigint(), z.string()),
  at: z.string(),
});

export const TxStatusChangedSchema = z.object({
  kind: z.literal("txStatusChanged"),
  signature: z.string(),
  commitment: z.enum(["processed", "confirmed", "finalized"]),
  slot: z.bigint(),
  transport: z.enum(["ws", "grpc"]),
  subscriptionId: z.union([z.number(), z.string()]).optional(),
});

export const StreamReconnectedSchema = z.object({
  kind: z.literal("streamReconnected"),
  at: z.string(),
  attempt: z.number().int().nonnegative(),
});

export const StreamEventsDroppedSchema = z.object({
  kind: z.literal("eventsDropped"),
  at: z.string(),
  count: z.number().int().positive(),
});

export const StreamEventSchema = z.discriminatedUnion("kind", [
  SlotAdvancedSchema,
  LeaderScheduleUpdatedSchema,
  TxStatusChangedSchema,
  StreamReconnectedSchema,
  StreamEventsDroppedSchema,
]);

export type SlotAdvanced = z.infer<typeof SlotAdvancedSchema>;
export type LeaderScheduleUpdated = z.infer<typeof LeaderScheduleUpdatedSchema>;
/** Referenced by evidence-event-schema's `source` field (carried as data, not imported). */
export type TxStatusChanged = z.infer<typeof TxStatusChangedSchema>;
export type StreamReconnected = z.infer<typeof StreamReconnectedSchema>;
export type StreamEventsDropped = z.infer<typeof StreamEventsDroppedSchema>;
export type StreamEvent = z.infer<typeof StreamEventSchema>;
