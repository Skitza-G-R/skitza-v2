import { describe, expect, it } from "vitest";

import { privateVersionStreamPath } from "~/server/domain/audio-delivery/urls";
import { computeStoredAudioIdentityFingerprint } from "~/server/domain/song-management/service";

import {
  selectProducerPortfolioSongChoice,
  type ProducerPortfolioTrackCandidate,
} from "../authenticated-read";
import type { PublicStoredVersionCandidate } from "../read-model";

const TRACK: ProducerPortfolioTrackCandidate = {
  trackId: "track-1",
  purchaseId: "purchase-1",
  producerId: "producer-1",
  title: "Glass Houses",
  artist: "Maya",
  projectTitle: "Night Sessions",
  projectArtistName: "Maya",
  portfolioPublishedAt: new Date("2026-07-20T10:00:00.000Z"),
};

function version(
  id: string,
  uploadedAt: string,
  overrides: Partial<PublicStoredVersionCandidate> = {},
): PublicStoredVersionCandidate {
  const audioR2Key = `producers/${TRACK.producerId}/tracks/${id}/audio.mp3`;
  const audioObjectEtag = `etag-${id}`;
  const sizeBytes = 42;
  return {
    trackId: TRACK.trackId,
    purchaseId: TRACK.purchaseId,
    producerId: TRACK.producerId,
    id,
    label: id,
    durationMs: 123_000,
    peaks: [0.2, 0.7],
    uploadedAt: new Date(uploadedAt),
    audioUrl: privateVersionStreamPath(id),
    audioR2Key,
    sizeBytes,
    audioObjectEtag,
    audioIdentityFingerprint: computeStoredAudioIdentityFingerprint({
      key: audioR2Key,
      objectEtag: audioObjectEtag,
      sizeBytes,
    }),
    audioDeletedAt: null,
    pendingAudioR2Key: null,
    pendingAudioUploadId: null,
    pendingAudioInitiationDigest: null,
    pendingAudioCompletionToken: null,
    pendingAudioSizeBytes: null,
    pendingAudioStartedAt: null,
    pendingAudioCreateAttemptedAt: null,
    pendingAudioCompleteAttemptedAt: null,
    pendingAudioPartUrlsExpireAt: null,
    pendingAudioCancelRequestedAt: null,
    pendingAudioCleanupEtag: null,
    ...overrides,
  };
}

describe("selectProducerPortfolioSongChoice", () => {
  it("always previews the newest valid stored version", () => {
    const choice = selectProducerPortfolioSongChoice(TRACK, [
      version("older", "2026-07-18T10:00:00.000Z"),
      version("newest", "2026-07-20T10:00:00.000Z"),
    ]);

    expect(choice?.latestVersion).toMatchObject({
      id: "newest",
      audioUrl: "/api/audio/stream/newest",
    });
  });

  it("does not fall back to a deleted newer version", () => {
    const choice = selectProducerPortfolioSongChoice(TRACK, [
      version("older", "2026-07-18T10:00:00.000Z"),
      version("deleted", "2026-07-20T10:00:00.000Z", {
        audioDeletedAt: new Date("2026-07-20T11:00:00.000Z"),
      }),
    ]);

    expect(choice?.latestVersion.id).toBe("older");
  });

  it("removes the song when no valid stored audio remains", () => {
    expect(
      selectProducerPortfolioSongChoice(TRACK, [
        version("deleted", "2026-07-20T10:00:00.000Z", {
          audioDeletedAt: new Date("2026-07-20T11:00:00.000Z"),
        }),
      ]),
    ).toBeNull();
  });

  it("rejects foreign-scope audio instead of exposing it", () => {
    expect(
      selectProducerPortfolioSongChoice(TRACK, [
        version("foreign", "2026-07-20T10:00:00.000Z", {
          producerId: "producer-2",
        }),
      ]),
    ).toBeNull();
  });
});
