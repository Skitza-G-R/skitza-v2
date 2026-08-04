import { createHash } from "node:crypto";

export type FirstVersionProjectLifecycleStatus =
  | "waiting_for_payment"
  | "active"
  | "paused"
  | "completed"
  | "canceled";

export type FirstVersionPurchaseLifecycleStatus = "waiting_for_payment" | "active" | "canceled";

export type FirstVersionUploadDestination = Readonly<{
  producerId: string;
  projectId: string;
  purchaseId: string;
  projectProducerId: string;
  projectLifecycleStatus: FirstVersionProjectLifecycleStatus;
  purchaseProducerId: string;
  purchaseProjectId: string;
  purchaseLifecycleStatus: FirstVersionPurchaseLifecycleStatus;
  includedSongSpaces: number;
  allocatedSongSpaces: number;
}>;

export type FirstVersionUploadErrorCode =
  | "BAD_REQUEST"
  | "NOT_FOUND"
  | "INACTIVE"
  | "MISMATCH"
  | "CONFLICT"
  | "CANCELED"
  | "EXPIRED";

export class FirstVersionUploadError extends Error {
  constructor(
    readonly code: FirstVersionUploadErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "FirstVersionUploadError";
  }
}

export async function presignFirstVersionUploadWithCompensation<T>(input: {
  newlyInserted: boolean;
  presign: () => Promise<T>;
  compensate: () => Promise<void>;
}): Promise<T> {
  try {
    return await input.presign();
  } catch (error) {
    if (input.newlyInserted) {
      try {
        await input.compensate();
      } catch {
        // Preserve the typed presigner failure; cleanup must never expose a raw DB error.
      }
    }
    throw error;
  }
}

export function assertFirstVersionAudioFile(
  input: Readonly<{
    filename: string;
    sizeBytes: number;
    contentType: string;
  }>,
): void {
  if (!input.filename.trim() || input.filename.length > 255) {
    throw new FirstVersionUploadError("BAD_REQUEST", "Choose an audio file to upload");
  }
  if (
    !Number.isSafeInteger(input.sizeBytes) ||
    input.sizeBytes <= 0 ||
    input.sizeBytes > FIRST_VERSION_MAX_AUDIO_BYTES
  ) {
    throw new FirstVersionUploadError("BAD_REQUEST", "File too large. Max 500MB.");
  }
  if (!FIRST_VERSION_ALLOWED_AUDIO_TYPES.has(input.contentType.trim().toLowerCase())) {
    throw new FirstVersionUploadError(
      "BAD_REQUEST",
      "That's not an audio file we recognise. Try WAV, MP3, FLAC, M4A, or AIFF.",
    );
  }
}

export function createFirstVersionRequestDigest(
  input: Readonly<{
    projectId: string;
    title: string;
    artist: string | null;
    label: string;
    description: string | null;
    filename: string;
    sizeBytes: number;
    contentType: string;
    durationMs: number | null;
  }>,
): string {
  const encodePart = (value: string): string =>
    `${Buffer.byteLength(value, "utf8").toString()}:${value}`;
  const canonicalRequest = [
    "skitza-first-version-upload-v1",
    input.projectId,
    input.title,
    input.artist ?? "",
    input.label,
    input.description ?? "",
    input.filename,
    input.sizeBytes.toString(),
    input.contentType.trim().toLowerCase(),
    input.durationMs?.toString() ?? "",
  ]
    .map(encodePart)
    .join("|");
  return `sha256:${createHash("sha256").update(canonicalRequest, "utf8").digest("hex")}`;
}

export function createStoredAudioIdentityFingerprint(
  input: Readonly<{
    key: string;
    objectEtag: string;
    sizeBytes: number;
  }>,
): string {
  const encodePart = (value: string): string =>
    `${Buffer.byteLength(value, "utf8").toString()}:${value}`;
  const canonicalIdentity = [
    "skitza-track-audio-v1",
    encodePart(input.key),
    encodePart(input.objectEtag),
    encodePart(input.sizeBytes.toString()),
  ].join("|");
  return `sha256:${createHash("sha256").update(canonicalIdentity, "utf8").digest("hex")}`;
}

/**
 * A producer starts from a Project and an audio file. The purchase link is an
 * internal commercial binding selected inside that Project; it is never the
 * user's starting point and never creates a Song by itself.
 */
export function assertFirstVersionUploadDestination(
  candidate: FirstVersionUploadDestination | null,
  expected: Readonly<{ producerId: string; projectId: string }>,
): FirstVersionUploadDestination {
  if (
    !candidate ||
    candidate.producerId !== expected.producerId ||
    candidate.projectId !== expected.projectId ||
    candidate.projectProducerId !== expected.producerId ||
    candidate.purchaseProducerId !== expected.producerId ||
    candidate.purchaseProjectId !== expected.projectId
  ) {
    throw new FirstVersionUploadError("NOT_FOUND", "The upload destination was not found");
  }
  if (candidate.projectLifecycleStatus !== "active") {
    throw new FirstVersionUploadError(
      "INACTIVE",
      "Audio can be added only while the Project is active",
    );
  }
  if (candidate.purchaseLifecycleStatus !== "active") {
    throw new FirstVersionUploadError(
      "INACTIVE",
      "This Project needs an active Song purchase before you can upload a new Song",
    );
  }
  if (
    !Number.isSafeInteger(candidate.includedSongSpaces) ||
    candidate.includedSongSpaces < 0 ||
    !Number.isSafeInteger(candidate.allocatedSongSpaces) ||
    candidate.allocatedSongSpaces < 0
  ) {
    throw new FirstVersionUploadError(
      "MISMATCH",
      "The Project's purchased Song capacity is invalid",
    );
  }
  if (candidate.allocatedSongSpaces >= candidate.includedSongSpaces) {
    throw new FirstVersionUploadError(
      "CONFLICT",
      "This Project has no available purchased Song space",
    );
  }
  return candidate;
}

export function verifyFirstVersionObject(
  input: Readonly<{
    expectedSizeBytes: number;
    expectedContentType: string;
    expectedCompletionToken: string;
    observedSizeBytes: number | undefined;
    observedContentType: string | undefined;
    observedCompletionToken: string | undefined;
    observedEtag: string | undefined;
  }>,
): Readonly<{ sizeBytes: number; contentType: string; objectEtag: string }> {
  const observedContentType = input.observedContentType?.trim().toLowerCase();
  const expectedContentType = input.expectedContentType.trim().toLowerCase();
  const objectEtag = input.observedEtag?.trim();
  if (
    !Number.isSafeInteger(input.expectedSizeBytes) ||
    input.expectedSizeBytes <= 0 ||
    input.observedSizeBytes !== input.expectedSizeBytes ||
    !observedContentType ||
    observedContentType !== expectedContentType ||
    input.expectedCompletionToken.length < 32 ||
    input.observedCompletionToken !== input.expectedCompletionToken ||
    !objectEtag
  ) {
    throw new FirstVersionUploadError(
      "MISMATCH",
      "The uploaded audio did not match the server-issued upload",
    );
  }
  return {
    sizeBytes: input.expectedSizeBytes,
    contentType: observedContentType,
    objectEtag,
  };
}

export const FIRST_VERSION_MAX_AUDIO_BYTES = 500 * 1024 * 1024;

const FIRST_VERSION_ALLOWED_AUDIO_TYPES = new Set([
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/mpeg",
  "audio/mp3",
  "audio/flac",
  "audio/x-flac",
  "audio/x-m4a",
  "audio/mp4",
  "audio/aiff",
  "audio/x-aiff",
]);
