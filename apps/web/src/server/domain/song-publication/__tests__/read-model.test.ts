import { describe, expect, it } from "vitest";

import { privateVersionStreamPath } from "~/server/domain/audio-delivery/urls";
import { computeStoredAudioIdentityFingerprint } from "~/server/domain/song-management/service";

import type { PublicStoredVersionCandidate } from "../read-model";
import { selectPublicStoredVersions } from "../read-model";

const scope = {
  trackId: "11111111-1111-4111-8111-111111111111",
  producerId: "22222222-2222-4222-8222-222222222222",
  purchaseId: "33333333-3333-4333-8333-333333333333",
} as const;

function storedVersion(
  id: string,
  uploadedAt: Date,
  overrides: Partial<PublicStoredVersionCandidate> = {},
): PublicStoredVersionCandidate {
  const audioR2Key = `producers/${scope.producerId}/tracks/${id}/audio.wav`;
  const audioObjectEtag = `etag-${id}`;
  const sizeBytes = 1_024;
  return {
    ...scope,
    id,
    label: id,
    durationMs: 120_000,
    peaks: [0.1],
    uploadedAt,
    audioUrl: privateVersionStreamPath(id),
    audioR2Key,
    sizeBytes,
    audioObjectEtag,
    audioIdentityFingerprint: computeStoredAudioIdentityFingerprint({
      key: audioR2Key,
      objectEtag: audioObjectEtag,
      sizeBytes,
    }),
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
    audioDeletedAt: null,
    ...overrides,
  };
}

describe("selectPublicStoredVersions", () => {
  it("opens the newest stored version first with a stable id tie-breaker", () => {
    const uploadedAt = new Date("2026-07-20T10:00:00.000Z");
    const rows = selectPublicStoredVersions(
      [
        storedVersion("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", uploadedAt, { label: "Mix A" }),
        storedVersion("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", uploadedAt, {
          label: "Mix B",
          durationMs: 121_000,
          peaks: [0.2],
        }),
        storedVersion(
          "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          new Date("2026-07-19T10:00:00.000Z"),
          { label: "Older", durationMs: 119_000, peaks: [0.3] },
        ),
      ],
      scope,
    );

    expect(rows.map((row) => row.id)).toEqual([
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    ]);
  });

  it("removes deleted, incomplete, pending, and foreign-scope audio", () => {
    const uploadedAt = new Date("2026-07-20T10:00:00.000Z");
    const base = storedVersion("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", uploadedAt, {
      label: "Live",
    });
    const rows = selectPublicStoredVersions(
      [
        base,
        storedVersion("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", uploadedAt, {
          audioDeletedAt: new Date(),
        }),
        storedVersion("cccccccc-cccc-4ccc-8ccc-cccccccccccc", uploadedAt, {
          audioR2Key: null,
        }),
        storedVersion("dddddddd-dddd-4ddd-8ddd-dddddddddddd", uploadedAt, {
          pendingAudioUploadId: "pending",
        }),
        storedVersion("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", uploadedAt, {
          producerId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        }),
        storedVersion("ffffffff-ffff-4fff-8fff-ffffffffffff", uploadedAt, {
          audioUrl: "/api/audio/stream/not-this-version",
        }),
        storedVersion("99999999-9999-4999-8999-999999999999", uploadedAt, {
          audioR2Key: `producers/${scope.producerId}/tracks/foreign-version/audio.wav`,
        }),
      ],
      scope,
    );

    expect(rows.map((row) => row.id)).toEqual([base.id]);
  });
});
