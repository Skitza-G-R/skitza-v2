import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";

import { LOCALE_COOKIE, isValidLocale, type Locale } from "./config";
import { detectLocaleFromCountry } from "./locale-detect";

// next-intl's request-time entry point. Called once per RSC render to
// resolve (a) the active locale and (b) the messages bundle for it.
//
// Resolution order — earliest match wins:
//   1. `NEXT_LOCALE` cookie (set by the language-switcher chip and by
//      the IP-detection path in middleware.ts)
//   2. Vercel's `x-vercel-ip-country` header → country-to-locale map
//   3. `DEFAULT_LOCALE` (English)
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
  const headerList = await headers();
  const country = headerList.get("x-vercel-ip-country");
  return detectLocaleFromCountry(country);
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
