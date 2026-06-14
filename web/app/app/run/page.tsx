import { ConfigForm } from "@/components/config-form";

// Run — the Config Sandbox (story 8.2). Defaults-first, one click to run; the
// "Customize" affordance discloses the advanced controls. Launch transitions to
// /live bound to the visitor's dryRun session.
export default function RunPage() {
  return (
    <div className="wrap">
      <header className="page-head">
        <div className="eyebrow">Run your own</div>
        <h1>Start a live session</h1>
        <p>Reads Solana mainnet in real time, in dryRun. Free, safe, about a minute.</p>
      </header>
      <ConfigForm />
    </div>
  );
}
