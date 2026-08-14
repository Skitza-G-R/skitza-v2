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
const musicReadModelSource = readFileSync(
  join(here, "..", "..", "..", "server", "domain", "song-spaces", "music-read-model.ts"),
  "utf8",
);
const artistLibraryPageSource = readFileSync(
  join(here, "..", "..", "..", "app", "(artist)", "artist", "music", "page.tsx"),
  "utf8",
);

describe("artist Song-first listening surfaces", () => {
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

  it("keeps all authorized Songs in one Library with Project as a filter", () => {
    expect(artistLibraryPageSource).toMatch(
      /caller\.library\.music\.artistList\(\s*allMusic \|\| !activeStudioId \? undefined : \{ producerId: activeStudioId \},\s*\)/,
    );
    expect(musicReadModelSource).toContain(
      "scope.producerId ? eq(projects.producerId, scope.producerId) : undefined",
    );
    expect(musicReadModelSource).toContain("eq(clientContacts.clerkUserId, scope.clerkUserId)");
    expect(artistLibraryPageSource).toContain("projectRows={projectRows}");
    expect(librarySource).toContain('aria-label="Filter by project"');
    expect(librarySource).not.toContain('aria-label="Library mode"');
    expect(librarySource).not.toContain("<ProjectsGrid");
    expect(librarySource).not.toContain("<ProjectsTable");
  });

  it("does not apply the producer-only Song archive filter to artists", () => {
    expect(librarySource).toContain('if (role !== "producer") return filteredTracks');
    expect(librarySource).toMatch(
      /role === "producer" \? \([\s\S]{0,180}<SongArchiveFilterControl/,
    );
  });

  it("closes only new comment entry points while keeping the comment thread controls", () => {
    expect(songSource).toContain(
      "const commentsClosed = projectArchivedLabel !== null || songArchived",
    );
    expect(songSource).toContain("This project is archived. New comments are closed");
    expect(songSource).toMatch(/commentsClosed \? \([\s\S]*?role="status"/);
    expect(songSource).toContain("visibleComments.map");
    expect(songSource).toContain("handleResolveToggle(c)");
    expect(songSource).toContain("Reopen");
    expect(songSource).toContain("Resolve");
  });
});
