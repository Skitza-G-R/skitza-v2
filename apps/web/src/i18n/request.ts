import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";

import { DEFAULT_LOCALE, LOCALE_COOKIE, isValidLocale, type Locale } from "./config";

// next-intl's request-time entry point. Called once per RSC render to
// resolve (a) the active locale and (b) the messages bundle for it.
//
// Resolution order — earliest match wins:
//   1. `NEXT_LOCALE` cookie (set exclusively by the in-app language
//      switcher — see ~/components/shell/language-switcher.tsx)
//   2. `DEFAULT_LOCALE` (English)
//
// IP-based auto-detection was removed in the v1 hotfix: defaulting
// Israeli visitors to Hebrew created a stuck state on the landing
// page (which is English-only by product decision) and didn't match
// the "English is the universal default" onboarding promise. Hebrew
// is now strictly opt-in via the switcher chip in the sidebar footer.
//
// Messages are loaded via dynamic `import()` so each locale's bundle
// is code-split. The JSON lives under `apps/web/messages/<locale>.json`;
// Next/turbopack resolves the path relative to this file at build time.

async function resolveLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value;
  if (cookieLocale && isValidLocale(cookieLocale)) {
    return cookieLocale;
  }
  return DEFAULT_LOCALE;
}

export default getRequestConfig(async () => {
  const locale = await resolveLocale();
  // Dynamic import keeps each locale bundle out of the baseline RSC
  // chunk. The `.default` dereference is required for JSON modules
  // under the TS bundler setting we use in this workspace.
  const mod = (await import(`../../messages/${locale}.json`)) as {
    default: Record<string, unknown>;
  };
  const messages = mod.default;
  return {
    locale,
    messages,
  };
});
