import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  copyAuthoritativePublicSongLink,
  type SongPublicSharingView,
} from "../song-public-link-controls";

const liveState: SongPublicSharingView = {
  trackId: "00000000-0000-4000-8000-000000000001",
  linkEnabled: true,
  portfolioPublished: false,
  remainingAudioCount: 2,
  tokenVersion: 1,
  publicUrl: "https://skitza.app/listen/old-token",
};

describe("artist public-link copy authority", () => {
  it("copies the freshly authenticated URL instead of stale rendered state", async () => {
    const writes: string[] = [];
    const result = await copyAuthoritativePublicSongLink({
      role: "artist",
      state: liveState,
      refreshLiveState: () =>
        Promise.resolve({
          ok: true,
          state: {
            ...liveState,
            tokenVersion: 2,
            publicUrl: "https://skitza.app/listen/new-token",
          },
        }),
      writeText: (value) => {
        writes.push(value);
        return Promise.resolve();
      },
    });

    expect(result).toMatchObject({ ok: true, state: { tokenVersion: 2 } });
    expect(writes).toEqual(["https://skitza.app/listen/new-token"]);
  });

  it("does not copy after the producer disables the link", async () => {
    const writes: string[] = [];
    const result = await copyAuthoritativePublicSongLink({
      role: "artist",
      state: liveState,
      refreshLiveState: () => Promise.resolve({ ok: true, state: null }),
      writeText: (value) => {
        writes.push(value);
        return Promise.resolve();
      },
    });

    expect(result).toEqual({
      ok: false,
      error: "This public link is no longer live.",
      state: { ...liveState, linkEnabled: false, publicUrl: null },
    });
    expect(writes).toEqual([]);
  });

  it("fails closed when the artist authority refresh is unavailable", async () => {
    const writes: string[] = [];
    const result = await copyAuthoritativePublicSongLink({
      role: "artist",
      state: liveState,
      writeText: (value) => {
        writes.push(value);
        return Promise.resolve();
      },
    });

    expect(result).toEqual({
      ok: false,
      error: "Could not confirm that this public link is still live.",
    });
    expect(writes).toEqual([]);
  });

  it("does not copy when the authority refresh rejects", async () => {
    const writes: string[] = [];
    const result = await copyAuthoritativePublicSongLink({
      role: "artist",
      state: liveState,
      refreshLiveState: () => Promise.reject(new Error("network unavailable")),
      writeText: (value) => {
        writes.push(value);
        return Promise.resolve();
      },
    });

    expect(result).toEqual({
      ok: false,
      error: "Could not confirm that this public link is still live.",
    });
    expect(writes).toEqual([]);
  });

  it("is wired through a read-only artist server action", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const route = join(
      here,
      "..",
      "..",
      "..",
      "app",
      "(artist)",
      "artist",
      "music",
      "song",
      "[versionId]",
    );
    const actions = readFileSync(join(route, "actions.ts"), "utf8");
    const page = readFileSync(join(route, "page.tsx"), "utf8");

    expect(actions).toContain("caller.songPublication.artistState(input)");
    expect(actions).toMatch(/err\.code === "NOT_FOUND"[\s\S]{0,100}state: null/);
    expect(page).toContain("publicSharingRefresh: refreshArtistPublicSongLink");
  });
});

describe("public-link control motion", () => {
  it("disables each new transition and dialog animation for reduced motion", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, "..", "song-public-link-controls.tsx"), "utf8");

    expect(source).toContain("motion-reduce:animate-none");
    expect(source.match(/transition-(?:\[[^\]]+\]|colors|transform)/g)?.length).toBe(
      source.match(/motion-reduce:transition-none/g)?.length,
    );
  });
});
