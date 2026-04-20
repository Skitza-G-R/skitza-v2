// IP → locale mapping. Currently NOT WIRED into the request path —
// the v1 i18n hotfix removed the middleware + getRequestConfig
// country-detect branch after user feedback ("English as the
// universal default; Hebrew is opt-in from inside the app"). The
// helper is retained because the mapping itself is still correct
// and some future surface (a one-time "we noticed you're in Israel,
// switch to Hebrew?" toast, for example) may want to consume it.
//
// `country` comes from Vercel's `x-vercel-ip-country` header (ISO
// 3166-1 alpha-2, uppercase). On non-Vercel hosts the header is
// absent; we fall back to the default locale.
//
// Arabic is stubbed. The mapping already points AE/SA/EG/JO at "ar",
// but `ar.json` is an empty file (see messages/ar.json) — Commit 2's
// translation pass treats Arabic as opt-out-of-scope. When Arabic
// ships, we just fill `ar.json` and flip Arabic country codes in
// the type guard below; the mapping itself doesn't change.

import { DEFAULT_LOCALE, isValidLocale, type Locale } from "./config";

// ISO country → locale. Keep this list small + obvious. We pattern-
// match the country to the dominant producer-market language, not the
// constitutional language — an Egyptian producer's audience is
// Arabic-speaking, not English-speaking, even though Egypt's official
// second language is English.
const COUNTRY_TO_LOCALE: Record<string, string> = {
  IL: "he", // Israel → Hebrew
  // Arabic target — stubbed until ar.json is filled.
  AE: "ar", // United Arab Emirates
  SA: "ar", // Saudi Arabia
  EG: "ar", // Egypt
  JO: "ar", // Jordan
};

export function detectLocaleFromCountry(country: string | undefined | null): Locale {
  if (!country) return DEFAULT_LOCALE;
  const upper = country.toUpperCase();
  const candidate = COUNTRY_TO_LOCALE[upper];
  // Defensive: the mapping might reference a locale that's not actually
  // shipped yet (Arabic). `isValidLocale` is the gate that prevents a
  // country-code mis-fire from 404ing the whole app.
  if (candidate && isValidLocale(candidate)) {
    return candidate;
  }
  return DEFAULT_LOCALE;
}
