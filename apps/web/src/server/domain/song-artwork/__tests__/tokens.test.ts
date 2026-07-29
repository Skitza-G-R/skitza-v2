import { describe, expect, it } from "vitest";

import {
  createSongArtworkUploadToken,
  songArtworkObjectKeys,
  songArtworkRevisionFingerprint,
  verifyOwnedSongArtworkUploadToken,
  verifySongArtworkUploadToken,
} from "../tokens";

const SECRET = "song-artwork-test-secret-at-least-20";
const NOW = new Date("2026-07-30T12:00:00.000Z");
const producerId = "a0000000-0000-4000-8000-000000000001";
const trackId = "b0000000-0000-4000-8000-000000000002";
const baseRevision = songArtworkRevisionFingerprint(SECRET, null);

function signed() {
  return createSongArtworkUploadToken(
    SECRET,
    {
      baseRevision,
      producerId,
      trackId,
      originalFileName: "cover.png",
      contentType: "image/png",
      sizeBytes: 2048,
    },
    NOW,
  );
}

describe("song artwork upload tokens", () => {
  it("round-trips an exact producer, song, and file identity", () => {
    const created = signed();
    expect(verifySongArtworkUploadToken(SECRET, created.token, NOW)).toEqual(created.payload);
    expect(
      verifyOwnedSongArtworkUploadToken(SECRET, created.token, { producerId, trackId }, NOW),
    ).toEqual(created.payload);
  });

  it("rejects expiry, signature tampering, and cross-song reuse", () => {
    const created = signed();
    expect(() =>
      verifySongArtworkUploadToken(SECRET, created.token, new Date(NOW.getTime() + 10 * 60 * 1000)),
    ).toThrow();
    expect(() =>
      verifySongArtworkUploadToken(SECRET, `${created.token.slice(0, -1)}x`, NOW),
    ).toThrow();
    expect(() =>
      verifyOwnedSongArtworkUploadToken(
        SECRET,
        created.token,
        {
          producerId,
          trackId: "30000000-0000-4000-8000-000000000003",
        },
        NOW,
      ),
    ).toThrow();
  });

  it("uses one staging key per song and a unique immutable final key", () => {
    const first = signed().payload;
    const second = signed().payload;
    const firstKeys = songArtworkObjectKeys(SECRET, first);
    const secondKeys = songArtworkObjectKeys(SECRET, second);
    expect(firstKeys.stagingKey).toBe(secondKeys.stagingKey);
    expect(firstKeys.finalKey).not.toBe(secondKeys.finalKey);
    expect(firstKeys.stagingKey).not.toContain(trackId);
    expect(firstKeys.finalKey).not.toContain(first.uploadId);
  });

  it("canonicalizes UUID casing before token and object-key derivation", () => {
    const created = createSongArtworkUploadToken(
      SECRET,
      {
        baseRevision,
        producerId: producerId.toUpperCase(),
        trackId: trackId.toUpperCase(),
        originalFileName: "cover.png",
        contentType: "image/png",
        sizeBytes: 2048,
      },
      NOW,
    );

    expect(created.payload.producerId).toBe(producerId);
    expect(created.payload.trackId).toBe(trackId);
    expect(
      verifyOwnedSongArtworkUploadToken(
        SECRET,
        created.token,
        {
          producerId: producerId.toUpperCase(),
          trackId: trackId.toUpperCase(),
        },
        NOW,
      ),
    ).toEqual(created.payload);
    expect(
      songArtworkObjectKeys(SECRET, {
        ...created.payload,
        producerId: producerId.toUpperCase(),
        trackId: trackId.toUpperCase(),
      }),
    ).toEqual(songArtworkObjectKeys(SECRET, created.payload));
  });

  it("binds completion to an opaque prepared artwork revision", () => {
    const empty = songArtworkRevisionFingerprint(SECRET, null);
    const current = songArtworkRevisionFingerprint(SECRET, {
      storageKey: "song-artwork/private",
      contentType: "image/png",
      sizeBytes: 2048,
      objectEtag: '"etag"',
    });

    expect(empty).toMatch(/^[a-f0-9]{64}$/);
    expect(current).toMatch(/^[a-f0-9]{64}$/);
    expect(current).not.toBe(empty);
    expect(signed().payload.baseRevision).toBe(empty);
  });
});
