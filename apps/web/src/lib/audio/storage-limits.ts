/** Decimal byte limits used by both upload entry points and their UI. */
export const AUDIO_UPLOAD_MAX_BYTES = 100_000_000;
export const AUDIO_MULTIPART_PART_SIZE_BYTES = 5 * 1024 * 1024;
export const PRODUCER_AUDIO_STORAGE_WARNING_BYTES = 800_000_000;
export const PRODUCER_AUDIO_STORAGE_LIMIT_BYTES = 1_000_000_000;
export const AUDIO_STORAGE_FULL_MESSAGE =
  "This upload would go over your 1 GB beta storage. Delete an old Version or Song, then try again.";

/**
 * Return the one exact byte length that a server-issued multipart part URL may
 * accept. Invalid or out-of-range part numbers receive no capability.
 */
export function expectedAudioMultipartPartSize(
  totalBytes: number,
  partNumber: number,
): number | null {
  if (
    !Number.isSafeInteger(totalBytes) ||
    totalBytes <= 0 ||
    !Number.isSafeInteger(partNumber) ||
    partNumber <= 0
  ) {
    return null;
  }
  const start = (partNumber - 1) * AUDIO_MULTIPART_PART_SIZE_BYTES;
  if (!Number.isSafeInteger(start) || start >= totalBytes) return null;
  return Math.min(AUDIO_MULTIPART_PART_SIZE_BYTES, totalBytes - start);
}
