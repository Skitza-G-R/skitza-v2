// i18n config — the single source of truth for locale metadata.
//
// Skitza uses next-intl's "without routing" mode (cookie-driven rather
// than URL-prefixed). This keeps every existing App Router path intact
// — /dashboard, /p/:slug, /sign-in etc. stay as-is — while still
// letting us swap messages + flip `dir` per user.
//
// Why cookie-only instead of /en/ /he/ prefixes:
//  - The app has many route groups already (`(app)`, `(auth)`,
//    `(public)`, `(artist)`, `(onboarding)`, `(artist-welcome)`). A
//    `[locale]` segment nesting them would be invasive — every page +
//    every internal `href` would need re-threading.
//  - Producer-facing URLs shared with clients (the `/p/:slug` storefront)
//    are the one surface we DO want shareable without locale baggage —
//    the client's browser should pick a language, not Alice's.
//  - IP detection still works: the middleware sets the cookie on first
//    hit, persisting the choice across sessions.
//
// When we need URL-prefix locales for SEO on public marketing pages,
// this file's shape is stable enough to extend without a full rewrite.

export const LOCALES = ["en", "he"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

// RTL locales — `<html dir="rtl">` kicks in for these. Hebrew ships
// now; Arabic is stubbed (see locale-detect.ts) for the follow-up wave.
export const RTL_LOCALES = new Set<Locale>(["he"]);

export function isRtl(locale: string): boolean {
  return RTL_LOCALES.has(locale as Locale);
}

export function isValidLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

// Cookie name — next-intl's recommended default so any future
// interop with their client helpers works without renames.
export const LOCALE_COOKIE = "NEXT_LOCALE";

// Display labels used by the language switcher chip. Keep these in
// the NATIVE script of each locale — English users see "English" and
// Hebrew users see "עברית" in the dropdown regardless of the active
// locale. The compact 2-3 char label shown in the chip face is
// separate (`short` below) and matches cultural norms (ENG / עב).
export const LOCALE_META: Record<Locale, { label: string; short: string }> = {
  en: { label: "English", short: "ENG" },
  he: { label: "עברית", short: "עב" },
};
