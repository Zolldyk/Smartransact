"use client";

// Top nav — 5 persistent destinations (EXPERIENCE.md › IA). The active route is
// derived from the pathname. The live mainnet slot indicator in the mock is a
// future enhancement (8.3 binds it to the slot-tick stream); here it is a calm
// static "mainnet · live" marker so we never animate an unbacked number.

import Link from "next/link";
import { usePathname } from "next/navigation";

const DESTINATIONS = [
  { href: "/live", label: "Live" },
  { href: "/run", label: "Run" },
  { href: "/evidence", label: "Evidence" },
  { href: "/architecture", label: "Architecture" },
  { href: "/readme", label: "README" },
] as const;

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="nav">
      <div className="nav-inner">
        <Link href="/live" className="brand">
          <span className="brand-mark" aria-hidden="true" />
          Smartransact
        </Link>
        <div className="nav-links">
          {DESTINATIONS.map((d) => {
            const active = pathname === d.href || (d.href === "/live" && pathname === "/");
            return (
              <Link key={d.href} href={d.href} className={active ? "nav-link on" : "nav-link"} aria-current={active ? "page" : undefined}>
                {d.label}
              </Link>
            );
          })}
        </div>
        <span className="nav-net">
          <span className="net-dot" aria-hidden="true" />
          mainnet · live
        </span>
      </div>
    </nav>
  );
}
