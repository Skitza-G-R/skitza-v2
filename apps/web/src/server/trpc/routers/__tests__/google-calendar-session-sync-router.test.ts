import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../booking.ts", import.meta.url), "utf8");
const start = source.indexOf("  googleCalendarSync: router({");
const end = source.indexOf("\n  // ── Blackouts", start);
const block = source.slice(start, end);

describe("producer Google Calendar session sync router", () => {
  it("keeps reads and recovery actions behind the producer guard", () => {
    expect(start).toBeGreaterThan(-1);
    expect(block.match(/producerProcedure/g)).toHaveLength(3);
    expect(block).toContain("getSessionBookingGoogleCalendarSyncStatuses");
    expect(block).toContain("retrySessionBookingGoogleCalendarSync");
    expect(block).toContain("restoreMissingSessionBookingGoogleCalendarEvent");
    expect(block).toContain("producerId: ctx.producerId");
    expect(block).toContain("bookingIds: input.ids");
  });

  it("bounds the status batch and operation keys and returns only safe domain results", () => {
    expect(block).toContain("ids: z.array(z.string().uuid()).max(");
    expect(block).toContain("GOOGLE_CALENDAR_SYNC_STATUS_BATCH_LIMIT");
    expect(
      block.match(/operationKey: z\.string\(\)\.trim\(\)\.min\(1\)\.max\(200\)/g),
    ).toHaveLength(2);
    expect(block).not.toMatch(/provider|eventId|etag|jobId|errorCode|payload/i);
  });
});
