import type { ReactNode } from "react";

// gili/design-test branch ONLY — the mockup design ships its own sidebar +
// chrome inside the page component, so we bypass <AppShell> here. Other
// /dashboard/* children will render bare (no shell) on this branch — that
// is expected per the brief ("skip refactoring of other pages").
//
// On `main` this layout still wraps with <AppShell>; reverting this file is
// the only change needed if/when this branch gets nuked.
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
