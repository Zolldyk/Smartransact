// web/app/lib/pending-session.ts
//
// A tiny in-memory hand-off from the Run page (ConfigForm) to the /live route.
// The launch overrides — which MAY contain a BYO API key — live ONLY in this
// module-level variable for the duration of the client-side navigation. They are
// NEVER written to sessionStorage/localStorage, the URL, or logs (NFR9). The
// value is cleared the moment /live reads it, so a refresh of /live starts clean.

import type { ClientOverrides } from "./overrides";

let pending: ClientOverrides | null = null;

/** Stash the launch payload just before navigating Run → /live. */
export function setPendingSession(overrides: ClientOverrides): void {
  pending = overrides;
}

/** Read-and-clear the launch payload on /live mount. Returns null if none. */
export function takePendingSession(): ClientOverrides | null {
  const value = pending;
  pending = null;
  return value;
}
