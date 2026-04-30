import { AppI18nProvider } from "~/i18n/app-i18n-provider";
import { requireRole } from "~/server/auth/role";

// Gate: any authed (producer) route requires a "complete" Producer
// profile. Role enforcement (and the artist/orphan/incomplete redirects
// it implies) lives in requireRole — see server/auth/role.ts for the
// policy + tests in server/auth/__tests__/require-role.test.ts.
//
// (onboarding) is intentionally its own route group — nesting it here
// would loop producer-incomplete users. It will be merged into
// (producer)/dashboard/onboarding when the wizard is rebuilt in Phase 3.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireRole("producer");
  return <AppI18nProvider>{children}</AppI18nProvider>;
}
