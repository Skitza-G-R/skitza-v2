import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const artistSource = readFileSync(join(here, "..", "artist.ts"), "utf8");
const bookingSource = readFileSync(join(here, "..", "booking.ts"), "utf8");
const serviceSource = readFileSync(
  join(here, "..", "..", "..", "domain", "session-booking", "service.ts"),
  "utf8",
);

const artistAvailability = artistSource.slice(
  artistSource.indexOf("availability: artistProcedure"),
  artistSource.indexOf("activePackages: artistProcedure"),
);
const artistConfirm = artistSource.slice(
  artistSource.indexOf("confirm: artistProcedure"),
  artistSource.indexOf("mySessions: artistProcedure"),
);
const manualCreate = bookingSource.slice(
  bookingSource.indexOf("create: producerProcedure", bookingSource.indexOf("manual: router")),
  bookingSource.indexOf("reschedule: router"),
);
const manualAvailability = bookingSource.slice(
  bookingSource.indexOf("availability: producerProcedure", bookingSource.indexOf("manual: router")),
  bookingSource.indexOf("preview: producerProcedure", bookingSource.indexOf("manual: router")),
);
const rescheduleAvailability = bookingSource.slice(
  bookingSource.indexOf(
    "availability: producerProcedure",
    bookingSource.indexOf("reschedule: router"),
  ),
  bookingSource.indexOf("preview: producerProcedure", bookingSource.indexOf("reschedule: router")),
);
const rescheduleCreate = bookingSource.slice(
  bookingSource.indexOf("create: producerProcedure", bookingSource.indexOf("reschedule: router")),
  bookingSource.indexOf("changeRequest: router"),
);

describe("SK-193 booking FreeBusy boundary", () => {
  it("filters artist slots through normalized busy instants and returns only a safe health signal", () => {
    expect(artistAvailability).toContain("readGoogleCalendarBusyIntervals({");
    expect(artistAvailability).toContain("googleBusyIntervals: googleBusy.intervals");
    expect(artistAvailability).toContain("googleCalendarProtection:");
    expect(artistAvailability).not.toMatch(/summary|description|attendees|location/);
  });

  it("bypasses the provider for an artist replay and fetches before the locked create command", () => {
    const replay = artistConfirm.indexOf("existingOperation");
    const provider = artistConfirm.indexOf("readGoogleCalendarBusyIntervals({");
    const command = artistConfirm.indexOf("createSessionBooking(sessionBookingRepository(ctx.db)");

    expect(replay).toBeGreaterThanOrEqual(0);
    expect(provider).toBeGreaterThan(replay);
    expect(command).toBeGreaterThan(provider);
    expect(artistConfirm).toContain("googleBusyIntervals: googleBusy.intervals");
  });

  it("keeps manual replay first, then performs the final provider check before the transaction", () => {
    const replay = manualCreate.indexOf("findProducerManualSessionBookingReplay");
    const provider = manualCreate.indexOf("readGoogleCalendarBusyIntervals({", replay);
    const command = manualCreate.indexOf(
      "createProducerManualSessionBooking(sessionBookingRepository(ctx.db)",
    );

    expect(replay).toBeGreaterThanOrEqual(0);
    expect(provider).toBeGreaterThan(replay);
    expect(command).toBeGreaterThan(provider);
    expect(serviceSource).toContain('code !== "GOOGLE_BUSY"');
    expect(serviceSource).toContain('slotActor: "producer_google_hard"');
    expect(serviceSource).toContain("googleBusyIntervals: options.googleBusyIntervals");
    expect(manualCreate).toContain("acknowledgedReducedGoogleProtection");
    expect(manualCreate).toContain("reviewedFinalGoogleCalendarProtection({");
    expect(manualCreate).toContain("replayedGoogleCalendarProtection(");
  });

  it("requires reviewed reduced protection for final producer writes and replays conservatively", () => {
    for (const command of [manualCreate, rescheduleCreate]) {
      expect(command).toContain("acknowledgedReducedGoogleProtection");
      expect(command).toContain("reviewedFinalGoogleCalendarProtection({");
      expect(command).toContain("replayedGoogleCalendarProtection(");
      expect(command).toMatch(/result\.created[\s\S]*replayedGoogleCalendarProtection/);
    }
    expect(serviceSource).toContain("acknowledgedReducedGoogleProtection: true");
  });

  it("filters producer manual and reschedule read models with fresh FreeBusy", () => {
    expect(bookingSource).toContain("publicExactSessionAvailability(");
    expect(bookingSource).toContain("slot.startsAt.toISOString()");
    expect(bookingSource).toContain("slot.endsAt.toISOString()");
    for (const availability of [manualAvailability, rescheduleAvailability]) {
      expect(availability).toContain("readGoogleCalendarBusyIntervals({");
      expect(availability).toContain("googleBusy.intervals");
      expect(availability).toContain("googleCalendarProtection:");
      expect(availability).not.toMatch(/summary|description|attendees|location/);
    }
  });
});
