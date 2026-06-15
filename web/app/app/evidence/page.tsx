"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { parseEvidenceEvent, type EvidenceEvent } from "@/lib/evidence-events";
import { parseEvidence, type BundleRow, type EvidenceTableData } from "@/lib/evidence-parser";
import { useDepthMode, type DepthMode } from "@/lib/depth-mode";
import { RealMainnetRunBadge } from "@/components/ui/badge";
import { SegmentedToggle } from "@/components/ui/segmented-toggle";

const DEPTH_OPTIONS = [
  { value: "basic" as const, label: "Basic" },
  { value: "technical" as const, label: "Technical" },
] as const;

const HEADERS: Record<DepthMode, readonly string[]> = {
  basic: ["#", "status", "submit slot", "final slot", "tip", "time to confirm", "what failed", "what the AI did", ""],
  technical: ["#", "status", "submit slot ↗", "finalized slot", "tip (lamports)", "proc→conf ms", "classification", "agent action", ""],
};

function explorerBlock(slot: number): string {
  return `https://explorer.solana.com/block/${slot}?cluster=mainnet-beta`;
}
function explorerTx(sig: string): string {
  return `https://explorer.solana.com/tx/${sig}?cluster=mainnet-beta`;
}

function statusDotClass(status: BundleRow["status"]): string {
  switch (status) {
    case "landed": return "ev-dot ok";
    case "recovered": return "ev-dot rec";
    case "failed": return "ev-dot fail";
    default: return "ev-dot pend";
  }
}

function formatTip(lamports: number | null): string {
  return lamports === null ? "—" : lamports.toLocaleString("en-US");
}

function formatMs(ms: number | null): string {
  return ms === null ? "—" : ms.toLocaleString("en-US");
}

