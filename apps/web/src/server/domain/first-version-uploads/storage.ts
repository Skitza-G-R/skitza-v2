import { createHash } from "node:crypto";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { computePeaksFromBytes } from "~/server/audio/peaks";
import { exactObjectIsAbsent } from "~/server/audio/multipart-storage-recovery";
import { uploadStageFailure } from "~/lib/audio/upload-stage-errors";
import { BUCKETS, encodeR2CopySource, getR2, getR2BrowserUpload } from "~/server/storage/r2";
import { verifyFirstVersionObject } from "./service";

const UPLOAD_URL_TTL_SECONDS = 15 * 60;
const PEAKS_COMPUTE_TIMEOUT_MS = 30_000;
export const FIRST_VERSION_COMPLETION_TOKEN_METADATA = "skitza-upload-token";
const FIRST_VERSION_STAGING_SEAL_METADATA = "skitza-staging-seal";
const FIRST_VERSION_STAGING_SEAL_SOURCE_METADATA = "skitza-staging-seal-source";
const FIRST_VERSION_STAGING_SEAL_CONTENT_TYPE =
  "application/x-skitza-sealed-first-version-staging-marker";
const FIRST_VERSION_STAGING_SEAL_ATTEMPTS = 4;

export class FirstVersionUploadPresignError extends Error {
  constructor() {
    super(uploadStageFailure("presign"));
    this.name = "FirstVersionUploadPresignError";
  }
}

export type FirstVersionStoredObject = Readonly<{
  sizeBytes: number;
  contentType: string;
  objectEtag: string;
}>;

export function buildFirstVersionStagingKey(
  input: Readonly<{
    producerId: string;
    intentId: string;
  }>,
): string {
  return `first-version-staging/producers/${input.producerId}/intents/${input.intentId}/upload`;
}

type FirstVersionObjectExpectation = Readonly<{
  key: string;
  sizeBytes: number;
  contentType: string;
  completionToken: string;
}>;

export type FirstVersionStagingDeletionIdentity = FirstVersionObjectExpectation;

type FirstVersionSealObservation =
  | Readonly<{ kind: "absent" }>
  | Readonly<{ kind: "present"; objectEtag: string }>
  | Readonly<{ kind: "marker"; sealFingerprint: string }>;

function stagingSealSourceIdentity(objectEtag: string | null): string {
  if (objectEtag === null) return "absent";
  return `sha256:${createHash("sha256").update(objectEtag, "utf8").digest("hex")}`;
}

function stagingSealFingerprint(
  input: FirstVersionObjectExpectation,
  sourceIdentity: string,
): string {
  return `sha256:${createHash("sha256")
    .update(
      JSON.stringify({
        key: input.key,
        sizeBytes: input.sizeBytes,
        contentType: input.contentType.trim().toLowerCase(),
        completionToken: input.completionToken,
        sourceIdentity,
      }),
      "utf8",
    )
    .digest("hex")}`;
}

async function observeFirstVersionSealObject(
  input: FirstVersionObjectExpectation,
  client: S3Client,
): Promise<FirstVersionSealObservation> {
  let head;
  try {
    head = await client.send(
      new HeadObjectCommand({
        Bucket: BUCKETS.audio,
        Key: input.key,
      }),
    );
  } catch (headError) {
    if (await exactObjectIsAbsent(input.key, client)) return { kind: "absent" };
    throw headError;
  }
  const marker = head.Metadata?.[FIRST_VERSION_STAGING_SEAL_METADATA];
  if (marker !== undefined) {
    const sourceIdentity = head.Metadata?.[FIRST_VERSION_STAGING_SEAL_SOURCE_METADATA];
    const completionToken = head.Metadata?.[FIRST_VERSION_COMPLETION_TOKEN_METADATA];
    if (
      !/^sha256:[0-9a-f]{64}$/.test(marker) ||
      (sourceIdentity !== "absent" && !/^sha256:[0-9a-f]{64}$/.test(sourceIdentity ?? "")) ||
      marker !== stagingSealFingerprint(input, sourceIdentity ?? "") ||
      completionToken !== input.completionToken ||
      head.ContentLength !== 1 ||
      head.ContentType?.trim().toLowerCase() !== FIRST_VERSION_STAGING_SEAL_CONTENT_TYPE ||
      typeof head.ETag !== "string" ||
      head.ETag.trim().length === 0
    ) {
      throw new Error("The first-Version staging seal marker was invalid");
    }
    return { kind: "marker", sealFingerprint: marker };
  }
  const completionToken = head.Metadata?.[FIRST_VERSION_COMPLETION_TOKEN_METADATA];
  if (
    completionToken !== input.completionToken ||
    typeof head.ETag !== "string" ||
    head.ETag.trim().length === 0
  ) {
    throw new Error("The first-Version staging object ownership changed before sealing");
  }
  return { kind: "present", objectEtag: head.ETag };
}

