// Money formatting — locked design system (Phase 4).
//
// Producer + artist surfaces both render currency strings everywhere:
// balance cards, project tiles, store products, calendar approvals,
// invoice rows. Phase 5 shipped two slightly different inline
// implementations of the same idea (`formatMoney` in
// balance-card.tsx with `.toFixed(0)`, `formatCents` in
// store/product-card.tsx with `.toLocaleString(…)`).
//
// This util consolidates both behind one signature. The
// `.toLocaleString()` path is canonical because it gives commas at
// thousand boundaries (`$1,234` instead of `$1234`) — matters once a
// producer breaks $10K in a month.
//
// `withCents` is opt-in for product prices that need decimal
// precision (e.g. `$19.99`); the default `false` matches every
// design-drop call-site (no `.00` clutter on big numbers).
//
// Currency support is the locked v1 set (USD/EUR/GBP/ILS) plus a
// generic `<code> ` fallback for unknown codes — same set Phase 5's
// inline tables use, so the consolidation is a behaviour-preserving
// rename.

const CURRENCY_SYMBOL: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  ILS: "₪",
};

interface FormatMoneyOptions {
  /** When true, show two decimal places (e.g. `$19.99`). Default: false. */
  withCents?: boolean;
}

/**
 * Format an integer cents value as a currency string.
 *
 * @example formatMoney(28000, "USD")            // "$280"
 * @example formatMoney(199900, "EUR")           // "€1,999"
 * @example formatMoney(1999, "USD", { withCents: true }) // "$19.99"
 * @example formatMoney(28000, "JPY")            // "JPY 280" (fallback)
 */
export function formatMoney(
  cents: number,
  currency: string,
  options: FormatMoneyOptions = {},
): string {
  const prefix = CURRENCY_SYMBOL[currency.toUpperCase()] ?? `${currency} `;
  const isNegative = cents < 0;
  const major = Math.abs(cents) / 100;
  const formatted = options.withCents
    ? major.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : major.toLocaleString(undefined, {
        maximumFractionDigits: 0,
      });
  // Sign goes outside the currency symbol — `-$50`, not `$-50`.
  return `${isNegative ? "-" : ""}${prefix}${formatted}`;
}

/**
 * Resolve a currency code to its display symbol (or `<code> ` if
 * unknown). Exported for surfaces that compose money strings manually
 * (e.g. range pickers showing "$ – $", or input prefixes).
 */
export function currencySymbol(currency: string): string {
  return CURRENCY_SYMBOL[currency.toUpperCase()] ?? `${currency} `;
}
