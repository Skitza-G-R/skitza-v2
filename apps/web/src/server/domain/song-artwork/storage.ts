import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import {
  BUCKETS,
  encodeR2CopySource,
  getR2,
  getR2BrowserUpload,
  hasValidProofFileSignature,
} from "~/server/storage/r2";

import {
  assertSongArtworkObjectEtag,
  assertSongArtworkUploadMetadata,
  type SongArtworkContentType,
} from "./policy";
import { songArtworkObjectKeys, type SongArtworkUploadTokenPayload } from "./tokens";

const UPLOAD_URL_TTL_SECONDS = 5 * 60;

export class SongArtworkStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SongArtworkStorageError";
  }
}

const CLOUDFLARE_COPY_DESTINATION_IF_NONE_MATCH = "cf-copy-destination-if-none-match" as const;

/** CopyObject with Cloudflare R2's documented destination-absent condition. */
class DestinationAbsentCopyObjectCommand extends CopyObjectCommand {
  readonly destinationCondition = Object.freeze({
    header: CLOUDFLARE_COPY_DESTINATION_IF_NONE_MATCH,
    value: "*",
  });

  constructor(input: ConstructorParameters<typeof CopyObjectCommand>[0]) {
    super(input);
    this.middlewareStack.add(
      (next) => async (arguments_) => {
        const request = arguments_.request;
        if (typeof request !== "object" || request === null) {
          storageError("The artwork could not be saved");
        }
        const headers: unknown = Reflect.get(request, "headers");
        if (typeof headers !== "object" || headers === null) {
          storageError("The artwork could not be saved");
        }
        Reflect.set(headers, CLOUDFLARE_COPY_DESTINATION_IF_NONE_MATCH, "*");
        return next(arguments_);
      },
      {
        step: "build",
        name: "songArtworkCloudflareDestinationAbsentCondition",
        priority: "low",
      },
    );
  }
}

type SongArtworkObjectMetadata = Readonly<{
  contentType: SongArtworkContentType;
  sizeBytes: number;
  objectEtag: string;
}>;

export type FinalizedSongArtworkObject = SongArtworkObjectMetadata &
  Readonly<{ storageKey: string }>;

export type DeliveredSongArtworkObject = Readonly<{
  body: Uint8Array;
  contentType: SongArtworkContentType;
  sizeBytes: number;
  objectEtag: string;
}>;

function storageError(message: string): never {
  throw new SongArtworkStorageError(message);
}

async function headObject(
  client: S3Client,
  key: string,
  ifMatch?: string,
): Promise<SongArtworkObjectMetadata | null> {
  try {
    const object = await client.send(
      new HeadObjectCommand({
        Bucket: BUCKETS.docs,
        Key: key,
        ...(ifMatch ? { IfMatch: ifMatch } : {}),
      }),
    );
    const contentType = (object.ContentType ?? "").toLowerCase();
    const sizeBytes = object.ContentLength ?? 0;
    const objectEtag = object.ETag ?? "";
    const metadata = { contentType, sizeBytes };
    assertSongArtworkUploadMetadata(metadata);
    return {
      ...metadata,
      objectEtag: assertSongArtworkObjectEtag(objectEtag),
    };
  } catch {
    return null;
  }
}

function assertExpectedObject(
  actual: SongArtworkObjectMetadata | null,
  expected: Readonly<{
    contentType: SongArtworkContentType;
    sizeBytes: number;
    objectEtag: string;
  }>,
): SongArtworkObjectMetadata {
  if (
    !actual ||
    actual.contentType !== expected.contentType ||
    actual.sizeBytes !== expected.sizeBytes ||
    actual.objectEtag !== expected.objectEtag
  ) {
    storageError("The artwork changed while it was being saved. Upload it again");
  }
  return actual;
}

async function assertArtworkFileSignature(
  client: S3Client,
  key: string,
  metadata: SongArtworkObjectMetadata,
): Promise<void> {
  try {
    const sample = await client.send(
      new GetObjectCommand({
        Bucket: BUCKETS.docs,
        Key: key,
        Range: "bytes=0-31",
        IfMatch: metadata.objectEtag,
      }),
    );
    const bytes = await sample.Body?.transformToByteArray();
    if (!bytes || !hasValidProofFileSignature(metadata.contentType, bytes)) {
      storageError("The uploaded file is not a valid JPG, PNG, or WebP image");
    }
  } catch (error) {
    if (error instanceof SongArtworkStorageError) throw error;
    storageError("The artwork changed while it was being checked. Upload it again");
  }
}

