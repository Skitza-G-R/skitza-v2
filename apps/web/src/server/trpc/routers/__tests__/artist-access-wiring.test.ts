import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(join(__dirname, "../artist.ts"), "utf8");

function procedureBlock(start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

function expectExactRelationshipJoin(
  block: string,
  resource: "projects" | "bookings",
) {
  expect(block).toMatch(/\.innerJoin\(\s*clientContacts,/);
  expect(block).toContain("activeArtistClientPair(ctx.clerkUserId");
  expect(block).toContain(`producerId: ${resource}.producerId`);
  expect(block).toContain(
    `email: ${resource === "projects" ? "projects.artistEmail" : "bookings.artistEmail"}`,
  );
  expect(block).not.toMatch(/\.leftJoin\(\s*clientContacts,/);
  expect(block).not.toMatch(/\bmyProducerIds\b|\bmyEmails\b/);
}

describe("artist exact relationship wiring", () => {
  it("scopes the flat music list by the exact project relationship", () => {
    const block = procedureBlock(
      "  list: artistProcedure.query",
      "  // Full detail for one project",
    );

    expectExactRelationshipJoin(block, "projects");
  });

  it("scopes pending payments by the exact booking relationship and product tenant", () => {
    const block = procedureBlock(
      "  myPendingPayments: artistProcedure.query",
      "// ─── artist.store sub-router",
    );

    expectExactRelationshipJoin(block, "bookings");
    expect(block).toContain("eq(products.producerId, bookings.producerId)");
  });

  it("does not expose the removed recent-booking confirmation inference", () => {
    expect(source).not.toContain("recentConfirmedBooking");
  });
});
