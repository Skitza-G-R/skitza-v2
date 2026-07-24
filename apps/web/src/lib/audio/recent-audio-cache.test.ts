import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RECENT_AUDIO_MAX_AGE_MS,
  RECENT_AUDIO_MAX_BYTES,
  RECENT_AUDIO_MAX_ENTRIES,
  isAudioUrlSafeToRestore,
  isRecentAudioCacheEligible,
  readRecentAudio,
} from "./recent-audio-cache";

const ORIGIN = "https://skitza.test";
const ACCOUNT_ID = "user_cache";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("recent audio eligibility is default-deny", () => {
  it("only accepts an explicit unlocked marker in the reserved same-origin namespace", () => {
    expect(isRecentAudioCacheEligible("/media/unlocked/song.mp3", "public-unlocked", ORIGIN)).toBe(
      true,
    );
    expect(isRecentAudioCacheEligible("/media/unlocked/song.mp3", undefined, ORIGIN)).toBe(false);
    expect(isRecentAudioCacheEligible("/media/unlocked/song.mp3", "none", ORIGIN)).toBe(false);
  });

  it.each([
    ["/api/audio/stream/11111111-1111-4111-8111-111111111111", "protected stream"],
    ["/api/audio/public/song/id?token=secret", "public token"],
    ["/api/audio/public/song/id?cap=secret", "public capability"],
    ["/media/unlocked/song.mp3?X-Amz-Signature=secret", "signed query"],
    ["/producers/producer-id/tracks/version-id/song.wav", "storage key path"],
    ["https://bucket.r2.cloudflarestorage.com/song.wav", "direct R2"],
    ["https://audio.example/song.wav", "cross-origin"],
  ])("rejects %s (%s)", (url) => {
    expect(isRecentAudioCacheEligible(url, "public-unlocked", ORIGIN)).toBe(false);
  });

  it("allows account-scoped metadata restoration for re-authorized private routes, never capability URLs", () => {
    expect(
      isAudioUrlSafeToRestore("/api/audio/stream/11111111-1111-4111-8111-111111111111", ORIGIN),
    ).toBe(true);
    expect(isAudioUrlSafeToRestore("/api/audio/public/song/id?token=secret", ORIGIN)).toBe(false);
    expect(
      isAudioUrlSafeToRestore("https://bucket.r2.cloudflarestorage.com/song.wav", ORIGIN),
    ).toBe(false);
  });

  it("stays within the locked count, age, and absolute byte ceilings", () => {
    expect(RECENT_AUDIO_MAX_ENTRIES).toBeLessThanOrEqual(10);
    expect(RECENT_AUDIO_MAX_AGE_MS).toBeLessThanOrEqual(30 * 24 * 60 * 60 * 1_000);
    expect(RECENT_AUDIO_MAX_BYTES).toBeLessThanOrEqual(250 * 1024 * 1024);
  });
});

describe("recent audio LRU expiry", () => {
  it("prunes an already-expired hit instead of reviving it", async () => {
    const url = `${ORIGIN}/media/unlocked/song.mp3`;
    const deleteCached = vi.fn(() => Promise.resolve(true));
    const cache = {
      match: vi.fn(() =>
        Promise.resolve(
          new Response("audio", {
            status: 200,
            headers: { "content-type": "audio/mpeg" },
          }),
        ),
      ),
      delete: deleteCached,
    };
    vi.stubGlobal("caches", {
      open: () => Promise.resolve(cache),
    });
    const indexKey = `skitza:recent-audio:v1:${encodeURIComponent(ACCOUNT_ID)}`;
    const stored = new Map([
      [
        indexKey,
        JSON.stringify([
          {
            url,
            sizeBytes: 5,
            lastUsedAt: new Date(Date.now() - RECENT_AUDIO_MAX_AGE_MS - 1).toISOString(),
          },
        ]),
      ],
    ]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
    });

    await expect(readRecentAudio(ACCOUNT_ID, url, "public-unlocked", ORIGIN)).resolves.toBeNull();
    expect(deleteCached).toHaveBeenCalledOnce();
    expect(stored.get(indexKey)).toBe("[]");
  });
});
