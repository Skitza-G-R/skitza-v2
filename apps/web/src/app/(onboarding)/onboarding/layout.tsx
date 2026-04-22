import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import type { ReactNode } from "react";

import { AppI18nProvider } from "~/i18n/app-i18n-provider";
import { fetchUserRole } from "~/server/auth/role";
import { decideOnboardingRedirect } from "./decide-redirect";

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
// Routing rules (all pinned by unit tests in __tests__/decide-redirect):
//   - unauthenticated → /sign-in (middleware should catch; belt+braces)
//   - artist → /artist (the hard wall — Task 16 primary fix)
//   - producer-complete → /dashboard (they don't belong here)
//   - producer-incomplete OR orphan → render the wizard
export default async function OnboardingLayout({ children }: { children: ReactNode }) {
  const { userId } = await auth();

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("missing DATABASE_URL");

  const role = await fetchUserRole({ dbUrl, userId });
  const redirectTo = decideOnboardingRedirect(role);
  if (redirectTo) redirect(redirectTo);

  return <AppI18nProvider>{children}</AppI18nProvider>;
}
