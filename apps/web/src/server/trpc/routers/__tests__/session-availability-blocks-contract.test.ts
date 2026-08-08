import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const artistSource = readFileSync(join(process.cwd(), "src/server/trpc/routers/artist.ts"), "utf8");
const bookingEngineSource = readFileSync(
  join(process.cwd(), "src/server/booking/availability.ts"),
  "utf8",
);
const bookingClientSource = readFileSync(
  join(process.cwd(), "src/app/(artist)/artist/book/booking-client.tsx"),
  "utf8",
);

function sourceBlock(source: string, startToken: string, endToken: string): string {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start);
  expect(start, startToken).toBeGreaterThanOrEqual(0);
  expect(end, endToken).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("artist exact availability slot contract", () => {
  const availability = sourceBlock(
    artistSource,
    "availability: artistProcedure",
    "activePackages: artistProcedure",
  );

  it("evaluates every 30-minute start in every producer-local block independently", () => {
    expect(availability).toContain("generateArtistExactSessionSlots({");
    expect(bookingEngineSource).toMatch(
      /for \(const block of blocksByWeekday\.get\(weekday\) \?\? \[\]\)/,
    );
    expect(bookingEngineSource).toMatch(/studioStartMin \+= slotIncrementMin/);
    expect(bookingEngineSource).toContain("studioLocalDateTimeUtcCandidates");
    expect(bookingEngineSource).toMatch(/for \(const startsAt of studioLocalDateTimeUtcCandidates/);
    expect(bookingEngineSource).toContain("assertSessionSlotAvailable({");
    expect(bookingEngineSource).not.toMatch(/available = false;\s*break/);
  });

  it("returns exact instants grouped in the artist timezone", () => {
    expect(availability).toMatch(
      /const artistTimeZone = artistProfile\.timezone \?\? producer\.timeZone/,
    );
    expect(bookingEngineSource).toMatch(/zonedLocalDateKey\(startsAt, input\.artistTimeZone\)/);
    expect(bookingEngineSource).toMatch(/startsAt,/);
    expect(bookingEngineSource).toMatch(/endsAt:/);
    expect(availability).toMatch(/artistTimeZone,/);
    expect(availability).toMatch(/studioTimeZone:\s*producer\.timeZone/);
  });

  it("renders only server-authored day.slots and submits startsAtISO", () => {
    expect(bookingClientSource).toMatch(/day\.slots/);
    expect(bookingClientSource).toMatch(/slot\.startsAtISO/);
    expect(bookingClientSource).not.toMatch(/day\.(?:morning|evening|blocks)/);
  });
});
