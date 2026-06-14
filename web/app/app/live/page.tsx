"use client";

// /live — MINIMAL PLACEHOLDER (story 8.2 AC6). Story 8.3 replaces this with the
// real transaction-flow centerpiece (pipeline, CommitPips, agent drawer, the
// Basic/Technical toggle). For now it proves the WS pipe end-to-end: it opens
// the backend socket with the launch overrides (handed over in-memory from Run),
// sends them as the first frame, and renders connection state + a running count
// of received evidence events. A clean default dryRun run streams exactly
// `sessionStarted → sessionEnded` (count ticks to 2) — that is correct, not a
// bug (the orchestrator emits no per-bundle events in dryRun).

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { takePendingSession } from "@/lib/pending-session";
import { openSession, type ConnectionState, type SessionHandle } from "@/lib/session-client";
import type { ClientOverrides } from "@/lib/overrides";
import { DryRunSafeBadge } from "@/components/ui/badge";

const STATE_LABEL: Record<ConnectionState, string> = {
  connecting: "connecting to mainnet…",
  live: "live — streaming evidence",
  closed: "session complete",
  error: "connection problem",
};

export default function LivePage() {
  const [overrides] = useState<ClientOverrides | null>(() => takePendingSession());
  const [conn, setConn] = useState<ConnectionState>("connecting");
  const [count, setCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const handleRef = useRef<SessionHandle | null>(null);

  useEffect(() => {
    if (!overrides) return;
    const handle = openSession(overrides, {
      onState: setConn,
      onEvent: () => setCount((c) => c + 1),
      onError: (msg) => setError(msg),
    });
    handleRef.current = handle;
    return () => handle.close();
  }, [overrides]);

  // Arrived without a launch (refresh / deep link) — honest empty state.
  if (!overrides) {
    return (
      <div className="wrap">
        <div className="live-card">
          <div className="eyebrow">Live</div>
          <h2 style={{ marginTop: 14 }}>No active session</h2>
          <p className="conn-label" style={{ marginTop: 8 }}>
            The full mainnet replay lands here in a later story. For now, start your own dryRun session.
          </p>
          <p style={{ marginTop: 22 }}>
            <Link href="/run" className="btn-ghost">
              Go to Run →
            </Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="wrap">
      <div className="live-card">
        <div className="eyebrow" style={{ marginBottom: 18 }}>
          Your session
        </div>

        <p className="conn-label">
          <span className={`conn-dot ${conn}`} aria-hidden="true" />
          {STATE_LABEL[conn]}
        </p>

        <div className="count-big mono" aria-live="polite">
          {count}
        </div>
        <div className="count-label">evidence events received</div>

        {error && (
          <div className="live-error" role="alert">
            {error}
          </div>
        )}

        <p style={{ marginTop: 24 }}>
          <DryRunSafeBadge />
        </p>

        <p className="conn-label" style={{ marginTop: 20, fontSize: 12 }}>
          A clean dryRun run streams <span className="mono">sessionStarted → sessionEnded</span>. The full lifecycle visualization
          arrives in the next story.
        </p>
      </div>
    </div>
  );
}
