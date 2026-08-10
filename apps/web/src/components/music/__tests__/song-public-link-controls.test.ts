import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  shareAuthoritativePublicSongLink,
  type SongPublicSharingView,
} from "../song-public-link-controls";

const liveState: SongPublicSharingView = {
  trackId: "00000000-0000-4000-8000-000000000001",
  linkEnabled: true,
  portfolioPublished: false,
  remainingAudioCount: 2,
  tokenVersion: 1,
  publicUrl: "https://skitza.app/listen/old-token.signature",
};

describe("artist public-link share authority", () => {
  it("shares the freshly authenticated URL instead of stale rendered state", async () => {
    const shares: Array<{ title?: string; url?: string }> = [];
    const result = await shareAuthoritativePublicSongLink({
      role: "artist",
      state: liveState,
      title: "Final mix",
      refreshLiveState: () =>
        Promise.resolve({
          ok: true,
          state: {
            ...liveState,
            tokenVersion: 2,
            publicUrl: "https://skitza.app/listen/new-token.signature",
          },
        }),
      shareLink: (payload) => {
        shares.push(payload);
        return Promise.resolve({ status: "shared", method: "native" });
      },
    });

    expect(result).toMatchObject({
      ok: true,
      method: "native",
      state: { tokenVersion: 2 },
    });
    expect(shares).toEqual([
      {
        title: "Final mix",
        url: "https://skitza.app/listen/new-token.signature",
        fallbackText: "https://skitza.app/listen/new-token.signature",
      },
    ]);
  });

  it("does not share after the producer disables the link", async () => {
    const shares: string[] = [];
    const result = await shareAuthoritativePublicSongLink({
      role: "artist",
      state: liveState,
      title: "Final mix",
      refreshLiveState: () => Promise.resolve({ ok: true, state: null }),
      shareLink: (payload) => {
        shares.push(payload.url ?? "");
        return Promise.resolve({ status: "shared", method: "native" });
      },
    });

    expect(result).toEqual({
      ok: false,
      error: "This public link is no longer live.",
      state: { ...liveState, linkEnabled: false, publicUrl: null },
    });
    expect(shares).toEqual([]);
  });

  it("fails closed when the artist authority refresh is unavailable", async () => {
    const shares: string[] = [];
    const result = await shareAuthoritativePublicSongLink({
      role: "artist",
      state: liveState,
      title: "Final mix",
      shareLink: (payload) => {
        shares.push(payload.url ?? "");
        return Promise.resolve({ status: "shared", method: "native" });
      },
    });

    expect(result).toEqual({
      ok: false,
      error: "Could not confirm that this public link is still live.",
    });
    expect(shares).toEqual([]);
  });

  it("does not share when the authority refresh rejects", async () => {
    const shares: string[] = [];
    const result = await shareAuthoritativePublicSongLink({
      role: "artist",
      state: liveState,
      title: "Final mix",
      refreshLiveState: () => Promise.reject(new Error("network unavailable")),
      shareLink: (payload) => {
        shares.push(payload.url ?? "");
        return Promise.resolve({ status: "shared", method: "native" });
      },
    });

    expect(result).toEqual({
      ok: false,
      error: "Could not confirm that this public link is still live.",
    });
    expect(shares).toEqual([]);
  });

  it("falls back to the clipboard through the native-share adapter", async () => {
    await expect(
      shareAuthoritativePublicSongLink({
        role: "producer",
        state: liveState,
        title: "Final mix",
        shareLink: () => Promise.resolve({ status: "copied", method: "clipboard" }),
      }),
    ).resolves.toMatchObject({ ok: true, method: "clipboard" });
  });

  it("turns a share-adapter rejection into local failure feedback", async () => {
    await expect(
      shareAuthoritativePublicSongLink({
        role: "producer",
        state: liveState,
        title: "Final mix",
        shareLink: () => Promise.reject(new Error("share unavailable")),
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: "Could not share the link. Please try again.",
    });
  });

  it.each([
    "https://private.example/audio.mp3",
    "https://skitza.app/listen/public-token.signature?signedUrl=secret",
    "https://skitza.app/api/private-delivery",
  ])("never shares a non-canonical public-song URL: %s", async (publicUrl) => {
    const shares: string[] = [];
    const result = await shareAuthoritativePublicSongLink({
      role: "producer",
      state: { ...liveState, publicUrl },
      title: "Final mix",
      shareLink: (payload) => {
        shares.push(payload.url ?? "");
        return Promise.resolve({ status: "shared", method: "native" });
      },
    });

    expect(result.ok).toBe(false);
    expect(shares).toEqual([]);
  });

  it("lets the owning artist create a guest link and rechecks it before sharing", () => {
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
    expect(actions).toContain("caller.songPublication.artistPublish(input)");
    expect(actions).toContain("publishArtistPublicSongLink");
    expect(page).toContain("publicSharingRefresh: refreshArtistPublicSongLink");
    expect(page).toContain("publicSharingActions");
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
