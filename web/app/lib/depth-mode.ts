// web/app/lib/depth-mode.ts
//
// The global Basic⇄Technical depth model (AC2). The toggle swaps ONLY
// labels/captions/revealed data — the visual (geometry, which stage glows, which
// pip is live) is identical in both modes, so this module is pure copy + a tiny
// persistence hook. Basic = plain language + inline jargon glosses; Technical =
// real terms + on-chain data.
//
// Persisted "per session" per EXPERIENCE.md → sessionStorage (NOT localStorage),
// default "basic". SSR-safe: we default to basic on first paint and read the
// stored value in useEffect, so there is no hydration mismatch.

"use client";

import { useCallback, useEffect, useState } from "react";
import type { StageId } from "./lifecycle-state";

export type DepthMode = "basic" | "technical";

const STORAGE_KEY = "smartransact:depth";

/** Read the persisted depth (client only; defaults to basic). */
function readStored(): DepthMode {
  if (typeof window === "undefined") return "basic";
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) === "technical" ? "technical" : "basic";
  } catch {
    return "basic";
  }
}

/**
 * useDepthMode — the session-persisted Basic/Technical hook. Defaults to "basic"
 * on the server and first client paint (no hydration mismatch), then adopts the
 * stored value after mount.
 */
export function useDepthMode(): { mode: DepthMode; setMode: (m: DepthMode) => void } {
  const [mode, setModeState] = useState<DepthMode>("basic");

  useEffect(() => {
    setModeState(readStored());
  }, []);

  const setMode = useCallback((m: DepthMode) => {
    setModeState(m);
    if (typeof window !== "undefined") {
      try {
        window.sessionStorage.setItem(STORAGE_KEY, m);
      } catch {
        // storage unavailable (private mode) — in-memory only is fine
      }
    }
  }, []);

  return { mode, setMode };
}

// ── Copy maps (the source of truth is the mock copy; spine wins on conflict) ───

/** Per-stage rendering for each depth mode. `data` (Technical) is filled at
 * render time from event-carried values; here it's the static label/description. */
export interface StageCopy {
  title: string;
  description: string;
}

export const STAGE_COPY: Record<DepthMode, Record<StageId, StageCopy>> = {
  basic: {
    package: { title: "Package it up", description: "Bundle the transaction with a small priority tip." },
    aim: { title: "Find the moment", description: "Wait for the right validator’s turn to include it." },
    send: { title: "Send it", description: "Hand it to Jito to be placed in a block." },
    track: { title: "Track it land", description: "Follow it through to confirmed & final." },
    landed: { title: "Landed", description: "On-chain." },
  },
  technical: {
    package: { title: "Build bundle + tip", description: "1 transfer + tip instruction, signed." },
    aim: { title: "Jito leader window", description: "getNextScheduledLeader." },
    send: { title: "Block Engine", description: "POST /api/v1/bundles · base64." },
    track: { title: "Commitment", description: "processed · confirmed · finalized." },
    landed: { title: "Finalized", description: "On-chain, irreversible." },
  },
};

/** Live-input chip labels per mode (the geometry/order is identical). */
export interface InputCopy {
  network: string;
  leader: string;
  tip: string;
}

export const INPUT_COPY: Record<DepthMode, InputCopy> = {
  basic: { network: "Network speed", leader: "Whose turn it is", tip: "Going rate for priority" },
  technical: { network: "Slot stream", leader: "Leader schedule", tip: "Tip floor · p25–p99" },
};

/** The agent recovery band's voice per mode. */
export interface AgentVoiceCopy {
  tag: string;
  headline: string;
  /** The compact "reads why → decides → resends" mini-steps. */
  steps: [string, string, string];
}

export const AGENT_VOICE: Record<DepthMode, AgentVoiceCopy> = {
  basic: {
    tag: "◆ The AI agent",
    headline: "When a transaction fails, the agent fixes it",
    steps: ["reads why", "decides a fix", "resends"],
  },
  technical: {
    tag: "◆ Agent · adaptive retry",
    headline: "classifyFailure → AgentDecision → executeDecision",
    steps: ["classify", "decide", "resubmit"],
  },
};

/** Plain-language gloss definitions for inline dotted-underline terms (Basic). */
export const GLOSSARY: Record<string, string> = {
  blockhash:
    "A recent block fingerprint a transaction must reference. It expires after ~150 slots (about a minute), after which the network rejects it.",
  slot: "Solana’s ~400ms time unit — one leader’s turn to produce a block.",
  tip: "An extra payment to Jito to prioritize your bundle for the next block.",
  "leader window": "The short span of slots when a specific validator (a Jito leader) is producing blocks.",
  bundle: "A group of transactions submitted together to Jito, included all-or-nothing.",
  finalized: "The strongest confirmation — the transaction is permanent and irreversible on-chain.",
};
