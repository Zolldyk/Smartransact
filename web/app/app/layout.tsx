import type { Metadata } from "next";
import { Nav } from "@/components/nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Smartransact — Smart Transaction Stack",
  description: "Watch a real Solana mainnet transaction lifecycle, with an autonomous retry agent. Run your own in dryRun — free, safe.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      {/* Warm near-black canvas + top nav. Main is a margin:auto flex column so
          the composition centers when it fits and top-aligns + scrolls when
          taller — never clips (DESIGN.md › Layout). */}
      <body>
        <Nav />
        <main className="app-main">
          <div className="app-center">{children}</div>
        </main>
      </body>
    </html>
  );
}
