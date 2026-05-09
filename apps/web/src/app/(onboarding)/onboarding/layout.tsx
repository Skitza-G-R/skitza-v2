import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import type { ReactNode } from "react";

import { AppI18nProvider } from "~/i18n/app-i18n-provider";
import { fetchUserRole } from "~/server/auth/role";
import { decideOnboardingRedirect, stepFromPath } from "./decide-redirect";

// Onboarding is a signed-in surface (the gate in (app)/layout.tsx
// redirects profile-incomplete users here) so it shares the same
// i18n contract as the rest of the authenticated app: <html> stays
// lang="en" dir="ltr" at the root, and this wrapper opts the subtree
// into NextIntlClientProvider + a per-group dir wrapper.
//
// 2026-04-22 — Task 16 hardening (docs/audit-report.md). Before this,
// the layout was a bare i18n wrapper with no role gate. An artist
// typing /onboarding in the URL bar bypassed (app)/layout.tsx
// entirely and landed on the producer wizard. Now we resolve the
// caller's role server-side and redirect based on it (policy in
// ./decide-redirect.ts).
//
// 2026-04-25 (Story 04) — Step-aware. The layout now reads the
// `x-pathname` header forwarded by middleware (see middleware.ts —
// only injected for /onboarding/*) and passes the derived step to
// decideOnboardingRedirect. This is what unblocks /onboarding/{2,3,4}
// for the just-completed-Step-1 producer (who is now `producer-complete`
// but still mid-flow). Without this, the layout's old single-arg call
// would default to "studio" and redirect them straight to /dashboard,
// trapping them out of Steps 2-4. Server components have no built-in
// pathname API; the middleware-sets-header workaround is the canonical
// Next.js pattern (see github.com/vercel/next.js/issues/43704).
//
// Routing rules (all pinned by unit tests in __tests__/decide-redirect):
//   - unauthenticated → /sign-in (middleware should catch; belt+braces)
//   - artist → /artist (the hard wall — Task 16 primary fix)
//   - producer-complete on /onboarding/studio → /dashboard
//   - producer-complete on /onboarding/{2,3,4} → render (mid-flow)
//   - producer-incomplete OR orphan on /onboarding/studio → render
//   - producer-incomplete OR orphan on /onboarding/{2,3,4} → /onboarding/studio
export default async function OnboardingLayout({ children }: { children: ReactNode }) {
  const reqHeaders = await headers();

  // Dev-only preview bypass — middleware sets this header when both
  // NODE_ENV=development AND ?__preview=1 are present. Skip the role
  // gate (and the DB round-trip that fetchUserRole would otherwise do)
  // so visual review of onboarding screens works without a fresh
  // producer signup. See lib/onboarding/dev-preview.ts for the gate
  // logic + tests; middleware.ts is what writes this header.
  if (reqHeaders.get("x-onboarding-preview-bypass") === "1") {
    return <AppI18nProvider>{children}</AppI18nProvider>;
  }

  const { userId } = await auth();

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("missing DATABASE_URL");

  const role = await fetchUserRole({ dbUrl, userId });
  const pathname = reqHeaders.get("x-pathname");
  const currentStep = stepFromPath(pathname);
  const redirectTo = decideOnboardingRedirect(role, currentStep);
  if (redirectTo) redirect(redirectTo);

  return <AppI18nProvider>{children}</AppI18nProvider>;
}
