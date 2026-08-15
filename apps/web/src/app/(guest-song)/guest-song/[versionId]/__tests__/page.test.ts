import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { metadata } from "../page";

const source = readFileSync(new URL("../page.tsx", import.meta.url), "utf8");

describe("normal-address guest Song page", () => {
  it("is noindex, nofollow, no-cache, and does not forward its private URL", () => {
    expect(metadata.robots).toEqual({
      index: false,
      follow: false,
      nocache: true,
      googleBot: { index: false, follow: false, noimageindex: true },
    });
    expect(metadata.referrer).toBe("no-referrer");
  });

  it("renders the shared Song page without app-only comments or controls", () => {
    expect(source).toContain("readAddressSharedSong");
    expect(source).toContain("readAddressSongDownloadEntitlements");
    expect(source).toContain("comments: []");
    expect(source).toContain('role="guest"');
    expect(source).not.toContain("producer.music.detail");
    expect(source).not.toContain("artist.music.detail");
  });

  it("accepts only the trusted normal Song path and links guests to the homepage", () => {
    expect(source).toContain('"x-skitza-original-song-path"');
    expect(source).toContain("`/dashboard/music/${versionId}`");
    expect(source).toContain("`/artist/music/song/${versionId}`");
    expect(source).toMatch(/<Link\s+href="\/"/);
    expect(source).toContain("Join now!");
    expect(source).not.toContain("loginHref");
    expect(source).not.toContain("Log in");
  });
});
