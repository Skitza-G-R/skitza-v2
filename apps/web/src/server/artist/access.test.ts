import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { assertArtistMusicProjectAvailable } from "./access";

describe("artist Music lifecycle access", () => {
  it("hides waiting projects but preserves listening access to later lifecycle states", () => {
    expect(() => {
      assertArtistMusicProjectAvailable("waiting_for_payment");
    }).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));

    for (const status of ["active", "paused", "completed", "canceled"] as const) {
      expect(() => {
        assertArtistMusicProjectAvailable(status);
      }).not.toThrow();
    }
  });
});

describe("stable artist relationship boundary", () => {
  it("uses client id and artist disconnect state, not mutable email or producer archive", () => {
    const source = readFileSync(__filename.replace("access.test.ts", "access.ts"), "utf8");
    const start = source.indexOf("export function activeArtistClientOwner");
    const end = source.indexOf("export function assertArtistMusicProjectAvailable", start);
    const ownerBoundary = source.slice(start, end);

    expect(ownerBoundary).toContain("clientContacts.id");
    expect(ownerBoundary).toContain("resource.clientContactId");
    expect(ownerBoundary).toContain("clientContacts.archivedAt");
    expect(ownerBoundary).not.toMatch(/email|producerArchivedAt/);
  });
});
