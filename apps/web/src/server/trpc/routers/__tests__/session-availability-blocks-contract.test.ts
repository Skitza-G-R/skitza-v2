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

describe("artist allowance availability block contract", () => {
  it("preserves every configured block for each producer-local weekday", () => {
    const availability = sourceBlock(
      artistSource,
      "availability: artistProcedure",
      "activePackages: artistProcedure",
    );

    expect(availability).toMatch(/blocksByWeekday[\s\S]*BlockShape\[\]/);
    expect(availability).toMatch(/blocksByWeekday\.set\(b\.weekday,[\s\S]*block/);
    expect(availability).toMatch(/blocks:\s*blocks[\s\S]*\.map\(buildSlot\)/);
    expect(availability).not.toMatch(/morning:\s*buildSlot|evening:\s*buildSlot/);
  });

  it("renders availability from day.blocks without a two-block morning/evening projection", () => {
    expect(bookingClientSource).toMatch(/day\.blocks/);
    expect(bookingClientSource).not.toMatch(/day\.(?:morning|evening)/);
  });
});
