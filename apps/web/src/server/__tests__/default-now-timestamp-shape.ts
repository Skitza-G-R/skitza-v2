/**
 * A stand-in for the one database rule Skitza's writes keep tripping over.
 *
 * Several tables pair `timestamptz NOT NULL DEFAULT now()` columns with a
 * CHECK comparing two of them — `producer_attention_dismissals_timestamp_shape`
 * (dismissed_at >= created_at), `artist_profiles_timestamp_shape`
 * (updated_at >= created_at), and the same updated_at rule on bookings,
 * booking_change_requests and the calendar tables. A write that mixes clocks
 * fails those checks: a `new Date()` is read in the Node process *before* the
 * statement travels to Neon, so any column left to its DEFAULT is stamped
 * later than the app's own value, and the row is rejected on arrival.
 *
 * These suites have no disposable Postgres to write against — the real-db ones
 * are gated behind an explicitly approved target — so the two functions below
 * stand in for it: `storedStamp` says what a column ends up holding, and
 * `statementNowAfter` puts the database's clock where it really sits, after
 * every Date the payload carries.
 */

/** What a statement can send for a `DEFAULT now()` column. */
export type TimestampValue = Date | object | undefined;

/** Milliseconds between this process reading its clock and Neon running the statement. */
const ROUND_TRIP_MS = 25;

/**
 * What Postgres stores in the column. A Date is this process's own clock
 * reading and is stored verbatim; anything else — an omitted column taking its
 * DEFAULT, or a `sql`now()`` expression — is stamped when the statement runs.
 */
export function storedStamp(value: TimestampValue, statementNow: Date): Date {
  return value instanceof Date ? value : statementNow;
}

/**
 * The statement runs only after this process has read its own clock and sent
 * the payload, so the database's now() is later than every Date inside it.
 */
export function statementNowAfter(...payloads: Record<string, unknown>[]): Date {
  const appReadings = payloads
    .flatMap((payload) => Object.values(payload))
    .filter((value): value is Date => value instanceof Date)
    .map((date) => date.getTime());
  return new Date(Math.max(Date.now(), ...appReadings) + ROUND_TRIP_MS);
}
