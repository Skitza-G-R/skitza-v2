import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const page = readFileSync(join(__dirname, "../page.tsx"), "utf8");
const libraryRouter = readFileSync(
  join(__dirname, "../../../../../server/trpc/routers/library.ts"),
  "utf8",
);
const readModel = readFileSync(
  join(__dirname, "../../../../../server/domain/song-spaces/music-read-model.ts"),
  "utf8",
);

describe("artist Music studio scope", () => {
  it("defaults the read to the selected studio", () => {
    expect(page).toMatch(/resolveArtistStudioId/);
    expect(page).toMatch(/artistList\([\s\S]*producerId: activeStudioId/);
    expect(libraryRouter).toMatch(/producerId: z\.string\(\)\.uuid\(\)\.optional\(\)/);
    expect(readModel).toMatch(/scope\.producerId \? eq\(projects\.producerId, scope\.producerId\)/);
  });

  it("offers a local combined All music view", () => {
    expect(page).toMatch(/sp\.view === "all"/);
    expect(page).toMatch(/All music/);
    expect(page).toMatch(/allMusic \|\| !activeStudioId \? undefined/);
  });

  it("keeps the selected studio in both local scope links", () => {
    expect(page).toMatch(/withArtistStudio\("\/artist\/music", activeStudioId\)/);
    expect(page).toMatch(/withArtistStudio\("\/artist\/music\?view=all", activeStudioId\)/);
  });
});