function DetailPanel({ row }: { row: BundleRow }) {
  return (
    <div
      role="region"
      aria-label={`Bundle ${row.bundleIdx} details`}
      className="ev-detail"
    >
      {row.episode ? (
        <div>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-faint)", marginBottom: 5 }}>
              diagnosis
            </div>
            <div style={{ fontSize: 13, color: "var(--color-text)", lineHeight: 1.5 }}>
              {row.episode.diagnosis}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: row.episode.rationale ? 10 : 0 }}>
            <span className="ev-chip">{row.episode.action}</span>
            {row.episode.newTipLamports !== undefined && (
              <span style={{ fontSize: 12, color: "var(--color-muted)", fontFamily: "var(--font-mono)" }}>
                → {row.episode.newTipLamports.toLocaleString("en-US")} lamports
              </span>
            )}
          </div>
          {row.episode.rationale && (
            <div style={{ fontSize: 12, color: "var(--color-muted)", marginBottom: 10, lineHeight: 1.5 }}>
              {row.episode.rationale}
            </div>
          )}
          {row.episode.thinkingTrace && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-faint)", cursor: "pointer", userSelect: "none" }}>
                thinking trace
              </summary>
              <div style={{ marginTop: 8, padding: "10px 12px", borderRadius: 8, background: "var(--color-field)", boxShadow: "inset 0 0 0 1px var(--color-line)", fontSize: 11, lineHeight: 1.65, color: "var(--color-muted)", whiteSpace: "pre-wrap", fontFamily: "var(--font-mono)" }}>
                {row.episode.thinkingTrace}
              </div>
            </details>
          )}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: "var(--color-faint)" }}>No agent decision recorded for this bundle.</div>
      )}

      {row.commitmentTimeline.length > 0 && (
        <div style={{ marginTop: 14, borderTop: "1px solid var(--color-hair)", paddingTop: 12 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-faint)", marginBottom: 8 }}>
            commitment timeline
          </div>
          {row.commitmentTimeline.map((step) => (
            <div key={step.stage} style={{ display: "flex", gap: 10, marginBottom: 6, fontSize: 12, fontFamily: "var(--font-mono)", alignItems: "center" }}>
              <span style={{ color: "var(--color-muted)", minWidth: 70 }}>{step.stage}</span>
              <span style={{ color: "var(--color-text)" }}>slot {step.slot.toLocaleString("en-US")}</span>
              <span style={{ color: "var(--color-faint)" }}>+{step.latencyMs}ms</span>
              {step.stage === "finalized" && step.signature && (
                <a
                  href={explorerTx(step.signature)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="slot-link"
                  aria-label={`View finalized transaction on Solana Explorer (opens in new tab)`}
                >
                  tx ↗
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 14, fontSize: 11, color: "var(--color-faint)", borderTop: "1px solid var(--color-hair)", paddingTop: 10 }}>
        Sourced from evidence/lifecycle-log.jsonl · nothing here is staged
      </div>
    </div>
  );
}

function EvidenceRow({
  row,
  isExpanded,
  onToggle,
  mode,
}: {
  row: BundleRow;
  isExpanded: boolean;
  onToggle: () => void;
  mode: DepthMode;
}) {
  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onToggle();
    }
  }

  const submitSlotCell = row.submitSlot !== null ? (
    <a
      href={explorerBlock(row.submitSlot)}
      target="_blank"
      rel="noopener noreferrer"
      className="slot-link"
      aria-label={`View slot ${row.submitSlot} on Solana Explorer (opens in new tab)`}
      onClick={(e) => e.stopPropagation()}
    >
      {row.submitSlot.toLocaleString("en-US")} ↗
    </a>
  ) : "—";

  const finalSlotCell = row.finalSignature ? (
    <a
      href={explorerTx(row.finalSignature)}
      target="_blank"
      rel="noopener noreferrer"
      className="slot-link"
      aria-label={`View finalized transaction on Solana Explorer (opens in new tab)`}
      onClick={(e) => e.stopPropagation()}
    >
      {row.finalSlot?.toLocaleString("en-US")} ↗
    </a>
  ) : row.finalSlot !== null ? (
    <a
      href={explorerBlock(row.finalSlot)}
      target="_blank"
      rel="noopener noreferrer"
      className="slot-link"
      aria-label={`View slot ${row.finalSlot} on Solana Explorer (opens in new tab)`}
      onClick={(e) => e.stopPropagation()}
    >
      {row.finalSlot.toLocaleString("en-US")} ↗
    </a>
  ) : "—";

  return (
    <>
      <tr
        className={`ev-row${isExpanded ? " expanded" : ""}`}
        tabIndex={0}
        role="row"
        aria-expanded={isExpanded}
        onClick={onToggle}
        onKeyDown={handleKey}
        style={{ cursor: "pointer" }}
      >
        <td>{row.bundleIdx}</td>
        <td>
          <span className={statusDotClass(row.status)} aria-hidden="true" />
          <span className="sr-only">{row.status}</span>
          <span>{row.status}</span>
        </td>
        <td>{submitSlotCell}</td>
        <td>{finalSlotCell}</td>
        <td style={{ fontFamily: "var(--font-mono)" }}>{formatTip(row.tipLamports)}</td>
        <td style={{ fontFamily: "var(--font-mono)" }}>{formatMs(row.procToConfMs)}</td>
        <td>{row.failureClassification ?? "—"}</td>
        <td>{row.agentAction ?? "—"}</td>
        <td style={{ color: "var(--color-faint)", fontSize: 12 }} aria-hidden="true">
          {isExpanded ? "▴" : "▾"}
        </td>
      </tr>
      {isExpanded && (
        <tr className="ev-detail-row">
          <td colSpan={9}>
            <DetailPanel row={row} />
          </td>
        </tr>
      )}
    </>
  );
}

export default function EvidencePage() {
  const [data, setData] = useState<EvidenceTableData | null>(null);
  const [expandedBundleId, setExpandedBundleId] = useState<string | null>(null);
  const { mode, setMode } = useDepthMode();

  useEffect(() => {
    fetch("/lifecycle-run.jsonl")
      .then((r) => r.text())
      .then((text) => {
        const events = text
          .split("\n")
          .map((line) => {
            if (!line.trim()) return null;
            try {
              return parseEvidenceEvent(JSON.parse(line));
            } catch {
              return null;
            }
          })
          .filter((e): e is EvidenceEvent => e !== null);
        setData(parseEvidence(events));
      })
      .catch(() => setData(parseEvidence([])));
  }, []);

  const loading = data === null;
  const empty = data !== null && data.rows.length === 0;

  function toggleRow(bundleId: string) {
    setExpandedBundleId((prev) => (prev === bundleId ? null : bundleId));
  }

  const headers = HEADERS[mode];

  return (
    <div className="app-center">
      <div className="ev-wrap">
        {/* Page head */}
        <div className="ev-head">
          <div className="eyebrow">The real mainnet run · committed evidence</div>
          <h1 style={{ margin: "13px 0 0", fontSize: 30, fontWeight: 660, letterSpacing: "-0.5px", lineHeight: 1.14 }}>
            Every bundle, every slot — verifiable
          </h1>
          <div className="flow-prov" style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <RealMainnetRunBadge />
            <p style={{ margin: 0, fontSize: 13, color: "var(--color-muted)", lineHeight: 1.5, maxWidth: 620 }}>
              This is the actual recorded session, straight from evidence/lifecycle-log.jsonl. Click any slot to confirm it on a public Solana explorer. Nothing here is staged.
            </p>
          </div>
        </div>

        {/* Stat cards */}
        {!loading && !empty && (
          <div className="ev-stats">
            <div className="ev-stat">
              <div className="ev-stat-v">{data.stats.bundlesSubmitted}</div>
              <div className="ev-stat-k">bundles submitted</div>
            </div>
            <div className="ev-stat">
              <div className="ev-stat-v s">{data.stats.landed}</div>
              <div className="ev-stat-k">landed</div>
            </div>
            <div className="ev-stat">
              <div className="ev-stat-v a">{data.stats.failures}</div>
              <div className="ev-stat-k">failures</div>
            </div>
            <div className="ev-stat">
              <div className="ev-stat-v c">{data.stats.agentRecoveries}</div>
              <div className="ev-stat-k">agent recoveries</div>
            </div>
          </div>
        )}

        {/* Table card */}
        <div className="ev-tablecard">
          <div className="ev-tbar">
            <span className="ev-tbar-t">Committed run · all bundles</span>
            <SegmentedToggle
              options={DEPTH_OPTIONS}
              value={mode}
              onChange={setMode}
              ariaLabel="Display mode"
            />
          </div>

          {loading ? (
            <div style={{ padding: "40px 18px", color: "var(--color-faint)", fontSize: 13 }}>
              Loading evidence…
            </div>
          ) : empty ? (
            <div style={{ padding: "48px 18px", textAlign: "center" }}>
              <p style={{ color: "var(--color-muted)", fontSize: 14 }}>
                No committed run yet — start one from the{" "}
                <Link href="/run" style={{ color: "var(--color-accent)" }}>
                  Run page
                </Link>
              </p>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="ev-table">
                <caption className="sr-only">Evidence log — committed mainnet run</caption>
                <thead>
                  <tr>
                    {headers.map((h, i) => (
                      <th key={i}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <EvidenceRow
                      key={row.bundleId}
                      row={row}
                      isExpanded={expandedBundleId === row.bundleId}
                      onToggle={() => toggleRow(row.bundleId)}
                      mode={mode}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="ev-foot">
          Evidence sourced from the committed run · verified on mainnet
        </div>
      </div>
    </div>
  );
}
