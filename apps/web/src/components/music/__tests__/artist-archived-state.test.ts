import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const librarySource = readFileSync(join(here, "..", "library-screen.tsx"), "utf8");
const projectSource = readFileSync(join(here, "..", "project-page.tsx"), "utf8");
const songSource = readFileSync(join(here, "..", "song-page.tsx"), "utf8");
const artistRouterSource = readFileSync(
  join(here, "..", "..", "..", "server", "trpc", "routers", "artist.ts"),
  "utf8",
);
const artistLibraryPageSource = readFileSync(
  join(here, "..", "..", "..", "app", "(artist)", "artist", "music", "page.tsx"),
  "utf8",
);

describe("artist archived project listening surfaces", () => {
  it("threads the producer-scoped lifecycle through artist list, project, and song reads", () => {
    expect(artistRouterSource).toContain("projectLifecycleStatus: projects.lifecycleStatus");
    expect(artistRouterSource).toContain("lifecycleStatus: project.lifecycleStatus");
    expect(artistRouterSource).toContain("projectLifecycleStatus: ownedProject.lifecycleStatus");
    expect(artistRouterSource).toContain("activeArtistClientOwner(ctx.clerkUserId");
    expect(artistRouterSource).toContain(
      "assertArtistMusicProjectAvailable(ownedProject.lifecycleStatus)",
    );
  });

  it("labels both completed and canceled content on every shared music level", () => {
    for (const source of [librarySource, projectSource, songSource]) {
      expect(source).toContain("Archived · Completed");
      expect(source).toContain("Archived · Canceled");
    }
  });

  it("lists project-level archive rows and gives artists an Active/Archived project filter", () => {
    expect(artistLibraryPageSource).toContain("caller.artist.music.projects()");
    expect(artistLibraryPageSource).toContain("projectRows={projectRows}");
    expect(librarySource).toContain('aria-label="Project status"');
    expect(librarySource).toContain('label="Active"');
    expect(librarySource).toContain('label="Archived"');
    expect(librarySource).toContain("projectArchiveFilter");
    expect(librarySource).toContain("explicitProjects");
  });

  it("closes only new comment entry points while keeping the comment thread controls", () => {
    expect(songSource).toContain("const commentsClosed = archivedLabel !== null");
    expect(songSource).toContain("This project is archived. New comments are closed");
    expect(songSource).toMatch(/commentsClosed \? \([\s\S]*?role="status"/);
    expect(songSource).toContain("visibleComments.map");
    expect(songSource).toContain("handleResolveToggle(c)");
    expect(songSource).toContain("Reopen");
    expect(songSource).toContain("Resolve");
  });
});
