import type { ReactNode } from "react";

import { AppI18nProvider } from "~/i18n/app-i18n-provider";

// Onboarding is a signed-in surface (the gate in (app)/layout.tsx
// redirects profile-incomplete users here) so it shares the same
// i18n contract as the rest of the authenticated app: <html> stays
// lang="en" dir="ltr" at the root, and this wrapper opts the subtree
// into NextIntlClientProvider + a per-group dir wrapper.
export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return <AppI18nProvider>{children}</AppI18nProvider>;
}
