import { describe, expect, it } from "vitest";

import {
  artistStudioPreferenceForUser,
  decodeArtistStudioPreference,
  encodeArtistStudioPreference,
} from "./artist-studio-preference";

describe("artist studio preference cookie codec", () => {
  it("round-trips one user-bound studio preference", () => {
    const encoded = encodeArtistStudioPreference({
      userId: "user_artist-1",
      studioId: "studio-2",
    });
    expect(decodeArtistStudioPreference(encoded)).toEqual({
      userId: "user_artist-1",
      studioId: "studio-2",
    });
  });

  it("fails closed for malformed or unsupported values", () => {
    expect(decodeArtistStudioPreference("not-json")).toBeNull();
    expect(
      decodeArtistStudioPreference(
        encodeURIComponent(JSON.stringify({ v: 2, u: "user-a", s: "studio-a" })),
      ),
    ).toBeNull();
    expect(
      decodeArtistStudioPreference(
        encodeURIComponent(JSON.stringify({ v: 1, u: "", s: "studio-a" })),
      ),
    ).toBeNull();
  });

  it("never lets another signed-in account inherit the preference", () => {
    const encoded = encodeArtistStudioPreference({
      userId: "user-a",
      studioId: "studio-shared",
    });
    expect(artistStudioPreferenceForUser(encoded, "user-a")).toBe("studio-shared");
    expect(artistStudioPreferenceForUser(encoded, "user-b")).toBeNull();
  });
});