function isMissingObject(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return candidate.name === "NotFound" || candidate.$metadata?.httpStatusCode === 404;
}

export async function createFirstVersionUploadUrl(
  input: FirstVersionObjectExpectation,
  client: S3Client = getR2BrowserUpload(),
): Promise<{
  uploadUrl: string;
  headers: Record<string, string>;
  expiresInSeconds: number;
  expiresAt: Date;
}> {
  const contentType = input.contentType.trim().toLowerCase();
  const metadataHeader = `x-amz-meta-${FIRST_VERSION_COMPLETION_TOKEN_METADATA}`;
  let uploadUrl: string;
  let expiresAt: Date;
  try {
    uploadUrl = await getSignedUrl(
      client,
      new PutObjectCommand({
        Bucket: BUCKETS.audio,
        Key: input.key,
        ContentType: contentType,
        CacheControl: "no-store",
        ContentLength: input.sizeBytes,
        IfNoneMatch: "*",
        Metadata: {
          [FIRST_VERSION_COMPLETION_TOKEN_METADATA]: input.completionToken,
        },
      }),
      {
        expiresIn: UPLOAD_URL_TTL_SECONDS,
        // Fetch owns Content-Length, but a Blob has a deterministic length and
        // the browser sends it. Signing that automatic header lets R2 reject a
        // different byte count before completion. If-None-Match is returned to
        // JavaScript because the browser must send that conditional explicitly.
        signableHeaders: new Set([
          "content-type",
          "cache-control",
          "content-length",
          "if-none-match",
        ]),
        unhoistableHeaders: new Set([metadataHeader]),
      },
    );
    expiresAt = presignedUrlExpiry(uploadUrl);
  } catch {
    throw new FirstVersionUploadPresignError();
  }
  return {
    uploadUrl,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
      "If-None-Match": "*",
      [metadataHeader]: input.completionToken,
    },
    expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
    expiresAt,
  };
}

function presignedUrlExpiry(uploadUrl: string): Date {
  const query = new URL(uploadUrl).searchParams;
  const signedAt = query.get("X-Amz-Date");
  const expiresText = query.get("X-Amz-Expires");
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(signedAt ?? "");
  const expiresSeconds = Number(expiresText);
  if (!match || !Number.isInteger(expiresSeconds) || expiresSeconds <= 0) {
    throw new Error("The upload capability expiry was invalid");
  }
  const signedAtMs = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  );
  const expiresAt = new Date(signedAtMs + expiresSeconds * 1_000);
  if (!Number.isFinite(expiresAt.getTime())) {
    throw new Error("The upload capability expiry was invalid");
  }
  return expiresAt;
}

export async function observeFirstVersionUpload(
  input: FirstVersionObjectExpectation,
  client: S3Client = getR2(),
): Promise<FirstVersionStoredObject> {
  let head;
  try {
    head = await client.send(
      new HeadObjectCommand({
        Bucket: BUCKETS.audio,
        Key: input.key,
      }),
    );
  } catch (error) {
    if (isMissingObject(error)) {
      throw new Error("The audio upload has not finished yet. Please retry.");
    }
    throw error;
  }
  return verifyFirstVersionObject({
    expectedSizeBytes: input.sizeBytes,
    expectedContentType: input.contentType,
    expectedCompletionToken: input.completionToken,
    observedSizeBytes: head.ContentLength,
    observedContentType: head.ContentType,
    observedCompletionToken: head.Metadata?.[FIRST_VERSION_COMPLETION_TOKEN_METADATA],
    observedEtag: head.ETag,
  });
}

async function observeFirstVersionUploadOrNull(
  input: FirstVersionObjectExpectation,
  client: S3Client,
): Promise<FirstVersionStoredObject | null> {
  try {
    return await observeFirstVersionUpload(input, client);
  } catch (error) {
    if (error instanceof Error && error.message.includes("has not finished")) return null;
    throw error;
  }
}

/**
 * Freeze the browser upload into a separate, random final key. The browser
 * never receives a capability for that key, so replaying its still-live PUT
 * URL cannot mutate audio after the Song becomes durable.
 */
export async function finalizeFirstVersionUpload(
  input: Readonly<{
    stagingKey: string;
    finalKey: string;
    sizeBytes: number;
    contentType: string;
    completionToken: string;
  }>,
  client: S3Client = getR2(),
): Promise<FirstVersionStoredObject> {
  const expectation = {
    sizeBytes: input.sizeBytes,
    contentType: input.contentType,
    completionToken: input.completionToken,
  };
  const existing = await observeFirstVersionUploadOrNull(
    { key: input.finalKey, ...expectation },
    client,
  );
  if (existing) return existing;

  const staged = await observeFirstVersionUpload({ key: input.stagingKey, ...expectation }, client);
  try {
    await client.send(
      new CopyObjectCommand({
        Bucket: BUCKETS.audio,
        Key: input.finalKey,
        CopySource: `/${encodeR2CopySource(BUCKETS.audio, input.stagingKey)}`,
        CopySourceIfMatch: staged.objectEtag,
        MetadataDirective: "COPY",
      }),
    );
  } catch {
    const raced = await observeFirstVersionUploadOrNull(
      { key: input.finalKey, ...expectation },
      client,
    );
    if (raced) return raced;
    throw new Error("The audio changed while it was being finalized. Upload it again.");
  }
  return observeFirstVersionUpload({ key: input.finalKey, ...expectation }, client);
}

