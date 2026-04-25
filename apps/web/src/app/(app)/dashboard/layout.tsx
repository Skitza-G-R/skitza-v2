import type { ReactNode } from "react";

import { AppShell } from "~/components/shell/app-shell";

// Shared layout for every /dashboard/* route. Hosting <AppShell>
// here instead of in each individual page is what makes the producer
// dashboard feel like a single-page app: Next.js App Router preserves
// layout instances across sibling-route navigation, so the sidebar,
// persistent audio player, notification bell, command palette, and
// coachmark tour stop unmounting on every click.
//
// Auth + redirect gating already happens one level up in
// (app)/layout.tsx — this layout is purely the shell host. Active
// nav state is derived inside Sidebar via `usePathname()`, so no
// props need to be threaded through here.
//
// Architectural invariant: dashboard pages must NOT re-wrap their
// content in <AppShell>. Pinned by
// apps/web/src/app/(app)/dashboard/__tests__/layout-architecture.test.ts.
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
