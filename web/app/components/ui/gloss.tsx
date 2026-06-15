// Gloss — an inline jargon term with a plain-language definition (Basic mode,
// AC2). Renders as a dotted-underline term that reveals its gloss on hover, focus
// (keyboard), and tap. The definition is also exposed to assistive tech via
// aria-label so the gloss is not vision-only (AC8). Falls back to plain text when
// the term has no glossary entry.

"use client";

import type { ReactNode } from "react";
import { GLOSSARY } from "@/lib/depth-mode";

interface GlossProps {
  /** Glossary key (see lib/depth-mode GLOSSARY). */
  term: string;
  /** Optional display text (defaults to the term itself). */
  children?: ReactNode;
}

export function Gloss({ term, children }: GlossProps) {
  const def = GLOSSARY[term];
  const label = children ?? term;
  if (!def) return <>{label}</>;
  const labelText = typeof label === "string" ? label : term;
  return (
    <span className="gloss" tabIndex={0} role="note" aria-label={`${labelText}: ${def}`}>
      {label}
      <span className="gloss-pop" role="tooltip" aria-hidden="true">
        {def}
      </span>
    </span>
  );
}
