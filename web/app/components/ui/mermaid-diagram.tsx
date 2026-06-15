"use client";
import { useEffect, useRef, useState } from "react";

interface Props { definition: string; id: string; title?: string }

export function MermaidDiagram({ definition, id, title }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "done" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const m = await import("mermaid");
        m.default.initialize({
          startOnLoad: false,
          theme: "dark",
          themeVariables: {
            background: "#151312",
            primaryColor: "#1C1916",
            primaryTextColor: "#EDE8E1",
            lineColor: "#A39A8E",
            edgeLabelBackground: "#151312",
          },
        });
        const { svg } = await m.default.render(id, definition);
        if (!cancelled && ref.current) {
          ref.current.innerHTML = svg;
          setState("done");
        }
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => { cancelled = true; };
  }, [definition, id]);

  return (
    <figure className="doc-diagram" aria-label={title ?? "Architecture diagram"}>
      {state === "loading" && <div className="doc-diagram-loading">Rendering…</div>}
      {state === "error" && <pre className="doc-diagram-pre">{definition}</pre>}
      <div ref={ref} />
    </figure>
  );
}
