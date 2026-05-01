import type { ReactNode } from "react";

// gili/design-test branch only — the design-test pages bring their own
// chrome (Sidebar lives inside OverviewShell etc.), so we bypass
// <AppShell> here. Other /dashboard/* children render bare on this
// branch — that is expected per the desktop-first brief.
//
// On main this file still wraps with <AppShell>; reverting this is the
// only change needed if/when this branch gets nuked.
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
