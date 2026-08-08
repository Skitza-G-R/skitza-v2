import { createHash } from "node:crypto";
import {
  AbortMultipartUploadCommand,
  HeadObjectCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  ListPartsCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";

import { BUCKETS, getR2 } from "~/server/storage/r2";

const MAX_LIST_PAGES = 10_000;
const MAX_ABORT_VERIFICATION_ATTEMPTS = 3;
const MAX_TERMINAL_SEAL_ATTEMPTS = 6;
const AUDIO_UPLOAD_COMPLETION_TOKEN_METADATA = "skitza-upload-token";
export const MULTIPART_TERMINAL_SEAL_METADATA = "skitza-multipart-terminal-seal";
export const MULTIPART_TERMINAL_SEAL_CONTENT_TYPE = "application/x-skitza-multipart-terminal-seal";
export const MULTIPART_CREATE_UNCERTAINTY_MS = 15 * 60 * 1000;

export class MultipartStorageRecoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MultipartStorageRecoveryError";
  }
}

/**
 * Authorize conditional cleanup of a completed object by the durable
 * server-created completion token and, once journaled, its authoritative ETag.
 * ContentLength is deliberately not part of cleanup authorization: a malformed
 * or oversized result is exactly the object this recovery path must remove.
 */
export function tokenBoundCompletedObjectCleanupMatches(
  input: Readonly<{
    expectedEtag: string | null;
    expectedCompletionToken: string;
    observedEtag: string | undefined;
    observedCompletionToken: string | undefined;
  }>,
): boolean {
  const expectedEtag = input.expectedEtag?.trim() ?? null;
  const observedEtag = input.observedEtag?.trim();
  return (
    typeof observedEtag === "string" &&
    observedEtag.length > 0 &&
    (expectedEtag === null || (expectedEtag.length > 0 && observedEtag === expectedEtag)) &&
    /^[0-9a-f]{64}$/.test(input.expectedCompletionToken) &&
    input.observedCompletionToken === input.expectedCompletionToken
  );
}

export type MultipartTerminalSealIdentity = Readonly<{
  key: string;
  uploadId: string;
  completionToken: string;
}>;

export type MultipartTerminalSealObservation = Readonly<{
  eTag: string | undefined;
  sizeBytes: number | undefined;
  contentType: string | undefined;
  completionToken: string | undefined;
  sealFingerprint: string | undefined;
}>;

export function multipartTerminalSealFingerprint(input: MultipartTerminalSealIdentity): string {
  const encode = (value: string): string =>
    `${Buffer.byteLength(value, "utf8").toString()}:${value}`;
  return `sha256:${createHash("sha256")
    .update(
      [
        "skitza-multipart-terminal-seal-v1",
        encode(input.key),
        encode(input.uploadId),
        encode(input.completionToken),
      ].join("|"),
      "utf8",
    )
    .digest("hex")}`;
}

export function multipartTerminalSealMatches(
  identity: MultipartTerminalSealIdentity,
  observed: MultipartTerminalSealObservation,
): boolean {
  return (
    typeof observed.eTag === "string" &&
    observed.eTag.trim().length > 0 &&
    observed.sizeBytes === 1 &&
    observed.contentType?.trim().toLowerCase() === MULTIPART_TERMINAL_SEAL_CONTENT_TYPE &&
    observed.completionToken === identity.completionToken &&
    observed.sealFingerprint === multipartTerminalSealFingerprint(identity)
  );
}

export async function observeMultipartTerminalSealObject(
  key: string,
  client: S3Client = getR2(),
): Promise<MultipartTerminalSealObservation | null> {
  if (await exactObjectIsAbsent(key, client)) return null;
  const head = await client.send(new HeadObjectCommand({ Bucket: BUCKETS.audio, Key: key }));
  return {
    eTag: head.ETag,
    sizeBytes: head.ContentLength,
    contentType: head.ContentType,
    completionToken: head.Metadata?.[AUDIO_UPLOAD_COMPLETION_TOKEN_METADATA],
    sealFingerprint: head.Metadata?.[MULTIPART_TERMINAL_SEAL_METADATA],
  };
}

export async function putMultipartTerminalSeal(
  input: MultipartTerminalSealIdentity & Readonly<{ replaceEtag: string | null }>,
  client: S3Client = getR2(),
): Promise<void> {
  await client.send(
    new PutObjectCommand({
      Bucket: BUCKETS.audio,
      Key: input.key,
      ...(input.replaceEtag === null ? { IfNoneMatch: "*" } : { IfMatch: input.replaceEtag }),
      Body: new Uint8Array([0]),
      ContentLength: 1,
      ContentType: MULTIPART_TERMINAL_SEAL_CONTENT_TYPE,
      CacheControl: "no-store",
      Metadata: {
        [AUDIO_UPLOAD_COMPLETION_TOKEN_METADATA]: input.completionToken,
        [MULTIPART_TERMINAL_SEAL_METADATA]: multipartTerminalSealFingerprint(input),
      },
    }),
  );
}