export async function computeFirstVersionUploadPeaks(
  key: string,
  client: S3Client = getR2(),
): Promise<number[] | null> {
  const compute = (async (): Promise<number[] | null> => {
    try {
      const object = await client.send(new GetObjectCommand({ Bucket: BUCKETS.audio, Key: key }));
      if (!object.Body) return null;
      return await computePeaksFromBytes(await object.Body.transformToByteArray());
    } catch (error) {
      console.warn(
        "[first-version-upload] waveform extraction failed",
        error instanceof Error ? error.message : String(error),
      );
      return null;
    }
  })();
  const timeout = new Promise<null>((resolve) => {
    setTimeout(() => {
      resolve(null);
    }, PEAKS_COMPUTE_TIMEOUT_MS);
  });
  return Promise.race([compute, timeout]);
}

/**
 * A canceled intent owns a random, producer-scoped key. Verify its exact
 * server token and object identity before deleting it; a missing or changed
 * object is deliberately left untouched.
 */
export async function deleteFirstVersionUploadIfExact(
  input: FirstVersionObjectExpectation,
  client: S3Client = getR2(),
): Promise<boolean> {
  let observed: FirstVersionStoredObject;
  try {
    observed = await observeFirstVersionUpload(input, client);
  } catch {
    return false;
  }
  await client.send(
    new DeleteObjectCommand({
      Bucket: BUCKETS.audio,
      Key: input.key,
      IfMatch: observed.objectEtag,
    }),
  );
  return true;
}

/**
 * Final keys are server-only and cannot be recreated by a browser capability.
 * A canceled/expired intent may nevertheless own one after a completion
 * transaction rolled back, so quota is released only after exact absence.
 */
export async function reconcileFirstVersionFinalDeletion(
  input: FirstVersionObjectExpectation,
  client: S3Client = getR2(),
): Promise<void> {
  if (input.key.startsWith("first-version-staging/")) {
    throw new Error("The first-Version final deletion key was invalid");
  }
  await deleteFirstVersionUploadIfExact(input, client).catch(() => false);
  if (!(await exactObjectIsAbsent(input.key, client))) {
    throw new Error("The first-Version final object could not be erased safely");
  }
}

/**
 * Atomically replace the exact staging upload (or its proven absence) with a
 * permanent, intent-bound marker. The marker is deliberately retained: every
 * browser URL is write-once, so the occupied key permanently rejects stale or
 * in-flight If-None-Match PUTs.
 */
export async function sealFirstVersionStagingUpload(
  input: FirstVersionStagingDeletionIdentity,
  client: S3Client = getR2(),
): Promise<void> {
  if (!input.key.startsWith("first-version-staging/producers/")) {
    throw new Error("The first-Version staging seal key was invalid");
  }
  for (let attempt = 0; attempt < FIRST_VERSION_STAGING_SEAL_ATTEMPTS; attempt += 1) {
    const observation = await observeFirstVersionSealObject(input, client);
    if (observation.kind === "marker") return;
    const sourceIdentity = stagingSealSourceIdentity(
      observation.kind === "present" ? observation.objectEtag : null,
    );
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: BUCKETS.audio,
          Key: input.key,
          ...(observation.kind === "present"
            ? { IfMatch: observation.objectEtag }
            : { IfNoneMatch: "*" }),
          Body: new Uint8Array([0]),
          ContentType: FIRST_VERSION_STAGING_SEAL_CONTENT_TYPE,
          CacheControl: "no-store",
          Metadata: {
            [FIRST_VERSION_COMPLETION_TOKEN_METADATA]: input.completionToken,
            [FIRST_VERSION_STAGING_SEAL_METADATA]: stagingSealFingerprint(input, sourceIdentity),
            [FIRST_VERSION_STAGING_SEAL_SOURCE_METADATA]: sourceIdentity,
          },
        }),
      );
    } catch {
      // A concurrent conditional upload or ambiguous provider response is
      // resolved by observing the exact key again on the next iteration.
    }
  }
  throw new Error("The first-Version staging object could not be sealed safely");
}

/** Song deletion uses the same permanent staging tombstone receipt. */
export async function reconcileFirstVersionStagingDeletion(
  input: FirstVersionStagingDeletionIdentity,
  client: S3Client = getR2(),
): Promise<void> {
  await sealFirstVersionStagingUpload(input, client);
}