async function loadFinalizedObject(
  client: S3Client,
  key: string,
  expected: Readonly<{
    contentType: SongArtworkContentType;
    sizeBytes: number;
  }>,
): Promise<FinalizedSongArtworkObject | null> {
  const existing = await headObject(client, key);
  if (!existing) return null;
  if (existing.contentType !== expected.contentType || existing.sizeBytes !== expected.sizeBytes) {
    storageError("The artwork changed while it was being saved. Upload it again");
  }
  await assertArtworkFileSignature(client, key, existing);
  return { storageKey: key, ...existing };
}

export async function createPrivateSongArtworkUpload(
  serverSecret: string,
  payload: SongArtworkUploadTokenPayload,
  client: S3Client = getR2BrowserUpload(),
): Promise<{ uploadUrl: string; expiresInSeconds: number }> {
  const { stagingKey } = songArtworkObjectKeys(serverSecret, payload);
  const uploadUrl = await getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: BUCKETS.docs,
      Key: stagingKey,
      ContentType: payload.contentType,
      ContentLength: payload.sizeBytes,
    }),
    {
      expiresIn: UPLOAD_URL_TTL_SECONDS,
      signableHeaders: new Set(["content-type"]),
    },
  );
  return { uploadUrl, expiresInSeconds: UPLOAD_URL_TTL_SECONDS };
}

export async function finalizePrivateSongArtworkUpload(
  serverSecret: string,
  payload: SongArtworkUploadTokenPayload,
  stagingObjectEtag: string,
  client: S3Client = getR2(),
): Promise<FinalizedSongArtworkObject> {
  const objectEtag = assertSongArtworkObjectEtag(stagingObjectEtag);
  const { stagingKey, finalKey } = songArtworkObjectKeys(serverSecret, payload);
  const expected = {
    contentType: payload.contentType,
    sizeBytes: payload.sizeBytes,
    objectEtag,
  };

  const existingFinal = await loadFinalizedObject(client, finalKey, expected);
  if (existingFinal) {
    return existingFinal;
  }

  const staged = assertExpectedObject(await headObject(client, stagingKey, objectEtag), expected);
  await assertArtworkFileSignature(client, stagingKey, staged);

  let copiedEtag: string;
  try {
    const copied = await client.send(
      new DestinationAbsentCopyObjectCommand({
        Bucket: BUCKETS.docs,
        Key: finalKey,
        CopySource: `/${encodeR2CopySource(BUCKETS.docs, stagingKey)}`,
        CopySourceIfMatch: objectEtag,
        MetadataDirective: "COPY",
      }),
    );
    copiedEtag = assertSongArtworkObjectEtag(copied.CopyObjectResult?.ETag ?? "");
  } catch {
    const racedFinal = await loadFinalizedObject(client, finalKey, expected);
    if (racedFinal) {
      return racedFinal;
    }
    storageError("The artwork changed while it was being saved. Upload it again");
  }

  const finalized = assertExpectedObject(await headObject(client, finalKey, copiedEtag), {
    contentType: payload.contentType,
    sizeBytes: payload.sizeBytes,
    objectEtag: copiedEtag,
  });
  await assertArtworkFileSignature(client, finalKey, finalized);
  // Staging is one deterministic object per song. Do not delete it here:
  // another signed upload may have replaced it while this copy completed.
  return { storageKey: finalKey, ...finalized };
}

export async function deleteSongArtworkObjectQuietly(
  storageKey: string,
  client: S3Client = getR2(),
): Promise<void> {
  try {
    await client.send(new DeleteObjectCommand({ Bucket: BUCKETS.docs, Key: storageKey }));
  } catch {
    console.error("[song-artwork] private object cleanup failed");
  }
}

export async function readPrivateSongArtworkObject(
  input: Readonly<{
    storageKey: string;
    contentType: string;
    sizeBytes: number;
    objectEtag: string;
  }>,
  client: S3Client = getR2(),
): Promise<DeliveredSongArtworkObject> {
  try {
    const metadata = {
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
    };
    assertSongArtworkUploadMetadata(metadata);
    const objectEtag = assertSongArtworkObjectEtag(input.objectEtag);
    const object = await client.send(
      new GetObjectCommand({
        Bucket: BUCKETS.docs,
        Key: input.storageKey,
        IfMatch: objectEtag,
      }),
    );
    if (
      !object.Body ||
      object.ETag !== objectEtag ||
      object.ContentLength !== metadata.sizeBytes ||
      object.ContentType?.toLowerCase() !== metadata.contentType
    ) {
      storageError("Song artwork was not found");
    }
    const body = await object.Body.transformToByteArray();
    if (body.byteLength !== metadata.sizeBytes) {
      storageError("Song artwork was not found");
    }
    return {
      body,
      contentType: metadata.contentType,
      sizeBytes: metadata.sizeBytes,
      objectEtag,
    };
  } catch (error) {
    if (error instanceof SongArtworkStorageError) throw error;
    storageError("Song artwork was not found");
  }
}
