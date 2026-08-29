// SK-280 — booking & calendar audit fixes.
//
// Each block pins one repaired behavior so it cannot silently regress. Most
// are wiring assertions against the source (the repo's established pattern
// for cross-layer guarantees); the time.ts and emit date checks execute the
// real code.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { reminderWindows } from "~/server/calendar/session-reminder-sweep";
import { zonedWallClockAt } from "~/server/booking/time";

const here = dirname(fileURLToPath(import.meta.url));
const read = (...segments: string[]) => readFileSync(join(here, ...segments), "utf8");

const serviceSource = read("..", "..", "..", "domain", "session-booking", "service.ts");
const bookingSource = read("..", "booking.ts");
const artistSource = read("..", "artist.ts");
const emitSource = read("..", "..", "..", "notifications", "emit.ts");
const googleServiceSource = read("..", "..", "..", "google-calendar", "service.ts");
const busyReaderSource = read("..", "..", "..", "google-calendar", "busy-reader.ts");
const googleRouterSource = read("..", "google-calendar.ts");
const sweepSource = read("..", "..", "..", "calendar", "session-reminder-sweep.ts");
const calendarSyncRouteSource = read(
  "..",
  "..",
  "..",
  "..",
  "app",
  "api",
  "cron",
  "calendar-sync",
  "route.ts",
);
const webVercelJson = read("..", "..", "..", "..", "..", "vercel.json");

function slice(source: string, from: string, to: string): string {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  expect(start, `anchor missing: ${from}`).toBeGreaterThan(-1);
  expect(end, `anchor missing: ${to}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("held requests can always be cleared", () => {
  it("reject no longer checks the hold expiry", () => {
    const reject = slice(
      serviceSource,
      "export function rejectSessionBooking",
      "export async function expireHeldSessionBooking",
    );
    expect(reject).not.toContain("assertHeldUnexpired(");
    expect(reject).toContain("assertPending(context)");
  });

  it("producer cancel no longer checks the hold expiry but still blocks ended sessions", () => {
    const cancel = slice(
      serviceSource,
      "export function cancelProducerSessionBooking",
      "export function cancelArtistSessionBooking",
    );
    expect(cancel).not.toContain("assertHeldUnexpired(");
    expect(cancel).toContain("assertProducerSessionHasNotEnded");
  });

  it("late-cancel accounting requires a confirmed session", () => {
    const late = slice(
      serviceSource,
      "export function recordLateArtistCancellation",
      "export function markSessionNoShow",
    );
    expect(late).toContain('status !== "confirmed"');
    expect(late).not.toContain("assertActiveStatus");
  });
});

describe("approving an artist reschedule", () => {
  it("validates lead time against the request instant, not the decision instant", () => {
    expect(serviceSource).toContain("leadTimeNow: request.requestedAt");
    expect(serviceSource).toContain("const leadTimeNow = options.leadTimeNow ?? now;");
  });

  it("demands the reduced-protection review before an unchecked Google approve", () => {
    const decideProcedure = slice(
      bookingSource,
      "changeRequest: router({",
      "// ── Bookings (producer-only views + status transitions)",
    );
    expect(decideProcedure).toContain(
      "acknowledgedReducedGoogleProtection: z.boolean().default(false)",
    );
    expect(decideProcedure).toContain("reviewedFinalGoogleCalendarProtection({");
  });
});

describe("google reconciliation and busy protection", () => {
  it("an inbound Google move surfaces a conflict instead of cancelling a booking with a pending change request", () => {
    const moved = slice(
      serviceSource,
      "const moved = event.timing.startsAt.getTime()",
      "const operationKey = `google-reconcile:",
    );
    expect(moved).toContain("findPendingChangeRequest(booking.id)");
    expect(moved).toContain('outcome: "conflict"');
  });

  it("a producer who never connected Google is not flagged as reduced protection", () => {
    expect(slice(googleServiceSource, "function failOpenBusyResult", "}")).toContain(
      'health === "not_connected" ? "google_aware" : "skitza_only"',
    );
    expect(busyReaderSource).toContain('protection: "google_aware"');
  });

  it("the busy-calendar selection is capped at the Google freeBusy limit on save", () => {
    expect(googleRouterSource).toContain(".max(GOOGLE_CALENDAR_FREE_BUSY_MAX_CALENDARS)");
    expect(slice(googleServiceSource, "async saveSelection", "saveCalendarSelection")).toContain(
      "GOOGLE_CALENDAR_FREE_BUSY_MAX_CALENDARS",
    );
    expect(googleServiceSource).not.toContain("availabilityCalendarIds.length > 10_000");
  });
});

