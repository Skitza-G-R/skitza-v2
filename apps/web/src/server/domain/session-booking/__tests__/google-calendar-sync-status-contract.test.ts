import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const dbSource = readFileSync(new URL("../db.ts", import.meta.url), "utf8");
const pageSource = readFileSync(
  new URL(
    "../../../../app/(producer)/dashboard/calendar/page.tsx",
    import.meta.url,
  ),
  "utf8",
);

const adapterStart = dbSource.indexOf("    findBookingGoogleCalendarSyncStatuses:");
const adapterEnd = dbSource.indexOf(
  "\n\n    findProducerManualSessionBookingByOperationKey:",
  adapterStart,
);
const adapter = dbSource.slice(adapterStart, adapterEnd);

describe("Google Calendar session status batch contract", () => {
  it("loads linked sessions once and scopes both bookings and links to the producer", () => {
    expect(adapterStart).toBeGreaterThan(-1);
    expect(adapter).toContain("inArray(bookingCalendarLinks.currentBookingId, [...input.bookingIds])");
    expect(adapter).toContain("eq(bookingCalendarLinks.producerId, input.producerId)");
    expect(adapter).toContain("eq(bookings.producerId, input.producerId)");
    expect(adapter).toContain(".innerJoin(\n          bookings,");
    expect(adapter).toContain(".innerJoin(\n          googleCalendarConnections,");
    expect(adapter).toContain('row.connectionStatus === "connected"');
    expect(adapter).toContain("return status ? [{ bookingId, status }] : [];");
    expect(adapter).not.toContain('return "not_synced"');
  });

  it("uses one bounded status request for the booking list instead of one request per row", () => {
    expect(pageSource.match(/googleCalendarSync\s*\.status/g)).toHaveLength(1);
    expect(pageSource).toContain(".slice(0, GOOGLE_CALENDAR_SYNC_STATUS_BATCH_LIMIT)");
    expect(pageSource).toContain(".status({ ids: googleCalendarSyncBookingIds })");
    expect(pageSource).not.toContain(".map(async (booking)");
  });
});
