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
  return d.toLocaleString("en-US", {
    timeZone: safeTimeZone(tz),
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

/**
 * Resolve a timezone once, falling back to UTC when the zone is unknown.
 * Intl throws RangeError on bad zones, and a reminder must still render.
 */
function safeTimeZone(tz: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

/**
 * The same instant as `formatSessionTimeForEmail`, but split so a template
 * can lay a booking out as a card — weekday on one line, date under it, and
 * the time given its own weight — instead of one run-on sentence.
 */
export function formatSessionDatePartsForEmail(
  d: Date,
  tz: string,
): { weekday: string; date: string; time: string } {
  const timeZone = safeTimeZone(tz);
  return {
    weekday: d.toLocaleString("en-US", { timeZone, weekday: "long" }),
    date: d.toLocaleString("en-US", {
      timeZone,
      month: "long",
      day: "numeric",
      year: "numeric",
    }),
    time: d.toLocaleString("en-US", { timeZone, hour: "numeric", minute: "2-digit" }),
  };
}

/**
 * Render a session length the way a person would say it: "2 hours",
 * "90 min" becomes "1 hr 30 min". Returns null when there is nothing
 * meaningful to show, so the caller can drop the row entirely rather
 * than print "0 min".
 */
export function formatSessionLengthForEmail(minutes: number): string | null {
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  const whole = Math.round(minutes);
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  if (hours === 0) return `${String(rest)} min`;
  const hourLabel = `${String(hours)} ${hours === 1 ? "hour" : "hours"}`;
  return rest === 0 ? hourLabel : `${hourLabel} ${String(rest)} min`;
}
