import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const artistSource = readFileSync(join(process.cwd(), "src/server/trpc/routers/artist.ts"), "utf8");
const bookingEngineSource = readFileSync(
  join(process.cwd(), "src/server/booking/availability.ts"),
  "utf8",
);
const producerSource = readFileSync(
  join(process.cwd(), "src/server/trpc/routers/booking.ts"),
  "utf8",
);

function sourceBlock(source: string, startToken: string, endToken?: string): string {
  const start = source.indexOf(startToken);
  const end = endToken ? source.indexOf(endToken, start) : source.length;
  expect(start, startToken).toBeGreaterThanOrEqual(0);
  expect(end, endToken ?? "end of source").toBeGreaterThan(start);
  return source.slice(start, end);
}

const artistBook = sourceBlock(
  artistSource,
  "const bookSubrouter = router({",
  "const storeSubrouter = router({",
);
const producerBookingCommands = sourceBlock(
  producerSource,
  "// ── Bookings (producer-only views + status transitions)",
);
const artistAvailability = sourceBlock(
  artistBook,
  "availability: artistProcedure",
  "activePackages: artistProcedure",
);
const artistMusicProject = sourceBlock(
  artistSource,
  "project: artistProcedure",
  "addComment: artistProcedure",
);
const artistActivePackages = sourceBlock(
  artistBook,
  "activePackages: artistProcedure",
  "confirm: artistProcedure",
);