export type MultipartTerminalSealReconciliationIdentity = MultipartTerminalSealIdentity &
  Readonly<{ objectEtag: string | null }>;

export type MultipartTerminalSealReconciliationPort = Readonly<{
  head(key: string): Promise<MultipartTerminalSealObservation | null>;
  publishCleanupEtag(
    input: MultipartTerminalSealReconciliationIdentity & Readonly<{ objectEtag: string }>,
  ): Promise<boolean>;
  putSeal(
    input: MultipartTerminalSealIdentity & Readonly<{ replaceEtag: string | null }>,
  ): Promise<void>;
}>;

/**
 * Converge an absent or exact token-bound completed object to a permanent
 * marker. Conditional writes close both orderings of the late-completion race;
 * success is returned only after HEAD observes the exact marker fingerprint.
 */
export async function reconcileMultipartTerminalSeal(
  input: MultipartTerminalSealReconciliationIdentity,
  port: MultipartTerminalSealReconciliationPort,
): Promise<MultipartTerminalSealReconciliationIdentity | null> {
  let exact = input;
  for (let attempt = 0; attempt < MAX_TERMINAL_SEAL_ATTEMPTS; attempt += 1) {
    const observed = await port.head(input.key);
    if (observed !== null && multipartTerminalSealMatches(input, observed)) return exact;

    if (observed === null) {
      try {
        await port.putSeal({ ...input, replaceEtag: null });
      } catch {
        // A late conditional CompleteMultipart may have won. Re-observe it.
      }
      continue;
    }

    if (
      !tokenBoundCompletedObjectCleanupMatches({
        expectedEtag: exact.objectEtag,
        expectedCompletionToken: input.completionToken,
        observedEtag: observed.eTag,
        observedCompletionToken: observed.completionToken,
      })
    ) {
      return null;
    }
    const objectEtag = observed.eTag?.trim();
    if (!objectEtag) return null;
    if (exact.objectEtag === null) {
      const journaled = { ...exact, objectEtag };
      if (!(await port.publishCleanupEtag(journaled))) return null;
      exact = journaled;
    }
    try {
      await port.putSeal({ ...input, replaceEtag: objectEtag });
    } catch {
      // A conditional conflict or ambiguous response is resolved by HEAD.
    }
  }
  return null;
}

/**
 * Prove that one exact object key is absent by exhausting the strongly
 * consistent bucket listing for that key prefix. Unlike HeadObject, listing
 * preserves bucket/service errors, so a generic 404 can never be mistaken for
 * an absent object.
 */
export async function exactObjectIsAbsent(
  key: string,
  client: S3Client = getR2(),
): Promise<boolean> {
  return exactObjectIsAbsentInBucket(BUCKETS.audio, key, client);
}

export async function exactObjectIsAbsentInBucket(
  bucket: string,
  key: string,
  client: S3Client = getR2(),
): Promise<boolean> {
  const seenCursors = new Set<string>();
  let continuationToken: string | undefined;
  let exactMatches = 0;

  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    const output = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: key,
        MaxKeys: 1000,
        ...(continuationToken === undefined ? {} : { ContinuationToken: continuationToken }),
      }),
    );
    if (typeof output.IsTruncated !== "boolean") {
      throw new MultipartStorageRecoveryError("Object listing was incomplete");
    }
    for (const object of output.Contents ?? []) {
      if (typeof object.Key !== "string" || !object.Key.startsWith(key)) {
        throw new MultipartStorageRecoveryError("Object listing identity was invalid");
      }
      if (object.Key === key) exactMatches += 1;
      if (exactMatches > 1) {
        throw new MultipartStorageRecoveryError("Object listing repeated the exact key");
      }
    }
    if (!output.IsTruncated) {
      if (output.NextContinuationToken !== undefined) {
        throw new MultipartStorageRecoveryError("Object listing cursor was invalid");
      }
      return exactMatches === 0;
    }
    const next = output.NextContinuationToken;
    if (typeof next !== "string" || next.length === 0 || seenCursors.has(next)) {
      throw new MultipartStorageRecoveryError("Object listing cursor was invalid");
    }
    seenCursors.add(next);
    continuationToken = next;
  }

  throw new MultipartStorageRecoveryError("Object listing exceeded its safe page limit");
}

