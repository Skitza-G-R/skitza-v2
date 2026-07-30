export const SONG_ARTWORK_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type SongArtworkContentType = (typeof SONG_ARTWORK_CONTENT_TYPES)[number];

export const MAX_SONG_ARTWORK_BYTES = 5 * 1024 * 1024;
export const MAX_SONG_ARTWORK_FILE_NAME_LENGTH = 200;

export class SongArtworkPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SongArtworkPolicyError";
  }
}

export function normalizeSongArtworkFileName(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > MAX_SONG_ARTWORK_FILE_NAME_LENGTH) {
    throw new SongArtworkPolicyError(
      `File name must be between 1 and ${String(MAX_SONG_ARTWORK_FILE_NAME_LENGTH)} characters`,
    );
  }
  const containsControlCharacter = Array.from(normalized).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
  if (normalized.includes("/") || normalized.includes("\\") || containsControlCharacter) {
    throw new SongArtworkPolicyError("File name contains unsupported characters");
  }
  return normalized;
}

export function assertSongArtworkUploadMetadata(input: {
  contentType: string;
  sizeBytes: number;
}): asserts input is {
  contentType: SongArtworkContentType;
  sizeBytes: number;
} {
  if (!SONG_ARTWORK_CONTENT_TYPES.includes(input.contentType as SongArtworkContentType)) {
    throw new SongArtworkPolicyError("Choose a JPG, PNG, or WebP image");
  }
  if (
    !Number.isSafeInteger(input.sizeBytes) ||
    input.sizeBytes <= 0 ||
    input.sizeBytes > MAX_SONG_ARTWORK_BYTES
  ) {
    throw new SongArtworkPolicyError("Artwork must be between 1 byte and 5 MB");
  }
}

export function assertSongArtworkObjectEtag(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 512 || /[\r\n]/.test(normalized)) {
    throw new SongArtworkPolicyError("The artwork upload could not be verified");
  }
  return normalized;
}
