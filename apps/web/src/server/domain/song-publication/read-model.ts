import { privateVersionStreamPath } from "~/server/domain/audio-delivery/urls";
import { computeStoredAudioIdentityFingerprint } from "~/server/domain/song-management/service";
import { isAudioKeyForTrackVersion } from "~/server/storage/r2";

export type PublicSongScope = Readonly<{
  trackId: string;
  purchaseId: string;
  producerId: string;
}>;

export type PublicStoredVersionCandidate = PublicSongScope &
  Readonly<{
    id: string;
    label: string;
    durationMs: number | null;
    peaks: number[] | null;
    uploadedAt: Date;
    producerMarkedFinalAt?: Date | null;
    audioUrl: string | null;
    audioR2Key: string | null;
    sizeBytes: number | null;
    audioObjectEtag: string | null;
    audioIdentityFingerprint: string | null;
    audioDeletedAt: Date | null;
    pendingAudioR2Key: string | null;
    pendingAudioUploadId: string | null;
    pendingAudioInitiationDigest: string | null;
    pendingAudioCompletionToken: string | null;
    pendingAudioSizeBytes: number | null;
    pendingAudioStartedAt: Date | null;
    pendingAudioCreateAttemptedAt: Date | null;
    pendingAudioCompleteAttemptedAt: Date | null;
    pendingAudioPartUrlsExpireAt: Date | null;
    pendingAudioCancelRequestedAt: Date | null;
    pendingAudioCleanupEtag: string | null;
  }>;

export type PublicStoredVersion = Readonly<{
  id: string;
  label: string;
  durationMs: number | null;
  peaks: number[] | null;
  uploadedAt: Date;
  producerMarkedFinalAt: Date | null;
}>;

function exactScope(candidate: PublicSongScope, expected: PublicSongScope): boolean {
  return (
    candidate.trackId === expected.trackId &&
    candidate.purchaseId === expected.purchaseId &&
    candidate.producerId === expected.producerId
  );
}

/**
 * The single canonical predicate for a version that may appear on, or be
 * delivered through, a public song surface. Keeping this check shared avoids
 * rendering a nominal "stored" version whose stricter audio route would then
 * reject it.
 */
export function isPublicStoredVersionCandidate(
  candidate: PublicStoredVersionCandidate,
  expectedScope: PublicSongScope,
): candidate is PublicStoredVersionCandidate &
  Readonly<{
    audioUrl: string;
    audioR2Key: string;
    sizeBytes: number;
    audioObjectEtag: string;
    audioIdentityFingerprint: string;
  }> {
  return (
    exactScope(candidate, expectedScope) &&
    candidate.audioDeletedAt === null &&
    candidate.audioUrl === privateVersionStreamPath(candidate.id) &&
    candidate.audioR2Key !== null &&
    candidate.sizeBytes !== null &&
    Number.isSafeInteger(candidate.sizeBytes) &&
    candidate.sizeBytes > 0 &&
    candidate.audioObjectEtag !== null &&
    candidate.audioObjectEtag.trim().length > 0 &&
    candidate.audioIdentityFingerprint !== null &&
    /^sha256:[0-9a-f]{64}$/.test(candidate.audioIdentityFingerprint) &&
    isAudioKeyForTrackVersion(candidate.audioR2Key, {
      producerId: candidate.producerId,
      trackVersionId: candidate.id,
    }) &&
    candidate.audioIdentityFingerprint ===
      computeStoredAudioIdentityFingerprint({
        key: candidate.audioR2Key,
        objectEtag: candidate.audioObjectEtag,
        sizeBytes: candidate.sizeBytes,
      }) &&
    candidate.pendingAudioR2Key === null &&
    candidate.pendingAudioUploadId === null &&
    candidate.pendingAudioInitiationDigest === null &&
    candidate.pendingAudioCompletionToken === null &&
    candidate.pendingAudioSizeBytes === null &&
    candidate.pendingAudioStartedAt === null &&
    candidate.pendingAudioCreateAttemptedAt === null &&
    candidate.pendingAudioCompleteAttemptedAt === null &&
    candidate.pendingAudioPartUrlsExpireAt === null &&
    candidate.pendingAudioCancelRequestedAt === null &&
    candidate.pendingAudioCleanupEtag === null
  );
}

/**
 * Produces the only version shape public pages may see. Private storage
 * identity is used solely to reject incomplete or uncertain rows and is never
 * copied into the result.
 */
export function selectPublicStoredVersions(
  candidates: readonly PublicStoredVersionCandidate[],
  expectedScope: PublicSongScope,
): PublicStoredVersion[] {
  return candidates
    .filter((candidate) => isPublicStoredVersionCandidate(candidate, expectedScope))
    .sort((left, right) => {
      const time = right.uploadedAt.getTime() - left.uploadedAt.getTime();
      return time === 0 ? right.id.localeCompare(left.id) : time;
    })
    .map(({ id, label, durationMs, peaks, uploadedAt, producerMarkedFinalAt }) => ({
      id,
      label,
      durationMs,
      peaks,
      uploadedAt,
      producerMarkedFinalAt: producerMarkedFinalAt ?? null,
    }));
}
