import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const artistSource = readFileSync(join(__dirname, "../artist.ts"), "utf8");
const librarySource = readFileSync(join(__dirname, "../library.ts"), "utf8");
const musicReadModelSource = readFileSync(
  join(__dirname, "../../../domain/song-spaces/music-read-model.ts"),
  "utf8",
);

function procedureBlock(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

function expectExactProjectOwnerJoin(block: string) {
  expect(block).toMatch(/\.innerJoin\(\s*clientContacts,/);
  expect(block).toContain("eq(clientContacts.id, projects.clientContactId)");
  expect(block).toContain("eq(clientContacts.producerId, projects.producerId)");
  expect(block).toContain("eq(clientContacts.clerkUserId, scope.clerkUserId)");
  expect(block).toContain("isNull(clientContacts.archivedAt)");
  expect(block).not.toMatch(/\.leftJoin\(\s*clientContacts,/);
  expect(block).not.toContain("projects.artistEmail");
}

describe("artist exact relationship wiring", () => {
  const loadProjectHeads = procedureBlock(
    musicReadModelSource,
    "async function loadProjectHeads",
    "type NoChargeSourcePurchase",
  );
  const artistProjectHeads = loadProjectHeads.slice(
    loadProjectHeads.lastIndexOf("  const rows = await db"),
  );

  it("scopes the current artist Music reads by the exact project relationship", () => {
    const listBlock = procedureBlock(
      librarySource,
      "    artistList: artistProcedure",
      "    artistProject: artistProcedure",
    );
    const projectBlock = procedureBlock(
      librarySource,
      "    artistProject: artistProcedure",
      "  }),",
    );

    expect(listBlock).toContain("listMusicSongSpaces");
    expect(projectBlock).toContain("getMusicProjectSongSpaces");
    for (const block of [listBlock, projectBlock]) {
      expect(block).toContain('kind: "artist"');
      expect(block).toContain("clerkUserId: ctx.clerkUserId");
    }
    expectExactProjectOwnerJoin(artistProjectHeads);
  });

  it("hides waiting projects from every artist Music read without hiding archives", () => {
    const detailBlock = procedureBlock(
      artistSource,
      "  detail: artistProcedure",
      "  // Resolve / re-open",
    );

    expect(artistProjectHeads).toContain('ne(projects.lifecycleStatus, "waiting_for_payment")');
    expect(detailBlock).toContain(
      "assertArtistMusicProjectAvailable(ownedProject.lifecycleStatus)",
    );
    expect(musicReadModelSource).not.toContain(
      'eq(projects.lifecycleStatus, "active") // artist Music',
    );
  });

  it("gates the artist lyrics write on the exact project relationship", () => {
    const block = procedureBlock(artistSource, "  setSongLyrics: artistProcedure", "});");

    // SK-305 lets the artist rewrite a song's words, so this is a real write
    // on producer-owned data. It must pass through the same ownership gate as
    // every other artist write, and it must hand the domain the producer id
    // that gate resolved — never one the client supplied.
    expect(block).toContain("resolveProjectOwnership(");
    expect(block).toContain("assertArtistMusicProjectAvailable(ownedProject.lifecycleStatus)");
    expect(block).toContain("producerId: ownedProject.producerId");
    expect(block).not.toMatch(/producerId:\s*input\./);
    expect(block).toContain('updatedBy: "artist"');
    // The stamp is what stops the artist silently replacing the producer's
    // sheet. Dropping it would make every save win.
    expect(block).toContain("expectedUpdatedAt:");
  });

  it("does not infer booking-level payment state", () => {
    const block = procedureBlock(
      artistSource,
      "  myPendingPayments: artistProcedure.query",
      "// ─── artist.store sub-router",
    );

    expect(block).toContain("available: false");
    expect(block).toContain("bookings: []");
    expect(block).not.toMatch(/\.from\(bookings\)|\.from\(products\)/);
  });

  it("does not expose the removed recent-booking confirmation inference", () => {
    expect(artistSource).not.toContain("recentConfirmedBooking");
  });
});
