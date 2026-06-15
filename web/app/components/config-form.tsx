"use client";

// ConfigForm — the Run page's Config Sandbox (story 8.2). Two states in one
// component (the mock's State A / State B), gated by a single "Customize"
// progressive-disclosure affordance:
//   • collapsed (default): four summary rows + Start + dryRun-safe note — one
//     click runs the server's mainnet-ws defaults (Groq, keyless).
//   • expanded: grouped fields (Session / Guardrails / Agent) — steppers,
//     toggle, tip band, provider segmented control, BYO-key.
//
// Every launch routes through the pure mapper (lib/overrides.ts) — the single
// sanctioned form-state → payload path. The payload can NEVER carry dryRun /
// keypairPath / transport (server-fixed, NFR9). The BYO key lives in React state
// only; it is handed to /live in-memory (pending-session.ts), never stored.

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  buildOverrides,
  DEFAULT_FORM_STATE,
  MAX_SANDBOX_BUNDLE_COUNT,
  MissingApiKeyError,
  PROVIDERS,
  PROVIDER_LABELS,
  providerNeedsKey,
  SERVER_FAULT_AT_BUNDLE,
  type ConfigFormState,
  type Provider,
} from "@/lib/overrides";
import { setPendingSession } from "@/lib/pending-session";
import { Button } from "@/components/ui/button";
import { SegmentedToggle } from "@/components/ui/segmented-toggle";
import { FieldRow, Stepper, Toggle } from "@/components/ui/config-field";

const PROVIDER_OPTIONS = PROVIDERS.map((p) => ({ value: p, label: PROVIDER_LABELS[p] }));

export function ConfigForm() {
  const router = useRouter();
  const [state, setState] = useState<ConfigFormState>(DEFAULT_FORM_STATE);
  const [expanded, setExpanded] = useState(false);
  const [keyError, setKeyError] = useState(false);

  const set = <K extends keyof ConfigFormState>(key: K, value: ConfigFormState[K]) => {
    setState((s) => ({ ...s, [key]: value }));
    if (key === "provider" || key === "apiKey") setKeyError(false);
  };

  const needsKey = providerNeedsKey(state.provider);
  // The fault index is server-fixed (#6, clamped to bundleCount-1). Shown
  // read-only — it is NOT a client allow-list field, so it never ships.
  const effectiveFaultAt = state.injectFault ? Math.min(SERVER_FAULT_AT_BUNDLE, state.bundleCount - 1) : null;

  const launch = () => {
    try {
      const overrides = buildOverrides(state);
      setPendingSession(overrides);
      router.push("/live");
    } catch (err) {
      if (err instanceof MissingApiKeyError) {
        setKeyError(true);
        if (!expanded) setExpanded(true);
        return;
      }
      throw err;
    }
  };

  return (
    <div className="card">
      {!expanded ? (
        <>
          <h2>Session</h2>
          <p className="card-lede">Sensible defaults, ready to go. Customize only if you want to.</p>

          <div className="sumrow">
            <span className="k">Bundles</span>
            <span className="v mono">{state.bundleCount}</span>
          </div>
          <div className="sumrow">
            <span className="k">Fault drill</span>
            <span className="v">
              blockhash-expiry
              {effectiveFaultAt !== null ? (
                <span className="pill-mini">at #{effectiveFaultAt}</span>
              ) : (
                <span className="pill-readonly">off</span>
              )}
            </span>
          </div>
          <div className="sumrow">
            <span className="k">Agent model</span>
            <span className="v">{PROVIDER_LABELS[state.provider]}</span>
          </div>
          <div className="sumrow">
            <span className="k">Stream</span>
            <span className="v">mainnet · live</span>
          </div>
        </>
      ) : (
        <>
          <h2>Customize your session</h2>
          <p className="card-lede">All optional. Defaults mirror the live mainnet sandbox.</p>

          <div className="grp">
            <div className="grp-label">Session</div>
            <FieldRow label="Bundles to submit">
              <Stepper
                value={state.bundleCount}
                onChange={(n) => set("bundleCount", n)}
                min={1}
                max={MAX_SANDBOX_BUNDLE_COUNT}
                ariaLabel="bundles to submit"
              />
            </FieldRow>
            <FieldRow label="Inject blockhash-expiry fault">
              <Toggle on={state.injectFault} onChange={(v) => set("injectFault", v)} ariaLabel="inject blockhash-expiry fault" />
            </FieldRow>
            <FieldRow label="…at bundle #">
              <span className="readonly-val">
                {effectiveFaultAt !== null ? `#${effectiveFaultAt}` : "off"}
                <span className="pill-readonly" title="Server-fixed for the public sandbox">
                  fixed
                </span>
              </span>
            </FieldRow>
          </div>

          <div className="grp">
            <div className="grp-label">Guardrails</div>
            <FieldRow label="Tip band: min (lamports)" htmlFor="tip-min">
              <input
                id="tip-min"
                className="input input-narrow mono"
                type="number"
                min={1}
                value={state.tipBandMin}
                onChange={(e) => set("tipBandMin", Number(e.target.value))}
              />
            </FieldRow>
            <FieldRow label="Tip band: max (lamports)" htmlFor="tip-max">
              <input
                id="tip-max"
                className="input input-narrow mono"
                type="number"
                min={1}
                value={state.tipBandMax}
                onChange={(e) => set("tipBandMax", Number(e.target.value))}
              />
            </FieldRow>
            <FieldRow label="Max tip (lamports)" htmlFor="max-tip">
              <input
                id="max-tip"
                className="input input-narrow mono"
                type="number"
                min={1}
                value={state.maxTipLamports}
                onChange={(e) => set("maxTipLamports", Number(e.target.value))}
              />
            </FieldRow>
            <FieldRow label="Max retries">
              <Stepper value={state.maxRetries} onChange={(n) => set("maxRetries", n)} min={1} max={8} ariaLabel="max retries" />
            </FieldRow>
          </div>

          <div className="grp">
            <div className="grp-label">Agent</div>
            <FieldRow label="Provider">
              <SegmentedToggle<Provider>
                options={PROVIDER_OPTIONS}
                value={state.provider}
                onChange={(p) => set("provider", p)}
                ariaLabel="LLM provider"
              />
            </FieldRow>
            <div className="keyfield">
              <input
                className="input mono"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={needsKey ? "Paste your API key (required for this provider)" : "Optional, Groq runs on the built-in key"}
                value={state.apiKey}
                onChange={(e) => set("apiKey", e.target.value)}
                aria-label="BYO API key"
                aria-invalid={keyError}
              />
              <div className={keyError ? "keyhelp required-missing" : "keyhelp"}>
                <span aria-hidden="true">🔒</span>
                {keyError ? "This provider needs your key. Paste it above." : "Used only for this session · never stored, never logged"}
              </div>
              {needsKey && !keyError && (
                <div className="field-error" role="note">
                  {PROVIDER_LABELS[state.provider]} runs on your own key. Groq runs with no key.
                </div>
              )}
            </div>
          </div>
        </>
      )}

      <button type="button" className="customize-toggle" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
        {expanded ? "▴ Hide options" : "⚙ Customize options ▾"}
      </button>

      <Button onClick={launch} disabled={needsKey && state.apiKey.trim() === ""}>
        ▶ Start session
      </Button>

      <div className="safe-note">
        <span aria-hidden="true">🔒</span>
        <span>
          <b>dryRun</b>: this session cannot spend SOL. If you add your own API key, it stays in your browser and is never stored.
        </span>
      </div>
    </div>
  );
}
