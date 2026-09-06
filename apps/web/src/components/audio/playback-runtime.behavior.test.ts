import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clampSeekMs,
  clearPlaybackMediaSessionForPrivacy,
  normalizePlayerTrack,
  playbackSetCommandFromDetail,
  persistPlaybackSnapshotForAccount,
  reducePlaybackSnapshot,
  restorePlaybackForAccount,
  type PlaybackSnapshot,
  type PlayerTrack,
} from "./playback-runtime";

const ORIGIN = "https://skitza.test";
const VERSION_ID = "10000000-0000-4000-8000-000000000001";
const SOURCE = readFileSync(new URL("./playback-runtime.tsx", import.meta.url), "utf8");

function playbackKey(accountId: string): string {
  return `skitza:playback:v1:${encodeURIComponent(accountId)}`;
}

function storedPlayback(track: PlayerTrack, currentMs = 1_250): string {
  return JSON.stringify({
    version: 1,
    track,
    currentMs,
    updatedAt: "2026-07-24T08:00:00.000Z",
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("playback restoration", () => {
  it("gates cache lookup and active audio on live desktop validation", () => {
    expect(SOURCE).toContain("desktopSessionCacheAccess(accountId ?? null, browserOnline)");
    expect(SOURCE).toContain("subscribeBrowserOnline");
    expect(SOURCE).toContain("subscribeDesktopSessionValidation");
    expect(SOURCE).toContain('audio?.removeAttribute("src")');
    expect(SOURCE).toContain("clearPlaybackMediaSessionForPrivacy()");
    expect(SOURCE).toContain("emitPlayback({ ...EMPTY_PLAYBACK, volume: playbackSnapshot.volume })");
    expect(SOURCE.match(/if \(!desktopAudioAllowedRef\.current\) return;/g)).toHaveLength(8);
    expect(SOURCE).toContain("setResolvedSource(null)");
  });

  it("removes private Media Session metadata when desktop audio is locked", () => {
    const mediaSession = {
      metadata: { title: "Private mix" },
      playbackState: "playing",
    };
    vi.stubGlobal("navigator", { mediaSession });

    clearPlaybackMediaSessionForPrivacy();

    expect(mediaSession).toEqual({ metadata: null, playbackState: "none" });
    expect(SOURCE).toMatch(
      /if \(!desktopAudioAllowed\) \{\s*clearPlaybackMediaSessionForPrivacy\(\);\s*return;/,
    );
  });

  it("re-reports a resolved recent-cache source at Play before audible proof", () => {
    expect(SOURCE).toContain('proofSource: "recent-cache"');
    expect(SOURCE).toContain("recordGate1AudioSource(resolvedSource.proofSource)");
    expect(SOURCE.indexOf("recordGate1AudioSource(resolvedSource.proofSource)")).toBeLessThan(
      SOURCE.indexOf("void audio.play()"),
    );
    expect(SOURCE).toContain("if (!audio.muted && audio.volume > 0) recordGate1AudioPlaying()");
  });

  it("restores a safe route paused for its owning account only", () => {
    const accountA = "user_restore_a";
    const accountB = "user_restore_b";
    const values = new Map<string, string>([
      [
        playbackKey(accountA),
        storedPlayback({
          id: VERSION_ID,
          audioUrl: `/api/audio/stream/${VERSION_ID}`,
          title: "Safe mix",
          subtitle: "Artist",
          durationMs: 10_000,
          cachePolicy: "account-unlocked",
        }),
      ],
    ]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });

    expect(restorePlaybackForAccount(accountA, ORIGIN)).toMatchObject({
      playing: false,
      currentMs: 1_250,
      track: {
        id: VERSION_ID,
        audioUrl: `/api/audio/stream/${VERSION_ID}`,
        cachePolicy: "account-unlocked",
      },
    });
    expect(restorePlaybackForAccount(accountB, ORIGIN)).toEqual({
      track: null,
      playing: false,
      currentMs: 0,
      audioDurationSec: null,
      volume: 1,
      queue: [],
      loop: "off",
      shuffle: false,
      shuffleOrder: [],
    });
  });

  it("rejects and removes token-bearing or unknown-policy restoration state", () => {
    const accountId = "user_restore_unsafe";
    const values = new Map<string, string>([
      [
        playbackKey(accountId),
        JSON.stringify({
          version: 1,
          track: {
            id: VERSION_ID,
            audioUrl: `/api/audio/stream/${VERSION_ID}?token=secret`,
            title: "Unsafe mix",
            subtitle: "Artist",
            durationMs: 10_000,
            cachePolicy: "unexpected-policy",
          },
          currentMs: 5_000,
          updatedAt: "2026-07-24T08:00:00.000Z",
        }),
      ],
    ]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
    });

    expect(restorePlaybackForAccount(accountId, ORIGIN).track).toBeNull();
    expect(values.has(playbackKey(accountId))).toBe(false);
  });

  it("flushes an exact current position fail-soft while retaining the 5s throttle", () => {
    const accountId = "user_position_flush";
    const values = new Map<string, string>();
    const snapshot: PlaybackSnapshot = {
      track: {
        id: VERSION_ID,
        audioUrl: `/api/audio/stream/${VERSION_ID}`,
        title: "Exact mix",
        subtitle: "Artist",
        durationMs: 20_000,
        cachePolicy: "account-unlocked",
      },
      playing: true,
      currentMs: 5_000,
      audioDurationSec: 20,
      volume: 1,
      queue: [],
      loop: "off",
      shuffle: false,
      shuffleOrder: [],
    };
    vi.stubGlobal("localStorage", {
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });

    expect(persistPlaybackSnapshotForAccount(accountId, snapshot, ORIGIN, 5_987)).toBe(true);
    expect(JSON.parse(values.get(playbackKey(accountId)) ?? "{}")).toMatchObject({
      currentMs: 5_987,
      track: { id: VERSION_ID },
    });
    expect(SOURCE).toContain('window.addEventListener("pagehide", flushCurrentPosition)');
    expect(SOURCE).toContain('document.visibilityState === "hidden"');
    expect(SOURCE).toContain("Date.now() - persistAtRef.current >= 5_000");

    vi.stubGlobal("localStorage", {
      setItem: () => {
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      },
      removeItem: () => {
        throw new DOMException("Storage blocked", "SecurityError");
      },
    });
    expect(() =>
      persistPlaybackSnapshotForAccount(accountId, snapshot, ORIGIN, 5_999),
    ).not.toThrow();
    expect(persistPlaybackSnapshotForAccount(accountId, snapshot, ORIGIN, 5_999)).toBe(false);
  });

  it("persists and restores only the exact non-secret track allowlist", () => {
    const accountId = "user_track_allowlist";
    const values = new Map<string, string>();
    const forgedTrack = {
      id: VERSION_ID,
      songId: "song-1",
      audioUrl: `/api/audio/stream/${VERSION_ID}`,
      title: "Private mix",
      subtitle: "Artist",
      durationMs: 20_000,
      cachePolicy: "account-unlocked",
      capabilityUrl: "/api/public/song?token=secret",
      signedDownloadUrl: "https://r2.example/audio?X-Amz-Signature=secret",
      storageKey: "private/audio/key",
      artwork: [{ src: "/cover.jpg?token=secret" }],
    } as unknown as PlayerTrack;
    const snapshot: PlaybackSnapshot = {
      track: forgedTrack,
      playing: true,
      currentMs: 2_000,
      audioDurationSec: 20,
      volume: 1,
      queue: [],
      loop: "off",
      shuffle: false,
      shuffleOrder: [],
    };
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });

    expect(persistPlaybackSnapshotForAccount(accountId, snapshot, ORIGIN)).toBe(true);
    const raw = values.get(playbackKey(accountId)) ?? "";
    const stored = JSON.parse(raw) as { track: Record<string, unknown> };
    expect(Object.keys(stored.track).sort()).toEqual([
      "audioUrl",
      "cachePolicy",
      "durationMs",
      "id",
      "songId",
      "subtitle",
      "title",
    ]);
    expect(raw).not.toContain("capabilityUrl");
    expect(raw).not.toContain("signedDownloadUrl");
    expect(raw).not.toContain("storageKey");
    expect(raw).not.toContain("token=secret");
    expect(raw).not.toContain("X-Amz-Signature");
    expect(raw).not.toContain("artwork");

    values.set(playbackKey(accountId), storedPlayback(forgedTrack, 2_000));
    const restored = restorePlaybackForAccount(accountId, ORIGIN);
    expect(restored.track).toEqual(stored.track);
    const rewritten = values.get(playbackKey(accountId)) ?? "";
    expect(rewritten).not.toContain("capabilityUrl");
    expect(rewritten).not.toContain("signedDownloadUrl");
    expect(rewritten).not.toContain("storageKey");
    expect(rewritten).not.toContain("artwork");
  });

  it("preserves a valid optional Song identity and rejects malformed identity", () => {
    const track = {
      id: VERSION_ID,
      songId: "song-1",
      audioUrl: `/api/audio/stream/${VERSION_ID}`,
      title: "Song identity mix",
      subtitle: "Artist",
      durationMs: 20_000,
      cachePolicy: "account-unlocked" as const,
    };

    expect(normalizePlayerTrack(track)).toEqual(track);
    expect(normalizePlayerTrack({ ...track, songId: "" })).toBeNull();
    expect(normalizePlayerTrack({ ...track, songId: "x".repeat(257) })).toBeNull();
  });

  it("drops malformed or secret-bearing artwork before Media Session can see it", () => {
    expect(() =>
      normalizePlayerTrack({
        id: VERSION_ID,
        audioUrl: `/api/audio/stream/${VERSION_ID}`,
        title: "Artwork mix",
        subtitle: "Artist",
        durationMs: 20_000,
        cachePolicy: "account-unlocked",
        artwork: [
          null,
          "not-an-image",
          {},
          { src: "/cover.jpg?token=secret" },
          { src: "javascript:alert(1)" },
        ],
      }),
    ).not.toThrow();
    expect(
      normalizePlayerTrack({
        id: VERSION_ID,
        audioUrl: `/api/audio/stream/${VERSION_ID}`,
        title: "Artwork mix",
        subtitle: "Artist",
        durationMs: 20_000,
        cachePolicy: "account-unlocked",
        artwork: [{ src: "/cover.jpg?token=secret" }],
      }),
    ).toEqual({
      id: VERSION_ID,
      audioUrl: `/api/audio/stream/${VERSION_ID}`,
      title: "Artwork mix",
      subtitle: "Artist",
      durationMs: 20_000,
      cachePolicy: "account-unlocked",
    });
    expect(SOURCE).toContain("const supplied = sanitizedArtwork(track.artwork) ?? []");
  });
});

