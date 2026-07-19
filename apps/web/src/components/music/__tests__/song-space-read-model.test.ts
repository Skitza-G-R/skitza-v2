import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  aggregateMusicProjects,
  kindFromVisibleSpaceCount,
  latestVersionIdForLibraryTrack,
  type MusicLibraryEmptySlotRow,
  type MusicLibraryTrackRow,
} from "../library-screen";
import {
  latestVersionIdForProjectTrack,
  projectKindFromVisibleSpaces,
  summarizeProjectMusic,
  type ProjectPageEmptySlot,
  type ProjectPageTrack,
} from "../project-page";

const project = {
  projectId: "project-1",
  projectTitle: "Night Bus",
  projectLifecycleStatus: "active" as const,
  clientName: "Maya Vale",
};

const allocatedNoVersion: MusicLibraryTrackRow = {
  kind: "track",
  id: "track-1",
  trackId: "track-1",
  trackTitle: "First song",
  trackArtist: "Maya Vale",
  label: null,
  latestVersionId: null,
  uploadedAtIso: null,
  audioUrl: null,
  durationMs: null,
  unreadComments: 0,
  plays: 0,
  ...project,
};

const emptySlot: MusicLibraryEmptySlotRow = {
  kind: "empty-slot",
  id: "purchase-1:2",
  purchaseId: "purchase-1",
  slotIndex: 2,
  ...project,
};

describe("Music Library purchased-space read model", () => {
  it("uses total visible spaces for single-to-album shape", () => {
    expect(kindFromVisibleSpaceCount(1)).toBe("SINGLE");
    expect(kindFromVisibleSpaceCount(2)).toBe("ALBUM");
    expect(kindFromVisibleSpaceCount(5)).toBe("ALBUM");

    const [aggregate] = aggregateMusicProjects([allocatedNoVersion, emptySlot]);
    expect(aggregate).toMatchObject({
      trackCount: 2,
      kind: "ALBUM",
      playableTrackCount: 0,
      durationMs: 0,
    });
  });

  it("keeps a project visible from an explicit purchased-space count before rows exist", () => {
    const [aggregate] = aggregateMusicProjects(
      [],
      [
        {
          id: "project-2",
          title: "Quiet Shapes",
          artistLabel: "Noa Drift",
          visibleSpaceCount: 3,
          projectLifecycleStatus: "active",
          latestTrackUploadedAtIso: null,
        },
      ],
    );
    expect(aggregate).toMatchObject({ trackCount: 3, kind: "ALBUM" });
  });

  it("never fabricates a version id for an allocated zero-version song", () => {
    expect(latestVersionIdForLibraryTrack(allocatedNoVersion)).toBeNull();
    const legacyRow: MusicLibraryTrackRow = {
      ...allocatedNoVersion,
      id: "legacy-version-id",
    };
    delete legacyRow.latestVersionId;
    expect(latestVersionIdForLibraryTrack(legacyRow)).toBe("legacy-version-id");
  });
});

const projectTrack: ProjectPageTrack = {
  kind: "track",
  id: "track-1",
  trackId: "track-1",
  title: "First song",
  artist: "Maya Vale",
  versionLabel: null,
  latestVersionId: null,
  audioUrl: null,
  durationMs: null,
  uploadedAtIso: null,
  unreadComments: 0,
  plays: 0,
};

const projectSlot: ProjectPageEmptySlot = {
  kind: "empty-slot",
  id: "purchase-1:2",
  purchaseId: "purchase-1",
  slotIndex: 2,
};

describe("Project page purchased-space read model", () => {
  it("summarizes allocated and virtual spaces without counting either as playable", () => {
    expect(summarizeProjectMusic([projectTrack])).toMatchObject({
      kind: "SINGLE",
      visibleSpaceCount: 1,
      allocatedSongCount: 1,
      emptySpaceCount: 0,
      playableTrackCount: 0,
      lastUploadIso: null,
    });
    expect(summarizeProjectMusic([projectTrack, projectSlot])).toMatchObject({
      kind: "ALBUM",
      visibleSpaceCount: 2,
      allocatedSongCount: 1,
      emptySpaceCount: 1,
      playableTrackCount: 0,
    });
  });

  it("uses explicit nullable version identity on project rows", () => {
    expect(latestVersionIdForProjectTrack(projectTrack)).toBeNull();
    expect(projectKindFromVisibleSpaces(1)).toBe("SINGLE");
    expect(projectKindFromVisibleSpaces(2)).toBe("ALBUM");
  });
});

describe("honest empty UI source guards", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const librarySource = readFileSync(join(here, "..", "library-screen.tsx"), "utf8");
  const projectSource = readFileSync(join(here, "..", "project-page.tsx"), "utf8");

  it("marks virtual and allocated-no-audio rows and uses the configurable Add Song entry", () => {
    expect(librarySource).toContain('data-music-row="empty-slot"');
    expect(librarySource).toContain('"allocated-no-audio"');
    expect(librarySource).toContain('addSongHref = "/dashboard/music?addSong=1"');
    expect(librarySource).not.toContain("/dashboard/clients-projects?action=upload");
    expect(projectSource).toContain('data-project-music-row="empty-slot"');
    expect(projectSource).toContain('"allocated-no-audio"');
    expect(projectSource).not.toContain("?tab=music&action=upload");
  });

  it("keeps narrow toolbar labels bounded at 360 and expands them on desktop", () => {
    expect(librarySource).toContain("max-w-[112px]");
    expect(librarySource).toContain('className="pointer-events-none hidden md:inline"');
  });

  it("keeps playable song-page links touch-safe in desktop and mobile rows", () => {
    expect(librarySource.match(/className="flex min-h-11 w-full items-center truncate/g)).toHaveLength(2);
  });

  it("keeps only functional project actions and hides Shuffle without playable audio", () => {
    expect(projectSource).toContain('ariaLabel="Shuffle"');
    expect(projectSource).toContain('ariaLabel="Share"');
    expect(projectSource).toContain("playableTracks.length > 0 ? (");
    expect(projectSource).not.toContain('ariaLabel="More"');
    expect(projectSource).not.toContain('aria-label="More actions"');
    expect(projectSource).not.toContain("MoreHorizontal");
    expect(projectSource).toContain('title="Share project link"');
    expect(projectSource).toContain('setShareConfirm("copied")');
    expect(projectSource).toContain("inline-flex h-11 w-11 items-center");
  });
});
