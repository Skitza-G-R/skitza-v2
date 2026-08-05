import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const artistSource = readFileSync(join(process.cwd(), "src/server/trpc/routers/artist.ts"), "utf8");
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
    expect(availability).toMatch(/for \(const block of blocks\)/);
    expect(availability).toMatch(/startMin \+= 30/);
    expect(availability).toMatch(/studioLocalDateTimeUtcCandidates/);
    expect(availability).toMatch(/for \(const startsAt of candidates\)/);
    expect(availability).toMatch(/assertSessionSlotAvailable/);
    expect(availability).toMatch(/continue;/);
    expect(availability).not.toMatch(/available = false;\s*break/);
  });

  it("returns exact instants grouped in the producer timezone", () => {
    expect(availability).toMatch(/const bookingTimeZone = producer\.timeZone/);
    expect(availability).toMatch(/studioLocalDateKey\(startsAt, bookingTimeZone\)/);
    expect(availability).toMatch(/startsAt,/);
    expect(availability).toMatch(/endsAt:/);
    expect(availability).toMatch(/artistTimeZone:\s*bookingTimeZone/);
    expect(availability).toMatch(/studioTimeZone:\s*bookingTimeZone/);
  });

  it("renders only server-authored day.slots and submits startsAtISO", () => {
    expect(bookingClientSource).toMatch(/day\.slots/);
    expect(bookingClientSource).toMatch(/slot\.startsAtISO/);
    expect(bookingClientSource).not.toMatch(/day\.(?:morning|evening|blocks)/);
  });
});
