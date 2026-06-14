import { redirect } from "next/navigation";

// The Live view is the centerpiece / default landing (EXPERIENCE.md › IA). Until
// 8.3 ships it, "/" forwards to /live (a minimal placeholder for now). Visitors
// who want to drive a session go to /run.
export default function Home() {
  redirect("/live");
}
