// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";

import {
  canonicalSongPageAddress,
  replaceBrowserSongPageVersion,
  songPagePathForVersion,
} from "../song-page-address";

const VERSION_ONE = "11111111-1111-4111-8111-111111111111";
const VERSION_TWO = "22222222-2222-4222-8222-222222222222";

describe("normal Song page addresses", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", `/dashboard/music/${VERSION_ONE}`);
  });

  it("builds the normal producer and artist paths for the active version", () => {
    expect(songPagePathForVersion("producer", VERSION_TWO)).toBe(`/dashboard/music/${VERSION_TWO}`);
    expect(songPagePathForVersion("artist", VERSION_TWO)).toBe(`/artist/music/song/${VERSION_TWO}`);
  });

  it("keeps the original normal route shape for a signed-out guest", () => {
    expect(songPagePathForVersion("guest", VERSION_TWO, `/dashboard/music/${VERSION_ONE}`)).toBe(
      `/dashboard/music/${VERSION_TWO}`,
    );
    expect(songPagePathForVersion("guest", VERSION_TWO, `/artist/music/song/${VERSION_ONE}`)).toBe(
      `/artist/music/song/${VERSION_TWO}`,
    );
    expect(songPagePathForVersion("guest", VERSION_TWO, "/guest-song/internal")).toBeNull();
  });

  it("shares a clean brand address with no query string or hash", () => {
    expect(canonicalSongPageAddress("producer", VERSION_TWO)).toBe(
      `https://skitza.app/dashboard/music/${VERSION_TWO}`,
    );
    expect(canonicalSongPageAddress("artist", VERSION_TWO)).toBe(
      `https://skitza.app/artist/music/song/${VERSION_TWO}`,
    );
  });

  it("updates the copied browser address when the listener changes versions", () => {
    window.history.replaceState(
      null,
      "",
      `/dashboard/music/${VERSION_ONE}?from=project&t=private&_vercel_share=preview#player`,
    );

    replaceBrowserSongPageVersion("producer", VERSION_TWO);

    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe(
      `/dashboard/music/${VERSION_TWO}?from=project#player`,
    );
  });
});
