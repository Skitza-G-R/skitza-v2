import { describe, expect, it } from "vitest";

import {
  NEW_SONG_DESTINATION,
  defaultLibraryUploadDestination,
  shouldShowLibraryUploadDestination,
} from "../upload-destination";

describe("Library upload destination choices", () => {
  it("selects New Song without showing a control when it is the only choice", () => {
    const project = { canCreateNewSong: true, tracks: [] };

    expect(defaultLibraryUploadDestination(project)).toBe(NEW_SONG_DESTINATION);
    expect(shouldShowLibraryUploadDestination(project)).toBe(false);
  });

  it("selects the only existing Song without showing a one-option control", () => {
    const project = {
      canCreateNewSong: false,
      tracks: [{ id: "song-1" }],
    };

    expect(defaultLibraryUploadDestination(project)).toBe("song-1");
    expect(shouldShowLibraryUploadDestination(project)).toBe(false);
  });

  it("shows the control only when the producer has a real choice", () => {
    expect(
      shouldShowLibraryUploadDestination({
        canCreateNewSong: true,
        tracks: [{ id: "song-1" }],
      }),
    ).toBe(true);
    expect(
      shouldShowLibraryUploadDestination({
        canCreateNewSong: false,
        tracks: [{ id: "song-1" }, { id: "song-2" }],
      }),
    ).toBe(true);
  });
});
