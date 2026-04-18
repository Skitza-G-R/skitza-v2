// Pure formatting helpers shared by every email template + the cron
// route. Lifted out so the unit-test surface stays tiny — the
// templates themselves render React + import the heavy
// @react-email/components tree, neither of which we want under
// vitest. These two functions are the load-bearing logic; everything
// else is layout.

/**
 * Render a calendar date in the producer's timezone, using a friendly
 * locale string ("Sat, Apr 18, 2026, 7:30 PM"). Falls back gracefully
 * to UTC when `tz` is invalid.
 */
export function formatSessionTimeForEmail(d: Date, tz: string): string {
  // Validate the tz once — Intl throws RangeError on bad zones.
  let safeTz: string;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    safeTz = tz;
  } catch {
    safeTz = "UTC";
  }
  return d.toLocaleString("en-US", {
    timeZone: safeTz,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Format an integer cents value as a localized currency string.
 * Defensive against negative or NaN values — those return "—".
 */
export function formatCurrencyForEmail(cents: number, code: string): string {
  if (!Number.isFinite(cents) || cents < 0) return "—";
  // Intl throws on unknown ISO codes; catch + fall back to the raw
  // code so the email still renders rather than a 500.
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
    }).format(cents / 100);
  } catch {
    return `${code} ${(cents / 100).toFixed(2)}`;
  }
}
