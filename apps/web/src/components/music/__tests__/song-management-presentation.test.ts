import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  aggregateMusicProjects,
  filterMusicRowsBySongArchive,
  isMusicLibraryTrackAudioDeleted,
  isMusicLibraryTrackPlayable,
  type MusicLibraryEmptySlotRow,
  type MusicLibraryTrackRow,
} from "../library-screen";
import {
  isProjectPageTrackAudioDeleted,
  isProjectPageTrackPlayable,
  type ProjectPageTrack,
} from "../project-page";

const project = {
  projectId: "project-1",
  projectTitle: "Night Bus",
  projectLifecycleStatus: "active" as const,
  clientName: "Maya Vale",
};

function song(id: string, archivedAtIso: string | null): MusicLibraryTrackRow {
  return {
    kind: "track",
    id,
    trackId: id,
    trackTitle: id === "track-active" ? "Daylight" : "Midnight",
    trackArtist: "Maya Vale",
    archivedAtIso,
    label: "V1",
    latestVersionId: `${id}-version`,
    uploadedAtIso: "2026-07-19T12:00:00.000Z",
    audioUrl: `https://audio.test/${id}`,
    durationMs: 120_000,
    unreadComments: 0,
    plays: 2,
    ...project,
  };
}

const emptySlot: MusicLibraryEmptySlotRow = {
  kind: "empty-slot",
  id: "purchase-1:3",
  purchaseId: "purchase-1",
  slotIndex: 3,
  ...project,
};

describe("producer song archive presentation", () => {
  const active = song("track-active", null);
  const archived = song("track-archived", "2026-07-18T12:00:00.000Z");

  it("keeps empty spaces with Active Songs and shows only real archived songs in Archived Songs", () => {
    expect(filterMusicRowsBySongArchive([active, archived, emptySlot], "active")).toEqual([
      active,
      emptySlot,
    ]);
    expect(filterMusicRowsBySongArchive([active, archived, emptySlot], "archived")).toEqual([
      archived,
    ]);
  });

  it("keeps the project active and visible when one of its songs is archived", () => {
    const [aggregate] = aggregateMusicProjects([active, archived, emptySlot]);
    expect(aggregate).toMatchObject({
      id: "project-1",
      projectLifecycleStatus: "active",
      trackCount: 3,
      playableTrackCount: 2,
    });
  });
});

describe("deleted-audio and Released row presentation", () => {
  const deletedSong: MusicLibraryTrackRow = {
    ...song("track-deleted", null),
    audioUrl: null,
    audioDeletedAtIso: "2026-07-19T13:00:00.000Z",
    releasedAtIso: "2026-07-19T12:00:00.000Z",
  };
  const deletedProjectTrack: ProjectPageTrack = {
    id: "track-deleted",
    trackId: "track-deleted",
    title: "Midnight",
    artist: "Maya Vale",
    archivedAtIso: null,
    releasedAtIso: "2026-07-19T12:00:00.000Z",
    audioDeletedAtIso: "2026-07-19T13:00:00.000Z",
    versionLabel: "Final",
    latestVersionId: "version-deleted",
    audioUrl: null,
    durationMs: null,
    uploadedAtIso: "2026-07-19T12:00:00.000Z",
    unreadComments: 2,
    plays: 4,
  };

  it("treats an explicit tombstone as history, never playable audio", () => {
    expect(isMusicLibraryTrackAudioDeleted(deletedSong)).toBe(true);
    expect(isMusicLibraryTrackPlayable(deletedSong)).toBe(false);
    expect(isProjectPageTrackAudioDeleted(deletedProjectTrack)).toBe(true);
    expect(isProjectPageTrackPlayable(deletedProjectTrack)).toBe(false);
  });

  it("does not infer deletion from an ordinary zero-version allocation", () => {
    const neverUploaded = { ...deletedSong, audioDeletedAtIso: null, releasedAtIso: null };
    expect(isMusicLibraryTrackAudioDeleted(neverUploaded)).toBe(false);
    expect(isMusicLibraryTrackPlayable(neverUploaded)).toBe(false);
  });
});

describe("song management source guards", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const librarySource = readFileSync(join(here, "..", "library-screen.tsx"), "utf8");
  const projectSource = readFileSync(join(here, "..", "project-page.tsx"), "utf8");
  const controlsSource = readFileSync(join(here, "..", "song-management-controls.tsx"), "utf8");
  const producerLibrarySource = readFileSync(
    join(here, "..", "producer-music-library.tsx"),
    "utf8",
  );

  it("renders an independent producer song-status filter outside project lifecycle filtering", () => {
    expect(librarySource).toContain('aria-label="Song status"');
    expect(librarySource).toContain("Active Songs");
    expect(librarySource).toContain("Archived Songs");
    expect(librarySource).toContain("songArchiveFilter");
    expect(librarySource).toContain("filterMusicRowsBySongArchive");
  });

  it("threads archive state and management controls through Library and L2 allocated rows", () => {
    expect(librarySource).toContain("archivedAtIso: string | null");
    expect(projectSource).toContain("archivedAtIso: string | null");
    expect(librarySource).toContain("<SongManagementControls");
    expect(projectSource).toContain("<SongManagementControls");
    expect(controlsSource).toContain("Rename song");
    expect(controlsSource).toContain("Edit artist credit");
    expect(controlsSource).toContain("Archive song");
    expect(controlsSource).toContain("Restore song");
  });

  it("keeps archived songs playable but suppresses new-upload entry points", () => {
    expect(librarySource).toContain("const songArchived = song.archivedAtIso !== null");
    expect(librarySource).toContain("!songArchived && song.actionHref");
    expect(projectSource).toContain("const songArchived = item.archivedAtIso !== null");
    expect(projectSource).toContain("!songArchived && actionHref");
  });

  it("keeps deleted-audio history links while leaving play gated by actual audio", () => {
    expect(librarySource.match(/const href = versionId \? songHref/g)).toHaveLength(2);
    expect(projectSource.match(/const rowHref = versionId \? projectSongHref/g)).toHaveLength(2);
    expect(librarySource).toContain("const canPlay = isMusicLibraryTrackPlayable(item)");
    expect(projectSource).toContain("const canPlay = isProjectPageTrackPlayable(item)");
  });

  it("distinguishes intentional deletion from a song awaiting its first upload", () => {
    for (const source of [librarySource, projectSource]) {
      expect(source).toContain("audioDeletedAtIso?: string | null");
      expect(source).toContain("Audio deleted");
      expect(source).toContain("No playable audio — history kept");
    }
  });

  it("threads optional one-way Released management through producer rows only", () => {
    for (const source of [librarySource, projectSource, producerLibrarySource]) {
      expect(source).toContain("markReleased");
    }
    expect(librarySource).toContain("releasedAtIso?: string | null");
    expect(projectSource).toContain("releasedAtIso?: string | null");
    expect(controlsSource).toContain("Mark as Released");
    expect(controlsSource).toContain("One-way change");
    expect(controlsSource).toContain("released || !markReleased");
    expect(controlsSource).toContain("Released songs allow permanent deletion");
    expect(librarySource).toContain('role === "producer"');
    expect(projectSource).toContain('role === "producer"');
  });

  it("uses 44px controls and radius-lg text actions in a mobile-safe dialog", () => {
    expect(controlsSource).toContain("h-11 w-11");
    expect(controlsSource).toContain("min-h-11");
    expect(controlsSource).toContain("rounded-[var(--radius-lg)]");
    expect(controlsSource).toContain("sk-sheet-mobile");
    expect(controlsSource).not.toContain("framer-motion");
    expect(controlsSource).toContain("Mark as Released");
  });
});