/** Exhaustively discover only server-observed upload ids for one exact key. */
export async function listExactMultipartUploadIds(key: string): Promise<string[]> {
  const uploadIds: string[] = [];
  const seenUploads = new Set<string>();
  const seenCursors = new Set<string>();
  let keyMarker: string | undefined;
  let uploadIdMarker: string | undefined;

  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    const output = await getR2().send(
      new ListMultipartUploadsCommand({
        Bucket: BUCKETS.audio,
        Prefix: key,
        MaxUploads: 1000,
        ...(keyMarker === undefined ? {} : { KeyMarker: keyMarker }),
        ...(uploadIdMarker === undefined ? {} : { UploadIdMarker: uploadIdMarker }),
      }),
    );
    if (typeof output.IsTruncated !== "boolean") {
      throw new MultipartStorageRecoveryError("Multipart listing was incomplete");
    }
    for (const upload of output.Uploads ?? []) {
      if (
        typeof upload.Key !== "string" ||
        !upload.Key.startsWith(key) ||
        typeof upload.UploadId !== "string" ||
        upload.UploadId.length === 0
      ) {
        throw new MultipartStorageRecoveryError("Multipart listing identity was invalid");
      }
      if (upload.Key !== key) continue;
      if (seenUploads.has(upload.UploadId)) {
        throw new MultipartStorageRecoveryError("Multipart listing repeated an upload");
      }
      seenUploads.add(upload.UploadId);
      uploadIds.push(upload.UploadId);
    }
    if (!output.IsTruncated) {
      if (output.NextKeyMarker !== undefined || output.NextUploadIdMarker !== undefined) {
        throw new MultipartStorageRecoveryError("Multipart listing cursor was invalid");
      }
      return uploadIds.sort();
    }
    const nextKey = output.NextKeyMarker;
    const nextUpload = output.NextUploadIdMarker;
    if (!nextKey || !nextUpload) {
      throw new MultipartStorageRecoveryError("Multipart listing cursor was missing");
    }
    const cursor = `${nextKey}\0${nextUpload}`;
    if (seenCursors.has(cursor)) {
      throw new MultipartStorageRecoveryError("Multipart listing cursor repeated");
    }
    seenCursors.add(cursor);
    keyMarker = nextKey;
    uploadIdMarker = nextUpload;
  }

  throw new MultipartStorageRecoveryError("Multipart listing exceeded its safe page limit");
}

/**
 * Abort one exact server-issued upload and prove ListParts no longer knows it.
 * Repeating abort is required because an UploadPart already in flight may
 * finish after the first abort request.
 */
export async function abortMultipartUploadAndVerifyAbsent(
  key: string,
  uploadId: string,
): Promise<boolean> {
  return (await abortMultipartUploadAndObserve(key, uploadId)).absent;
}

export async function abortMultipartUploadAndObserve(
  key: string,
  uploadId: string,
): Promise<Readonly<{ absent: boolean; observedRemoteActivity: boolean }>> {
  let observedRemoteActivity = false;
  for (let attempt = 0; attempt < MAX_ABORT_VERIFICATION_ATTEMPTS; attempt += 1) {
    try {
      await getR2().send(
        new AbortMultipartUploadCommand({
          Bucket: BUCKETS.audio,
          Key: key,
          UploadId: uploadId,
        }),
      );
      observedRemoteActivity = true;
    } catch (error) {
      if (!isNoSuchUpload(error)) throw error;
    }
    if (await multipartUploadIsAbsent(key, uploadId)) {
      return { absent: true, observedRemoteActivity };
    }
    observedRemoteActivity = true;
  }
  return { absent: false, observedRemoteActivity };
}

export function isNoSuchUpload(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { name?: unknown; Code?: unknown; code?: unknown };
  return (
    candidate.name === "NoSuchUpload" ||
    candidate.Code === "NoSuchUpload" ||
    candidate.code === "NoSuchUpload"
  );
}

async function multipartUploadIsAbsent(key: string, uploadId: string): Promise<boolean> {
  const seenCursors = new Set<string>();
  let partNumberMarker: string | undefined;
  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    let output;
    try {
      output = await getR2().send(
        new ListPartsCommand({
          Bucket: BUCKETS.audio,
          Key: key,
          UploadId: uploadId,
          MaxParts: 1000,
          ...(partNumberMarker === undefined ? {} : { PartNumberMarker: partNumberMarker }),
        }),
      );
    } catch (error) {
      if (isNoSuchUpload(error)) return true;
      throw error;
    }
    if (typeof output.IsTruncated !== "boolean") {
      throw new MultipartStorageRecoveryError("Multipart parts listing was incomplete");
    }
    for (const part of output.Parts ?? []) {
      if (
        typeof part.PartNumber !== "number" ||
        !Number.isSafeInteger(part.PartNumber) ||
        part.PartNumber <= 0 ||
        typeof part.ETag !== "string" ||
        part.ETag.length === 0
      ) {
        throw new MultipartStorageRecoveryError("Multipart part identity was invalid");
      }
    }
    if (!output.IsTruncated) {
      if (output.NextPartNumberMarker !== undefined) {
        throw new MultipartStorageRecoveryError("Multipart parts cursor was unexpected");
      }
      // A successful ListParts means the upload still exists, even when its
      // current parts list is empty. The caller must issue another abort.
      return false;
    }
    const next = output.NextPartNumberMarker;
    if (typeof next !== "string" || !/^[1-9][0-9]*$/.test(next) || seenCursors.has(next)) {
      throw new MultipartStorageRecoveryError("Multipart parts cursor was invalid");
    }
    seenCursors.add(next);
    partNumberMarker = next;
  }
  throw new MultipartStorageRecoveryError("Multipart parts exceeded its safe page limit");
}
