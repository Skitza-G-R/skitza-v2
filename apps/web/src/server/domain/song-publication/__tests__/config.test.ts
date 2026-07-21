import { afterEach, describe, expect, it, vi } from "vitest";

import { songPublicationSecret } from "../config";

describe("songPublicationSecret", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does not fall back to the Clerk credential", () => {
    vi.stubEnv("SONG_PUBLIC_LINK_SECRET", "");
    vi.stubEnv("CLERK_SECRET_KEY", "clerk-secret-that-is-more-than-32-characters");

    expect(() => songPublicationSecret()).toThrow("Missing or weak SONG_PUBLIC_LINK_SECRET");
  });

  it("rejects a dedicated secret shorter than 32 characters", () => {
    vi.stubEnv("SONG_PUBLIC_LINK_SECRET", "x".repeat(31));

    expect(() => songPublicationSecret()).toThrow("Missing or weak SONG_PUBLIC_LINK_SECRET");
  });

  it("returns the dedicated secret when it is strong enough", () => {
    const secret = "s".repeat(32);
    vi.stubEnv("SONG_PUBLIC_LINK_SECRET", secret);
    vi.stubEnv("CLERK_SECRET_KEY", "unused-clerk-secret-that-is-more-than-32-characters");

    expect(songPublicationSecret()).toBe(secret);
  });
});
