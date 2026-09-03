import { describe, expect, it } from "vitest";

import {
  libraryPlayQueue,
  libraryRowToPlayerTrack,
  type MusicLibraryRow,
  type MusicLibraryTrackRow,
} from "../library-screen";

const PEAKS = Array.from({ length: 200 }, (_, index) => index / 199);

function trackRow(overrides: Partial<MusicLibraryTrackRow> = {}): MusicLibraryTrackRow {
  return {
    id: "row-1",
    kind: "track",
    trackId: "song-1",
    latestVersionId: "version-1",
    producerId: "producer-1",
    projectId: "project-1",
    projectTitle: "Full production",
    projectLifecycleStatus: "active",
    clientName: "Lital",
    trackTitle: "Lama",
    trackArtist: "Lital Ohayon",
    archivedAtIso: null,
    releasedAtIso: null,
    audioDeletedAtIso: null,
    label: "V1",
    uploadedAtIso: "2026-07-28T08:00:00.000Z",
    audioUrl: "https://audio.example/version-1.mp3",
    durationMs: 213_000,
    peaks: PEAKS,
    unreadComments: 0,
    plays: 0,
    ...overrides,
  };
}

// Library rows ship the pre-computed envelope so the dock paints the real
// waveform on the first frame. Without it every Library play costs a fetch
// and a Web Audio decode of the whole file before the strip stops being a
// placeholder.
describe("libraryRowToPlayerTrack peaks", () => {
  it("hands the row's pre-computed peaks to the player", () => {
    const track = libraryRowToPlayerTrack(trackRow(), "producer");
    expect(track?.peaks).toEqual(PEAKS);
  });

  it("omits peaks entirely when the row has none", () => {
    const track = libraryRowToPlayerTrack(trackRow({ peaks: null }), "producer");
    expect(track).not.toBeNull();
    expect(track && "peaks" in track).toBe(false);
  });

  it("omits peaks when the stored envelope is an empty array", () => {
    const track = libraryRowToPlayerTrack(trackRow({ peaks: [] }), "producer");
    expect(track && "peaks" in track).toBe(false);
  });

  it("carries peaks through for artist rows too", () => {
    const track = libraryRowToPlayerTrack(trackRow(), "artist");
    expect(track?.peaks).toEqual(PEAKS);
  });

  it("keeps peaks on every queue entry, not just the clicked row", () => {
    const rows: MusicLibraryRow[] = [
      trackRow({ id: "row-1", trackId: "song-1", latestVersionId: "version-1" }),
      trackRow({ id: "row-2", trackId: "song-2", latestVersionId: "version-2", peaks: null }),
      trackRow({ id: "row-3", trackId: "song-3", latestVersionId: "version-3" }),
    ];
    const queue = libraryPlayQueue(rows, "producer");
    expect(queue).toHaveLength(3);
    expect(queue[0]?.peaks).toEqual(PEAKS);
    expect(queue[1] && "peaks" in queue[1]).toBe(false);
    expect(queue[2]?.peaks).toEqual(PEAKS);
  });
});