describe("playback event reducer", () => {
  const empty: PlaybackSnapshot = {
    track: null,
    playing: false,
    currentMs: 0,
    audioDurationSec: null,
    volume: 1,
    queue: [],
    loop: "off",
    shuffle: false,
    shuffleOrder: [],
  };
  const track: PlayerTrack = {
    id: VERSION_ID,
    audioUrl: `/api/audio/stream/${VERSION_ID}`,
    title: "Event mix",
    subtitle: "Artist",
    durationMs: 20_000,
    cachePolicy: "account-unlocked",
  };

  it("applies set, seek, toggle, and close without mutating prior snapshots", () => {
    const loaded = reducePlaybackSnapshot(empty, { kind: "set", track });
    const sought = reducePlaybackSnapshot(loaded, { kind: "seek", currentMs: 7_500 });
    const paused = reducePlaybackSnapshot(sought, { kind: "toggle" });
    const closed = reducePlaybackSnapshot(paused, { kind: "close" });

    expect(empty.track).toBeNull();
    expect(loaded).toMatchObject({ track, playing: true, currentMs: 0 });
    expect(sought).toMatchObject({ playing: true, currentMs: 7_500 });
    expect(paused).toMatchObject({ playing: false, currentMs: 7_500 });
    expect(closed).toEqual(empty);
  });

  it("clamps negative seeks and never toggles a track without audio", () => {
    const noAudio = reducePlaybackSnapshot(empty, {
      kind: "set",
      track: { ...track, audioUrl: null },
    });
    expect(noAudio.playing).toBe(false);
    expect(reducePlaybackSnapshot(noAudio, { kind: "toggle" })).toBe(noAudio);
    expect(
      reducePlaybackSnapshot({ ...noAudio, currentMs: 100 }, { kind: "seek", currentMs: -500 })
        .currentMs,
    ).toBe(0);
  });

  it("loads a replacement track at an exact position and preserves its pause state", () => {
    const pausedAtPosition = reducePlaybackSnapshot(empty, {
      kind: "set",
      track,
      currentMs: 7_500,
      playing: false,
    });
    const playingAtPosition = reducePlaybackSnapshot(empty, {
      kind: "set",
      track,
      currentMs: 12_500,
      playing: true,
    });

    expect(pausedAtPosition).toMatchObject({
      track,
      playing: false,
      currentMs: 7_500,
      volume: 1,
    });
    expect(playingAtPosition).toMatchObject({
      track,
      playing: true,
      currentMs: 12_500,
      volume: 1,
    });
  });

  it("clamps a structured load to the target duration and never plays missing audio", () => {
    expect(
      reducePlaybackSnapshot(empty, {
        kind: "set",
        track,
        currentMs: 25_000,
        playing: true,
      }).currentMs,
    ).toBe(20_000);
    expect(
      reducePlaybackSnapshot(empty, {
        kind: "set",
        track: { ...track, audioUrl: null },
        currentMs: 5_000,
        playing: true,
      }),
    ).toMatchObject({ playing: false, currentMs: 5_000 });
  });

  it("preserves and clamps volume across track loads and close", () => {
    const quiet = reducePlaybackSnapshot(empty, { kind: "volume", volume: 0.35 });
    const loaded = reducePlaybackSnapshot(quiet, { kind: "set", track });
    const closed = reducePlaybackSnapshot(loaded, { kind: "close" });

    expect(quiet.volume).toBe(0.35);
    expect(loaded.volume).toBe(0.35);
    expect(closed.volume).toBe(0.35);
    expect(reducePlaybackSnapshot(quiet, { kind: "volume", volume: -2 }).volume).toBe(0);
    expect(reducePlaybackSnapshot(quiet, { kind: "volume", volume: 4 }).volume).toBe(1);
    expect(reducePlaybackSnapshot(quiet, { kind: "volume", volume: Number.NaN }).volume).toBe(0.35);
    expect(SOURCE).toContain("audio.volume = snapshot.volume");
  });
});