describe("reminder sweep", () => {
  it("windows catch up instead of assuming a 15-minute cadence", () => {
    const now = new Date("2026-08-27T10:00:00.000Z");
    const windows = reminderWindows(now);
    expect(windows.window24Start.toISOString()).toBe("2026-08-27T11:00:00.000Z");
    expect(windows.window24End.toISOString()).toBe("2026-08-28T10:20:00.000Z");
    // The 24h window is >23h wide: a fully skipped day of ticks cannot leave
    // a band of sessions that no later run ever scans.
    expect(windows.window24End.getTime() - windows.window24Start.getTime()).toBeGreaterThan(
      23 * 60 * 60 * 1000,
    );
  });

  it("releases the claim when the artist send fails so the next sweep retries", () => {
    const artistSend24 = slice(
      sweepSource,
      "await sendSessionReminder24h(b.artistEmail",
      "if (ctx.producerEmail)",
    );
    expect(artistSend24).toContain("await unclaimReminder(db, b.id)");
    expect(artistSend24).toContain("continue;");
  });

  it("no longer ships a 1h reminder (SK-290)", () => {
    expect(sweepSource).not.toContain("sendSessionReminder1h");
    expect(sweepSource).not.toContain("window1Start");
  });

  it("runs from the registered nightly calendar-sync cron", () => {
    expect(calendarSyncRouteSource).toContain("runSessionReminderSweep");
    expect(calendarSyncRouteSource).toContain('"session_reminders"');
    // Both cron jobs are mirrored into apps/web/vercel.json so they register
    // regardless of which vercel.json the project's root-directory reads.
    expect(webVercelJson).toContain("/api/cron/calendar-sync");
    expect(webVercelJson).toContain("/api/cron/beta-nudges");
  });
});

describe("producer notifications and emails", () => {
  it("notification dates render in the producer's timezone", () => {
    expect(emitSource).toContain("function producerLocalDate");
    expect(emitSource).not.toContain("input.when.toISOString().slice(0, 10)");
  });

  it("an artist change request writes a durable inbox row on both paths", () => {
    expect(emitSource).toContain("export async function emitBookingChangeRequested");
    const occurrences = artistSource.split("emitBookingChangeRequested(ctx.db").length - 1;
    expect(occurrences).toBe(2);
  });

  it("the two designed booking emails are finally wired", () => {
    expect(artistSource).toContain("sendBookingRequestEmail(createdRow.producerEmail");
    expect(artistSource).toContain("sendBookingConfirmedEmail(created.booking.artistEmail");
    expect(bookingSource).toContain("sendBookingConfirmedEmail(before.booking.artistEmail");
  });
});

describe("producer calendar surfaces", () => {
  it("upcoming keeps a session until it ends", () => {
    const upcoming = slice(
      bookingSource,
      "upcoming: producerProcedure",
      "revenue: producerProcedure",
    );
    expect(upcoming).toContain("interval '1 minute'");
    expect(upcoming).not.toContain("gte(bookings.startsAt, now)");
  });

  it("the artist close-out transitions are reachable from the calendar actions", () => {
    const actionsSource = read(
      "..",
      "..",
      "..",
      "..",
      "app",
      "(producer)",
      "dashboard",
      "calendar",
      "calendar-actions.ts",
    );
    expect(actionsSource).toContain("booking.complete({");
    expect(actionsSource).toContain("booking.noShow({");
    expect(actionsSource).toContain("booking.recordLateCancellation({");
  });
});

describe("artist screens survive stale and closed state", () => {
  it("the three session pages map NOT_FOUND to the not-found screen", () => {
    for (const page of [
      ["..", "..", "..", "..", "app", "(artist)", "artist", "sessions", "[sessionId]", "page.tsx"],
      [
        "..",
        "..",
        "..",
        "..",
        "app",
        "(artist)",
        "artist",
        "sessions",
        "[sessionId]",
        "cancel",
        "page.tsx",
      ],
      ["..", "..", "..", "..", "app", "(artist)", "artist", "book", "page.tsx"],
    ] as const) {
      const source = read(...page);
      expect(source).toContain("notFound()");
      expect(source).toContain('error.code === "NOT_FOUND"');
    }
  });

  it("a closed studio hides the reschedule action", () => {
    expect(serviceSource).toContain("(input.producerClosedAt ?? null) === null");
    expect(artistSource).toContain("producerClosedAt: producers.closedAt");
    expect(artistSource).toContain("producerClosedAt: row.producerClosedAt");
  });

  it("artists get a sentence, not the literal code NOT_FOUND", () => {
    const mapper = slice(
      artistSource,
      "function mapSessionBookingDomainError",
      "async function emitArtistSessionNotificationBestEffort",
    );
    expect(mapper).toContain("no longer open for booking");
  });
});

describe("wall-clock formatter cache", () => {
  it("stays correct across zones and still rejects invalid zones", () => {
    const instant = new Date("2026-08-25T21:30:00.000Z");
    const jerusalem = zonedWallClockAt(instant, "Asia/Jerusalem");
    expect([jerusalem.hour, jerusalem.minute, jerusalem.day]).toEqual([0, 30, 26]);
    // Second call takes the cached formatter — identical result.
    expect(zonedWallClockAt(instant, "Asia/Jerusalem")).toEqual(jerusalem);
    const newYork = zonedWallClockAt(instant, "America/New_York");
    expect([newYork.hour, newYork.minute, newYork.day]).toEqual([17, 30, 25]);
    expect(() => zonedWallClockAt(instant, "Not/AZone")).toThrow();
    expect(() => zonedWallClockAt(instant, "Not/AZone")).toThrow();
  });
});
