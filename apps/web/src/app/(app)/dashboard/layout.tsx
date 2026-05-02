import type { ReactNode } from "react";

import { PlayerProvider } from "./_design-test/player-context";

// gili/design-test branch only — bypasses <AppShell> because the
// design-test pages get their chrome from the (sandbox)/layout.tsx
// nested layer (Sidebar + Cmd-K palette + FloatingPlayer all live
// there). Routes outside (sandbox) — onboarding + revenue — render
// bare on this branch, which is expected per the desktop-first brief.
//
// PlayerProvider stays here at the dashboard level so audio state
// survives navigation across the entire /dashboard/* tree, including
// out-of-sandbox routes. The FloatingPlayer itself is mounted by
// (sandbox)/layout.tsx, so it only renders inside sandbox routes —
// but the playback state persists if a user briefly leaves to
// onboarding or revenue and comes back.
//
// On main this file still wraps with <AppShell>; reverting this is the
// only change needed if/when this branch gets nuked.
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <PlayerProvider>{children}</PlayerProvider>;
}