describe("structured set-event compatibility", () => {
  const track: PlayerTrack = {
    id: VERSION_ID,
    audioUrl: `/api/audio/stream/${VERSION_ID}`,
    title: "Version comparison",
    subtitle: "Artist",
    durationMs: 20_000,
  };

  it("continues accepting the legacy raw PlayerTrack detail", () => {
    expect(playbackSetCommandFromDetail(track)).toEqual({ kind: "set", track });
  });

  it("accepts a structured load with exact time and playing state", () => {
    expect(
      playbackSetCommandFromDetail({
        track,
        currentMs: 8_000,
        playing: false,
      }),
    ).toEqual({
      kind: "set",
      track,
      currentMs: 8_000,
      playing: false,
    });
  });

  it("rejects malformed structured load details", () => {
    expect(
      playbackSetCommandFromDetail({ track, currentMs: Number.NaN, playing: true }),
    ).toBeNull();
    expect(playbackSetCommandFromDetail({ track, currentMs: 1_000, playing: "yes" })).toBeNull();
  });
});

describe("clampSeekMs", () => {
  it("uses fixed millisecond deltas and clamps at both ends", () => {
    expect(clampSeekMs(5_000, -15_000, 201_000)).toBe(0);
    expect(clampSeekMs(60_000, 15_000, 201_000)).toBe(75_000);
    expect(clampSeekMs(195_000, 15_000, 201_000)).toBe(201_000);
  });

  it("keeps a non-negative result when duration is not known", () => {
    expect(clampSeekMs(60_000, 15_000, null)).toBe(75_000);
    expect(clampSeekMs(Number.NaN, Number.NaN, null)).toBe(0);
  });
});
