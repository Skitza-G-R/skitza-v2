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
import { uploadStageFailure } from "~/lib/audio/upload-stage-errors";
import { BUCKETS, encodeR2CopySource, getR2, getR2BrowserUpload } from "~/server/storage/r2";
import { verifyFirstVersionObject } from "./service";

const UPLOAD_URL_TTL_SECONDS = 15 * 60;
const PEAKS_COMPUTE_TIMEOUT_MS = 30_000;
export const FIRST_VERSION_COMPLETION_TOKEN_METADATA = "skitza-upload-token";

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
}> {
  const contentType = input.contentType.trim().toLowerCase();
  const metadataHeader = `x-amz-meta-${FIRST_VERSION_COMPLETION_TOKEN_METADATA}`;
  let uploadUrl: string;
  try {
    uploadUrl = await getSignedUrl(
      client,
      new PutObjectCommand({
        Bucket: BUCKETS.audio,
        Key: input.key,
        ContentType: contentType,
        CacheControl: "no-store",
        Metadata: {
          [FIRST_VERSION_COMPLETION_TOKEN_METADATA]: input.completionToken,
        },
      }),
      {
        expiresIn: UPLOAD_URL_TTL_SECONDS,
        // Browser JavaScript cannot set Content-Length; the networking stack
        // owns it. Completion still verifies the exact stored size. Sign only
        // headers the browser sends, and keep x-amz metadata out of the query
        // so the upload-token header is part of the SigV4 contract.
        signableHeaders: new Set(["content-type", "cache-control"]),
        unhoistableHeaders: new Set([metadataHeader]),
      },
    );
  } catch {
    throw new FirstVersionUploadPresignError();
  }
  return {
    uploadUrl,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
      [metadataHeader]: input.completionToken,
    },
    expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
  };
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
