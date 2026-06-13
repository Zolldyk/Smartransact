import { z } from "zod";

/**
 * Contract #3b — the agent decision (LLM output). LLM-facing, so numeric fields
 * are `z.number()`. `diagnosis` and `rationale` are required non-empty strings
 * (`.min(1)`) — this prevents the LLM from returning empty reasoning.
 *
 * `newTipLamports` is present only when action changes a tip (`adjust_tip`, or
 * `refresh` with a tip change); `holdSlots` only when action is `hold`. Both use
 * `.optional()` (not `.nullable()`) — omitted fields are absent, not null.
 */
export const AgentDecisionSchema = z
  .object({
    diagnosis: z.string().min(1),
    action: z.enum(["refresh", "adjust_tip", "hold", "abort"]),
    newTipLamports: z.number().int().nonnegative().optional(),
    holdSlots: z.number().int().positive().optional(),
    rationale: z.string().min(1),
  })
  .superRefine((d, ctx) => {
    if (d.action === "adjust_tip" && d.newTipLamports === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["newTipLamports"],
        message: "newTipLamports is required when action is adjust_tip",
      });
    }
    if (d.action === "hold" && d.holdSlots === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["holdSlots"],
        message: "holdSlots is required when action is hold",
      });
    }
  });

export type AgentDecision = z.infer<typeof AgentDecisionSchema>;
export type AgentAction = z.infer<typeof AgentDecisionSchema>["action"];
