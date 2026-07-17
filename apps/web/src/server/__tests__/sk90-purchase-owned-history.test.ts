import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("SK-90 purchase-owned history callers", () => {
  it("soft-deletes failed-upload versions instead of deleting immutable history", () => {
    const projectRouter = source("src/server/trpc/routers/project.ts");
    const deleteVersion = projectRouter.slice(
      projectRouter.indexOf("deleteVersion:"),
      projectRouter.indexOf("setPaid:"),
    );

    expect(deleteVersion).not.toMatch(/\.delete\(trackVersions\)/);
    expect(deleteVersion).toMatch(/\.set\(\{ audioDeletedAt \}\)/);
    expect(deleteVersion).toMatch(/isNull\(trackVersions\.audioUrl\)/);
    expect(deleteVersion).toMatch(/row\.pendingAudioR2Key !== null/);
    expect(deleteVersion).toMatch(/isNull\(trackVersions\.pendingAudioR2Key\)/);
    expect(deleteVersion).toMatch(/isNull\(trackVersions\.pendingAudioCompletionToken\)/);
    expect(deleteVersion).toMatch(/isNull\(trackVersions\.pendingAudioSizeBytes\)/);
    expect(deleteVersion).toMatch(/isNull\(trackVersions\.pendingAudioStartedAt\)/);
    expect(deleteVersion).toMatch(/isNull\(trackVersions\.pendingAudioCleanupEtag\)/);
    expect(deleteVersion).toMatch(/code: "CONFLICT"/);
  });

  it("keeps unfinished or deleted audio out of latest-listening surfaces", () => {
    const artistRouter = source("src/server/trpc/routers/artist.ts");
    const producerRouter = source("src/server/trpc/routers/producer.ts");

    const artistProjects = artistRouter.slice(
      artistRouter.indexOf("  projects: artistProcedure.query"),
      artistRouter.indexOf("  list: artistProcedure.query"),
    );
    const artistList = artistRouter.slice(
      artistRouter.indexOf("  list: artistProcedure.query"),
      artistRouter.indexOf("  // Full detail for one project"),
    );
    const artistProject = artistRouter.slice(
      artistRouter.indexOf("  project: artistProcedure"),
      artistRouter.indexOf("  // Timestamped comment"),
    );
    const artistHome = artistRouter.slice(
      artistRouter.indexOf("  home: artistProcedure.query"),
      artistRouter.indexOf("  // Soft-disconnect"),
    );
    const producerMusic = producerRouter.slice(
      producerRouter.indexOf("  music: router"),
      producerRouter.indexOf("  // Full data export"),
    );
    const producerToday = producerRouter.slice(
      producerRouter.indexOf("  today: producerProcedure.query"),
      producerRouter.indexOf("  // ─── Overview sub-router"),
    );

    for (const block of [artistProjects, artistList, artistProject, artistHome]) {
      expect(block).toContain("isNotNull(trackVersions.audioUrl)");
      expect(block).toContain("isNull(trackVersions.audioDeletedAt)");
    }
    expect(
      (artistHome.match(/isNotNull\(trackVersions\.audioUrl\)/g) ?? []).length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      (artistHome.match(/isNull\(trackVersions\.audioDeletedAt\)/g) ?? []).length,
    ).toBeGreaterThanOrEqual(2);

    expect(
      (producerMusic.match(/isNotNull\(trackVersions\.audioUrl\)/g) ?? []).length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      (producerMusic.match(/isNull\(trackVersions\.audioDeletedAt\)/g) ?? []).length,
    ).toBeGreaterThanOrEqual(2);
    expect(producerToday).toContain("isNotNull(trackVersions.audioUrl)");
    expect(producerToday).toContain("isNull(trackVersions.audioDeletedAt)");
  });
});
