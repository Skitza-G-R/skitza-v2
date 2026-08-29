import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// SK-280: the sweep body moved to a shared module (the nightly calendar-sync
// cron runs it too); the contract below now reads that module, and the route
// itself must stay a thin authenticated wrapper around it.
const source = readFileSync(
  new URL("../../../../server/calendar/session-reminder-sweep.ts", import.meta.url),
  "utf8",
);
const routeSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

describe("session reminder and Held-expiry cron contract", () => {
  it("expires overdue Held bookings through the serialized domain service", () => {
    expect(source).toMatch(
      /eq\(bookings\.status, "pending_approval"\)[\s\S]*lte\(bookings\.heldExpiresAt, now\)[\s\S]*isNull\(bookings\.heldExpiredAt\)/,
    );
    expect(source).toContain("expireHeldSessionBooking(sessionBookingRepository(db)");
    expect(source).toContain("`cron:held-expiry:${booking.id}`");
    expect(source).toMatch(
      /if \(!result\.changed\) continue;[\s\S]*kind: "booking_cancelled"[\s\S]*sourceEventId: `held-expiry:\$\{booking\.id\}`/,
    );
    expect(source).toContain("The booking request expired before it was confirmed.");
  });

  it.each([["24h", "reminderSent24h", "session_reminder_24h"]] as const)(
    "claims each %s occurrence before delivery",
    (_label, column, kind) => {
      const claim = `.set({ ${column}: now })`;
      const claimIndex = source.indexOf(claim);
      const eventIndex = source.indexOf(`kind: "${kind}"`, claimIndex);
      expect(claimIndex).toBeGreaterThanOrEqual(0);
      expect(eventIndex).toBeGreaterThan(claimIndex);
      expect(source.slice(claimIndex, eventIndex)).toContain(`isNull(bookings.${column})`);
      expect(source.slice(claimIndex, eventIndex)).toContain(".returning({ id: bookings.id })");
      expect(source.slice(claimIndex, eventIndex)).toContain("if (!claimed) continue");
    },
  );

  it("uses stable per-booking reminder identities and never creates Studio dots for them", () => {
    expect(source).toContain("sourceEventId: `${b.id}:24h`");
  });

  it("gates only artist email on saved preferences", () => {
    expect(source.match(/if \(artistEmailEnabled\)/g)).toHaveLength(1);
    expect(source.match(/if \(ctx\.producerEmail\)/g)).toHaveLength(1);
  });

  it("releases a claim when the artist send fails so the next sweep retries", () => {
    expect(source.match(/await unclaimReminder\(db, b\.id\)/g)).toHaveLength(1);
  });

  // SK-290: the 1h "starting soon" reminder was dropped — its 75-minute window
  // could not survive the once-a-night cadence. The schema keeps
  // bookings.reminder_sent_1h and the session_reminder_1h notification kind
  // because production history already references them.
  it("no longer sends a 1h reminder", () => {
    expect(source).not.toContain("sendSessionReminder1h");
    expect(source).not.toContain("reminderSent1h");
    expect(source).not.toContain('kind: "session_reminder_1h"');
  });

  it("keeps the route a thin authenticated wrapper around the shared sweep", () => {
    expect(routeSource).toContain("Bearer ${expected}");
    expect(routeSource).toContain("runSessionReminderSweep(createDb(dbUrl), new Date())");
  });
});
