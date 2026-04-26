/**
 * Pure helpers for the producer onboarding wizard (PRD §4.5, arch §4.1).
 *
 * Both functions are deterministic and side-effect free: the random hash for
 * slug uniqueness is passed in as a parameter so tests stay reproducible and
 * the wizard's server action can reason about identical inputs producing
 * identical outputs.
 */

export type SupportedCurrency = "USD" | "EUR" | "GBP" | "ILS";

const SLUG_MAX_LENGTH = 48;
const HASH_LENGTH = 4; // "-xxxx"
const SLUG_BODY_MAX_LENGTH = SLUG_MAX_LENGTH - (HASH_LENGTH + 1); // 43 chars
const FALLBACK_SLUG_BODY = "studio";

/**
 * Derives a URL-safe slug from a free-form display name plus a 4-char hex
 * suffix. Strips diacritics, lowercases, collapses non-alphanumeric runs to
 * single dashes, truncates to keep the total ≤ 48 chars, and falls back to
 * "studio" when the display name has no allowed chars.
 *
 * @example slugFromDisplayName("DJ Smith", "8f2a") → "dj-smith-8f2a"
 * @example slugFromDisplayName("  El Café   ", "0001") → "el-cafe-0001"
 * @example slugFromDisplayName("////", "abcd") → "studio-abcd"
 */
export function slugFromDisplayName(
  displayName: string,
  randomHex4: string,
): string {
  const folded = displayName
    .normalize("NFKD")
    // Strip combining diacritics (Unicode range U+0300–U+036F).
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

  const cleaned = folded
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  const body = cleaned.length > 0 ? cleaned : FALLBACK_SLUG_BODY;
  const truncated = body.slice(0, SLUG_BODY_MAX_LENGTH).replace(/-+$/g, "");
  const finalBody = truncated.length > 0 ? truncated : FALLBACK_SLUG_BODY;

  return `${finalBody}-${randomHex4}`;
}

/**
 * Official 27-member EU country list as of 2026. O(1) membership via Set.
 * Used to map any EU country to EUR even when not enumerated explicitly.
 */
const EU_MEMBER_STATES: ReadonlySet<string> = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR",
  "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL",
  "PL", "PT", "RO", "SK", "SI", "ES", "SE",
]);

/**
 * Maps an ISO 3166-1 alpha-2 country code to one of the four supported
 * currencies. Falls back to USD for nullish/empty input or unsupported
 * countries (e.g. CA/AU/NZ/JP/CN/BR).
 *
 * @example currencyFromCountry("IL") → "ILS"
 * @example currencyFromCountry("DE") → "EUR"  (any EU member)
 * @example currencyFromCountry("UK") → "GBP"  (treated as alias for GB)
 * @example currencyFromCountry(null) → "USD"
 */
export function currencyFromCountry(
  country: string | null | undefined,
): SupportedCurrency {
  if (!country) return "USD";

  const code = country.toUpperCase();
  if (code === "GB" || code === "UK") return "GBP";
  if (code === "IL") return "ILS";
  if (EU_MEMBER_STATES.has(code)) return "EUR";
  return "USD";
}

/**
 * Language-prefix → currency mapping for the Accept-Language fallback.
 * Only includes prefixes that disambiguate a single supported currency:
 *   - "he" anywhere implies ILS (Hebrew is overwhelmingly Israel)
 *   - EU member-state primary languages imply EUR
 *   - "en-GB" / "en-UK" specifically implies GBP (en alone is ambiguous)
 * "en-US" / "ja" / "zh" / "ar" return null so the caller falls through
 * to a more specific signal (or USD).
 */
const EU_LANG_PREFIXES: ReadonlySet<string> = new Set([
  "de", "fr", "es", "it", "nl", "pt", "sv", "fi", "da", "el",
  "pl", "ro", "cs", "hu", "sk", "sl", "et", "lv", "lt", "bg",
  "hr", "mt", "ga",
]);

/**
 * Best-effort currency inference from the Accept-Language header. Returns
 * null when the language tag carries no clear signal (so the caller can
 * fall through to USD without overcommitting to a guess).
 *
 * Used as a fallback when `x-vercel-ip-country` is missing — see
 * inferCurrency below. Israeli producers browsing the wizard from a
 * Hebrew browser hit this path most often (Vercel preview environments
 * occasionally drop the geo header; the Hebrew Accept-Language is the
 * next-best signal).
 *
 * @example currencyFromAcceptLanguage("he-IL,he;q=0.9,en-US;q=0.8") → "ILS"
 * @example currencyFromAcceptLanguage("de-DE") → "EUR"
 * @example currencyFromAcceptLanguage("en-US") → null  (ambiguous)
 */
export function currencyFromAcceptLanguage(
  acceptLanguage: string | null | undefined,
): SupportedCurrency | null {
  if (!acceptLanguage) return null;

  // Take the primary tag (everything before the first comma + q-weight),
  // trim whitespace, lowercase. Accept-Language grammar: "he-IL,he;q=0.9".
  const primaryRaw = acceptLanguage.split(",")[0]?.trim() ?? "";
  const primary = primaryRaw.split(";")[0]?.trim().toLowerCase() ?? "";

  if (primary.startsWith("he")) return "ILS";
  if (primary === "en-gb" || primary === "en-uk") return "GBP";

  // Match by language prefix (everything before the optional "-region").
  const prefix = primary.split("-")[0] ?? "";
  if (EU_LANG_PREFIXES.has(prefix)) return "EUR";

  return null;
}

/**
 * Combined currency inference: country header is canonical (most
 * specific geo signal), Accept-Language is fallback (next-best signal),
 * USD is the final fallback when neither is informative.
 *
 * This is the single helper the `completeStudio` server action calls.
 * The `currencyFromCountry` and `currencyFromAcceptLanguage` exports
 * remain for direct use + dedicated test coverage.
 */
export function inferCurrency(
  country: string | null | undefined,
  acceptLanguage: string | null | undefined,
): SupportedCurrency {
  // Country present → trust currencyFromCountry's mapping (which already
  // returns USD for unsupported codes; that's the right answer when the
  // producer's geo IS US/CA/AU/NZ/JP/CN/etc.).
  if (country && country.trim().length > 0) {
    return currencyFromCountry(country);
  }
  // No country signal — try language. Returns null on ambiguous tags.
  return currencyFromAcceptLanguage(acceptLanguage) ?? "USD";
}
