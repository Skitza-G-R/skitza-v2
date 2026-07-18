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

function expectExactProjectOwnerJoin(block: string) {
  expect(block).toMatch(/\.innerJoin\(\s*clientContacts,/);
  expect(block).toContain("activeArtistClientOwner(ctx.clerkUserId");
  expect(block).toContain("producerId: projects.producerId");
  expect(block).toContain("clientContactId: projects.clientContactId");
  expect(block).not.toMatch(/\.leftJoin\(\s*clientContacts,/);
  expect(block).not.toContain("projects.artistEmail");
}

describe("artist exact relationship wiring", () => {
  it("scopes the flat music list by the exact project relationship", () => {
    const block = procedureBlock(
      "  list: artistProcedure.query",
      "  // Full detail for one project",
    );

    expectExactProjectOwnerJoin(block);
    expect(block).toContain('ne(projects.lifecycleStatus, "waiting_for_payment")');
  });

  it("hides waiting projects from every artist Music read without hiding archives", () => {
    const projectsBlock = procedureBlock(
      "  projects: artistProcedure.query",
      "  list: artistProcedure.query",
    );
    const projectBlock = procedureBlock(
      "  project: artistProcedure",
      "  // Timestamped comment",
    );
    const detailBlock = procedureBlock(
      "  detail: artistProcedure",
      "  // Resolve / re-open",
    );
    const homeBlock = procedureBlock(
      "  home: artistProcedure.query",
      "  // Soft-disconnect",
    );

    expect((projectsBlock.match(/ne\(projects\.lifecycleStatus, "waiting_for_payment"\)/g) ?? []).length).toBe(2);
    expect(projectBlock).toContain("assertArtistMusicProjectAvailable(project.lifecycleStatus)");
    expect(detailBlock).toContain(
      "assertArtistMusicProjectAvailable(ownedProject.lifecycleStatus)",
    );
    expect((homeBlock.match(/ne\(projects\.lifecycleStatus, "waiting_for_payment"\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(source).not.toContain('eq(projects.lifecycleStatus, "active") // artist Music');
  });

  it("does not infer booking-level payment state", () => {
    const block = procedureBlock(
      "  myPendingPayments: artistProcedure.query",
      "// ─── artist.store sub-router",
    );

    expect(block).toContain("available: false");
    expect(block).toContain("bookings: []");
    expect(block).not.toMatch(/\.from\(bookings\)|\.from\(products\)/);
  });

  it("does not expose the removed recent-booking confirmation inference", () => {
    expect(source).not.toContain("recentConfirmedBooking");
  });
});
