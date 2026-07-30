import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const service = readFileSync(
  join(process.cwd(), "src/server/domain/song-artwork/service.ts"),
  "utf8",
);

describe("song artwork replacement concurrency", () => {
  it("locks and updates with the token's canonical UUID", () => {
    expect(service).toContain("song-artwork:${payload.trackId}");
    expect(service).not.toContain("song-artwork:${input.trackId}");
    expect(service).toContain("eq(projectTracks.id, payload.trackId)");
  });

  it("takes a row lock before checking the signed base revision", () => {
    const transactionStart = service.indexOf("const previous = await db.transaction");
    const revisionCheck = service.indexOf("payload.baseRevision", transactionStart);
    const guardedSection = service.slice(transactionStart, revisionCheck);

    expect(transactionStart).toBeGreaterThan(-1);
    expect(revisionCheck).toBeGreaterThan(transactionStart);
    expect(guardedSection).toContain("eq(projectTracks.id, payload.trackId)");
    expect(guardedSection).toContain('.for("update")');
  });
});