describe("SK-68 artist session router boundary", () => {
  it("authors slots in the studio timezone and groups them in the artist timezone", () => {
    expect(artistAvailability).toMatch(/timeZone:\s*producers\.timezone/);
    expect(artistAvailability).toMatch(/today:/);
    expect(artistAvailability).toMatch(
      /const artistTimeZone = artistProfile\.timezone \?\? producer\.timeZone/,
    );
    expect(artistAvailability).toMatch(/artistTimeZone,/);
    expect(artistAvailability).toMatch(/studioTimeZone:\s*producer\.timeZone/);
    expect(artistAvailability).toContain("generateArtistExactSessionSlots({");
    expect(artistAvailability).toContain("today: generated.today");
    expect(bookingEngineSource).toContain("producerLocalDateRange(");
    expect(bookingEngineSource).toContain("sessionAvailabilityHorizonDays(input.minLeadHours)");
    expect(bookingEngineSource).toContain("zonedLocalDateKey(startsAt, input.artistTimeZone)");
  });

  it("presents artist-local time with a safe producer-timezone fallback", () => {
    expect(artistSource).toMatch(
      /artistTimezone:\s*row\.artistTimezone \?\? row\.producerTimezone/,
    );
    expect(artistSource).toMatch(/producerTimezone:\s*row\.producerTimezone/);
    expect(artistMusicProject).toContain("getArtistProfile(ctx.db, ctx.clerkUserId)");
    expect(artistMusicProject).toMatch(
      /const artistTimezone = artistProfile\.timezone \?\? producerTimezone/,
    );
    expect(artistMusicProject).toContain("artistTimezone,");
  });

  it("keeps valid exact candidates when another start in the block is invalid", () => {
    expect(artistAvailability).not.toMatch(/startMin \+= 30|studioLocalDateTimeUtcCandidates/);
    expect(bookingEngineSource).toMatch(/studioStartMin \+= slotIncrementMin/);
    expect(bookingEngineSource).toContain("studioLocalDateTimeUtcCandidates");
    expect(bookingEngineSource).toMatch(/catch \(error\)[\s\S]*continue;/);
    expect(bookingEngineSource).not.toMatch(/available = false;\s*break/);
  });

  it("authorizes availability against the exact purchased allowance and its stored terms", () => {
    expect(artistAvailability).toMatch(
      /sessionAllowanceId:\s*z\.string\(\)\.uuid\(\)\.optional\(\)/,
    );
    expect(artistAvailability).toMatch(
      /Boolean\(value\.sessionAllowanceId\) !== Boolean\(value\.bookingId\)/,
    );
    expect(artistAvailability).toContain(
      "eq(purchaseSessionAllowances.id, input.sessionAllowanceId)",
    );
    expect(artistAvailability).toContain(
      "eq(purchaseSessionAllowances.producerId, input.producerId)",
    );
    expect(artistAvailability).toContain("eq(clientContacts.clerkUserId, ctx.clerkUserId)");
    expect(artistAvailability).toContain("isNull(clientContacts.archivedAt)");
    for (const field of ["durationMin", "bufferMinutes", "minLeadHours"]) {
      expect(artistAvailability, field).toContain(`${field}: purchaseSessionAllowances.${field}`);
    }
    expect(artistAvailability).toContain(
      "const { durationMin, bufferMinutes, minLeadHours } = selectedTerms",
    );
    expect(artistAvailability).not.toContain("producers.defaultSessionMin");
  });

  it("rejects a missing allowance selector and derives reschedule truth from the source booking", () => {
    expect(artistAvailability).toContain(
      'if (!selectedTerms) throw new TRPCError({ code: "NOT_FOUND" })',
    );
    expect(artistAvailability).toContain(
      "eq(purchaseSessionAllowances.id, bookings.sessionAllowanceId)",
    );
    expect(artistAvailability).toContain("ignoredBookingId = owned.bookingId");
    expect(artistAvailability).toContain("row.bookingId !== ignoredBookingId");
    expect(artistAvailability).toMatch(/ignoreBookingId: ignoredBookingId/);
    expect(artistAvailability).toContain(
      'billingTreatmentMode: input.bookingId ? "preserve" : "choose"',
    );
  });

  it("uses artist authentication for every read and command", () => {
    for (const procedure of [
      "activePackages",
      "confirm",
      "mySessions",
      "session",
      "cancel",
      "reschedule",
    ]) {
      expect(artistBook).toMatch(new RegExp(`${procedure}: artistProcedure`));
    }
    expect(artistBook).toContain("ctx.clerkUserId");
    expect(artistBook).not.toMatch(/clerkUserId:\s*z\./);
    expect(artistBook).not.toMatch(/artistEmail:\s*z\./);
    expect(artistBook).not.toMatch(/clientContactId:\s*z\./);
  });

  it("returns every immutable purchased scheduling term needed by the booking flow", () => {
    for (const field of [
      "durationMin",
      "locationType",
      "bufferMinutes",
      "minLeadHours",
      "autoConfirm(?:Bookings)?",
    ]) {
      expect(artistActivePackages, field).toMatch(new RegExp(`${field}:`));
    }
  });

  it("requires durable operation keys for create, cancel, and reschedule", () => {
    for (const procedure of ["confirm", "cancel", "reschedule"]) {
      const command = sourceBlock(
        artistBook,
        `${procedure}: artistProcedure`,
        procedure === "reschedule"
          ? undefined
          : `${procedure === "confirm" ? "mySessions" : "reschedule"}: artistProcedure`,
      );
      expect(command).toMatch(
        /operationKey:\s*(?:operationKeySchema|z\.string\(\)\.trim\(\)\.min\(1\)\.max\(200\))/,
      );
    }
  });

  it("accepts one exact server-authored instant for create and reschedule requests", () => {
    for (const procedure of ["confirm", "reschedule"]) {
      const command = sourceBlock(
        artistBook,
        `${procedure}: artistProcedure`,
        procedure === "confirm" ? "mySessions: artistProcedure" : undefined,
      );
      expect(command).toMatch(/startsAt:\s*z\.date\(\)/);
      expect(command).not.toMatch(/date:\s*z\.string/);
      expect(command).not.toMatch(/startMin:\s*z\.number/);
      expect(command).not.toMatch(/Date\.UTC\(/);
      expect(command).toMatch(
        procedure === "confirm"
          ? /startsAt:\s*input\.startsAt/
          : /proposedStartsAt:\s*input\.startsAt/,
      );
      expect(command).not.toMatch(/localSlot:/);
      expect(command).not.toMatch(/sessionStartFromLocalSlot\(/);
    }
  });

  it("derives the frozen purchased duration instead of accepting it from the browser", () => {
    const create = sourceBlock(
      artistBook,
      "confirm: artistProcedure",
      "mySessions: artistProcedure",
    );
    expect(create).not.toMatch(/durationMin:\s*z\./);
    expect(create).not.toMatch(/durationMin:\s*input\.durationMin/);
  });

  it("leaves timezone conversion and clock sampling inside atomic domain commands", () => {
    for (const procedure of ["confirm", "cancel", "reschedule"]) {
      const command = sourceBlock(
        artistBook,
        `${procedure}: artistProcedure`,
        procedure === "reschedule"
          ? undefined
          : `${procedure === "confirm" ? "mySessions" : "reschedule"}: artistProcedure`,
      );
      expect(command).not.toMatch(/now:\s*new Date\(\)/);
    }
    for (const procedure of [
      "setTitle",
      "confirm",
      "reject",
      "cancel",
      "recordLateCancellation",
      "noShow",
      "complete",
    ]) {
      const start = producerBookingCommands.indexOf(`${procedure}: producerProcedure`);
      const next = producerBookingCommands.indexOf(
        ": producerProcedure",
        start + `${procedure}: producerProcedure`.length,
      );
      const command = producerBookingCommands.slice(
        start,
        next === -1 ? producerBookingCommands.length : next,
      );
      expect(command, procedure).not.toMatch(/now:\s*new Date\(\)/);
    }
  });

  it("keeps command handlers thin and delegates lifecycle decisions", () => {
    expect(artistBook).toContain("createSessionBooking(");
    expect(artistBook.match(/submitArtistSessionChangeRequest\(/g)).toHaveLength(2);
    expect(artistBook).toContain("sessionBookingRepository(ctx.db)");
    expect(artistBook).not.toMatch(/\.insert\(bookings\)/);
    expect(artistBook).not.toMatch(/\.update\(bookings\)/);
    expect(artistBook).not.toMatch(/\.delete\(bookings\)/);
  });

  it("starts the durable calendar job after an artist withdraws a pending hold", () => {
    const cancel = sourceBlock(
      artistBook,
      "cancel: artistProcedure",
      "reschedule: artistProcedure",
    );
    expect(cancel).toMatch(
      /cancelArtistSessionBooking[\s\S]*deliverCalendarJobAfterResponse\(ctx\.db, withdrawal\.calendarSyncJobId\)/,
    );
  });

  it("returns server truth for automatic confirmation and pending change requests", () => {
    expect(artistBook).toMatch(/return\s+\{[^}]*id:[^}]*status:/s);
    expect(artistBook).toMatch(/reschedule[\s\S]*status: "request_sent"/);
    expect(artistBook).toMatch(/reschedule[\s\S]*changeRequestId: result\.request\.id/);
    expect(artistBook).not.toMatch(/status:\s*"pending_approval"/);
  });
});

describe("SK-68 producer session router boundary", () => {
  it("uses producer authentication and never accepts tenant or actor identity", () => {
    for (const procedure of [
      "confirm",
      "reject",
      "cancel",
      "recordLateCancellation",
      "noShow",
      "complete",
    ]) {
      expect(producerBookingCommands).toMatch(new RegExp(`${procedure}: producerProcedure`));
    }
    expect(producerBookingCommands).toContain("producerId: ctx.producerId");
    expect(producerBookingCommands).toContain("ctx.userId");
    expect(producerBookingCommands).not.toMatch(/producerId:\s*z\./);
    expect(producerBookingCommands).not.toMatch(/actorId:\s*z\./);
  });

  it("sets a producer-owned title through the atomic domain command and queues delivery", () => {
    const setTitle = sourceBlock(
      producerBookingCommands,
      "setTitle: producerProcedure",
      "confirm: producerProcedure",
    );

    expect(setTitle).toMatch(/title:\s*z\.string\(\)\.trim\(\)\.min\(1\)\.max\(200\)/);
    expect(setTitle).toContain("setProducerSessionTitle(sessionBookingRepository(ctx.db)");
    expect(setTitle).toContain("bookingId: input.id");
    expect(setTitle).toContain("producerId: ctx.producerId");
    expect(setTitle).toContain("title: input.title");
    expect(setTitle).toContain("deliverCalendarJobAfterResponse(ctx.db, result.calendarSyncJobId)");
    expect(setTitle).not.toMatch(/producerId:\s*z\./);
    expect(setTitle).not.toMatch(/actorId:\s*z\./);
  });

  it("requires an operation key for every producer transition", () => {
    for (const procedure of [
      "confirm",
      "reject",
      "cancel",
      "recordLateCancellation",
      "noShow",
      "complete",
    ]) {
      const start = producerBookingCommands.indexOf(`${procedure}: producerProcedure`);
      expect(start, procedure).toBeGreaterThanOrEqual(0);
      const nextProcedure = producerBookingCommands.indexOf(
        ": producerProcedure",
        start + `${procedure}: producerProcedure`.length,
      );
      const command = producerBookingCommands.slice(
        start,
        nextProcedure === -1 ? producerBookingCommands.length : nextProcedure,
      );
      expect(command).toMatch(
        /operationKey:\s*(?:operationKeySchema|z\.string\(\)\.trim\(\)\.min\(1\)\.max\(200\))/,
      );
    }
  });

  it("delegates every transition without writing booking rows in the router", () => {
    expect(producerBookingCommands).toContain("confirmSessionBooking(");
    expect(producerBookingCommands).toContain("rejectSessionBooking(");
    expect(producerBookingCommands).toContain("cancelProducerSessionBooking(");
    expect(producerBookingCommands).toContain("recordLateArtistCancellation(");
    expect(producerBookingCommands).toContain("markSessionNoShow(");
    expect(producerBookingCommands).toContain("completeSessionBooking(");
    expect(producerBookingCommands).toContain("sessionBookingRepository(ctx.db)");
    expect(producerBookingCommands).not.toMatch(/\.insert\(bookings\)/);
    expect(producerBookingCommands).not.toMatch(/\.update\(bookings\)/);
    expect(producerBookingCommands).not.toMatch(/\.delete\(bookings\)/);
  });
});
