import {
  AbortMultipartUploadCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { ApprovedSk102Runtime } from "@skitza/db/sk102-runtime";

import { sk102FixturePng, sk102FixtureWav } from "./assets";
import type { Sk102ObjectIdentity } from "./database";

export type Sk102StoredObject = Readonly<{
  alias: string;
  bucket: "audio" | "docs";
  key: string;
  contentType: "audio/wav" | "image/png";
  asset: "audio" | "proof";
}>;

function clientFor(runtime: ApprovedSk102Runtime): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: runtime.r2Endpoint,
    credentials: runtime.r2Credentials,
    maxAttempts: 1,
  });
}

function bucketFor(runtime: ApprovedSk102Runtime, kind: Sk102StoredObject["bucket"]): string {
  return kind === "audio" ? runtime.audioBucket : runtime.docsBucket;
}

function bodyFor(asset: Sk102StoredObject["asset"]): Uint8Array {
  return asset === "audio" ? sk102FixtureWav() : sk102FixturePng();
}

export async function seedSk102FixtureObjects(
  runtime: ApprovedSk102Runtime,
  plan: readonly Sk102StoredObject[],
): Promise<ReadonlyMap<string, Sk102ObjectIdentity>> {
  const client = clientFor(runtime);
  const identities = new Map<string, Sk102ObjectIdentity>();
  try {
    for (const object of plan) {
      if (identities.has(object.alias)) throw new Error("SK102_FIXTURE_OBJECT_ALIAS_DUPLICATE");
      const body = bodyFor(object.asset);
      const bucket = bucketFor(runtime, object.bucket);
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: object.key,
          Body: body,
          ContentType: object.contentType,
          ContentLength: body.byteLength,
          Metadata: { "skitza-fixture": "sk102" },
        }),
      );
      const observed = await client.send(
        new HeadObjectCommand({ Bucket: bucket, Key: object.key }),
      );
      if (
        typeof observed.ETag !== "string" ||
        observed.ETag.length === 0 ||
        observed.ContentLength !== body.byteLength ||
        observed.Metadata?.["skitza-fixture"] !== "sk102"
      ) {
        throw new Error("SK102_FIXTURE_OBJECT_IDENTITY_INVALID");
      }
      identities.set(object.alias, {
        key: object.key,
        objectEtag: observed.ETag,
        sizeBytes: body.byteLength,
      });
    }
    return identities;
  } finally {
    client.destroy();
  }
}

export async function emptySk102FixtureBucket(
  client: Pick<S3Client, "send">,
  bucket: string,
): Promise<void> {
  await abortMultipartUploads(client, bucket);
  const objectPages: { Key: string }[][] = [];
  const seenContinuationTokens = new Set<string>();
  let continuationToken: string | undefined;
  do {
    const listed = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
      }),
    );
    const keys = (listed.Contents ?? []).flatMap((object) =>
      typeof object.Key === "string" && object.Key.length > 0 ? [{ Key: object.Key }] : [],
    );
    if (keys.length > 0) objectPages.push(keys);
    const nextContinuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    if (
      listed.IsTruncated &&
      (!nextContinuationToken || seenContinuationTokens.has(nextContinuationToken))
    ) {
      throw new Error("SK102_FIXTURE_STORAGE_LIST_INVALID");
    }
    if (nextContinuationToken) seenContinuationTokens.add(nextContinuationToken);
    continuationToken = nextContinuationToken;
  } while (continuationToken);

  for (const keys of objectPages) {
    if (keys.length > 0) {
      const deleted = await client.send(
        new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys, Quiet: true } }),
      );
      if ((deleted.Errors?.length ?? 0) > 0) {
        throw new Error("SK102_FIXTURE_STORAGE_CLEANUP_FAILED");
      }
    }
  }

  const remaining = await client.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }));
  if ((remaining.KeyCount ?? remaining.Contents?.length ?? 0) !== 0) {
    throw new Error("SK102_FIXTURE_STORAGE_CLEANUP_INCOMPLETE");
  }
  // Catch uploads initiated while object deletion was in flight, then prove
  // the dedicated bucket has no hidden multipart state left behind.
  await abortMultipartUploads(client, bucket);
  const remainingUploads = await client.send(
    new ListMultipartUploadsCommand({ Bucket: bucket, MaxUploads: 1 }),
  );
  if ((remainingUploads.Uploads?.length ?? 0) !== 0 || remainingUploads.IsTruncated) {
    throw new Error("SK102_FIXTURE_MULTIPART_CLEANUP_INCOMPLETE");
  }
}

async function abortMultipartUploads(
  client: Pick<S3Client, "send">,
  bucket: string,
): Promise<void> {
  const uploads: { Key: string; UploadId: string }[] = [];
  const seenMarkers = new Set<string>();
  let keyMarker: string | undefined;
  let uploadIdMarker: string | undefined;
  do {
    const listed = await client.send(
      new ListMultipartUploadsCommand({
        Bucket: bucket,
        ...(keyMarker ? { KeyMarker: keyMarker } : {}),
        ...(uploadIdMarker ? { UploadIdMarker: uploadIdMarker } : {}),
      }),
    );
    for (const upload of listed.Uploads ?? []) {
      if (!upload.Key || !upload.UploadId) {
        throw new Error("SK102_FIXTURE_MULTIPART_IDENTITY_INVALID");
      }
      uploads.push({ Key: upload.Key, UploadId: upload.UploadId });
    }
    if (listed.IsTruncated && (!listed.NextKeyMarker || !listed.NextUploadIdMarker)) {
      throw new Error("SK102_FIXTURE_MULTIPART_LIST_INVALID");
    }
    keyMarker = listed.IsTruncated ? listed.NextKeyMarker : undefined;
    uploadIdMarker = listed.IsTruncated ? listed.NextUploadIdMarker : undefined;
    if (keyMarker && uploadIdMarker) {
      const marker = `${keyMarker}\0${uploadIdMarker}`;
      if (seenMarkers.has(marker)) throw new Error("SK102_FIXTURE_MULTIPART_LIST_INVALID");
      seenMarkers.add(marker);
    }
  } while (keyMarker && uploadIdMarker);

  for (const upload of uploads) {
    await client.send(
      new AbortMultipartUploadCommand({
        Bucket: bucket,
        Key: upload.Key,
        UploadId: upload.UploadId,
      }),
    );
  }
}

/**
 * Whole-bucket cleanup is intentional: the runtime gate approves dedicated
 * SK-102 buckets, and real browser uploads create opaque keys unknown to the
 * seed manifest. Shared buckets are rejected before this function is callable.
 */
export async function emptySk102FixtureBuckets(runtime: ApprovedSk102Runtime): Promise<void> {
  const client = clientFor(runtime);
  try {
    for (const bucket of new Set([runtime.audioBucket, runtime.docsBucket])) {
      await emptySk102FixtureBucket(client, bucket);
    }
  } finally {
    client.destroy();
  }
}
