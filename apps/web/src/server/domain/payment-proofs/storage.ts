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
  hasValidProofFileSignature,
} from "~/server/storage/r2";

import { assertProofUploadMetadata, type ProofContentType } from "./policy";
import { proofObjectKeys } from "./tokens";

const UPLOAD_URL_TTL_SECONDS = 5 * 60;

export class ProofStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProofStorageError";
  }
}

type ProofObjectMetadata = Readonly<{
  contentType: ProofContentType;
  sizeBytes: number;
  objectEtag: string;
}>;

export type FinalizedProofObject = ProofObjectMetadata &
  Readonly<{
    storageBucket: "docs";
    storageKey: string;
  }>;

/**
 * Neutral storage descriptor. Authentication and ownership stay with the
 * calling capability domain (Artist proof token or Producer import token).
 */
export type PrivateProofUploadDescriptor = Readonly<{
  uploadId: string;
  originalFileName: string;
  contentType: ProofContentType;
  sizeBytes: number;
}>;

export function assertExpectedProofObjectMetadata(
  actual: Readonly<{
    contentType: string | undefined;
    sizeBytes: number | undefined;
    objectEtag: string | undefined;
  }>,
  expected: Readonly<{ contentType: ProofContentType; sizeBytes: number }>,
): ProofObjectMetadata {
  const contentType = (actual.contentType ?? "").toLowerCase();
  const sizeBytes = actual.sizeBytes ?? 0;
  const objectEtag = actual.objectEtag ?? "";
  try {
    assertProofUploadMetadata({ contentType, sizeBytes });
  } catch {
    throw new ProofStorageError("That proof file is not a supported image or PDF");
  }
  if (
    contentType !== expected.contentType ||
    sizeBytes !== expected.sizeBytes ||
    objectEtag.length === 0
  ) {
    throw new ProofStorageError("The proof changed while it was being submitted. Upload it again");
  }
  return {
    contentType,
    sizeBytes,
    objectEtag,
  };
}

async function headObject(client: S3Client, key: string): Promise<ProofObjectMetadata | null> {
  try {
    const object = await client.send(
      new HeadObjectCommand({
        Bucket: BUCKETS.docs,
        Key: key,
      }),
    );
    const contentType = (object.ContentType ?? "").toLowerCase();
    const sizeBytes = object.ContentLength ?? 0;
    const objectEtag = object.ETag ?? "";
    assertProofUploadMetadata({ contentType, sizeBytes });
    if (!objectEtag) return null;
    return { contentType: contentType as ProofContentType, sizeBytes, objectEtag };
  } catch {
    return null;
  }
}

async function assertProofFileSignature(
  client: S3Client,
  key: string,
  metadata: ProofObjectMetadata,
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
      throw new ProofStorageError(
        "The uploaded file contents do not match a supported image or PDF",
      );
    }
  } catch (error) {
    if (error instanceof ProofStorageError) throw error;
    throw new ProofStorageError("The proof changed while it was being checked. Upload it again");
  }
}

async function loadFinalizedProofObject(
  client: S3Client,
  finalKey: string,
  expected: Readonly<{ contentType: ProofContentType; sizeBytes: number }>,
): Promise<FinalizedProofObject | null> {
  const existingFinal = await headObject(client, finalKey);
  if (!existingFinal) return null;
  const metadata = assertExpectedProofObjectMetadata(existingFinal, expected);
  await assertProofFileSignature(client, finalKey, metadata);
  return { storageBucket: "docs", storageKey: finalKey, ...metadata };
}

export async function createPrivateProofUpload(
  serverSecret: string,
  payload: PrivateProofUploadDescriptor,
  client = getR2(),
): Promise<{ uploadUrl: string; expiresInSeconds: number }> {
  const { stagingKey } = proofObjectKeys(serverSecret, payload.uploadId);
  const uploadUrl = await getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: BUCKETS.docs,
      Key: stagingKey,
      ContentType: payload.contentType,
      ContentLength: payload.sizeBytes,
    }),
    { expiresIn: UPLOAD_URL_TTL_SECONDS },
  );
  return { uploadUrl, expiresInSeconds: UPLOAD_URL_TTL_SECONDS };
}

export async function finalizePrivateProofUpload(
  serverSecret: string,
  payload: PrivateProofUploadDescriptor,
  client = getR2(),
): Promise<FinalizedProofObject> {
  const { stagingKey, finalKey } = proofObjectKeys(serverSecret, payload.uploadId);
  const expected = { contentType: payload.contentType, sizeBytes: payload.sizeBytes };

  // The permanent key is write-once. A retried upload URL may recreate the
  // staging object, but it must never replace evidence already finalized for
  // this signed upload token.
  const existingFinal = await loadFinalizedProofObject(client, finalKey, expected);
  if (existingFinal) {
    await deletePrivateProofObjectQuietly(stagingKey, client);
    return existingFinal;
  }

  const staged = await headObject(client, stagingKey);

  if (!staged) {
    throw new ProofStorageError("The proof upload could not be found. Upload it again");
  }

  const metadata = assertExpectedProofObjectMetadata(staged, expected);
  await assertProofFileSignature(client, stagingKey, metadata);

  let copyEtag: string;
  try {
    const copied = await client.send(
      new CopyObjectCommand({
        Bucket: BUCKETS.docs,
        Key: finalKey,
        CopySource: encodeR2CopySource(BUCKETS.docs, stagingKey),
        CopySourceIfMatch: metadata.objectEtag,
        IfNoneMatch: "*",
        MetadataDirective: "COPY",
      }),
    );
    copyEtag = copied.CopyObjectResult?.ETag ?? "";
    if (!copyEtag) throw new Error("copy did not return an ETag");
  } catch {
    // Two submit retries can reach the conditional copy together. The winner's
    // immutable object is the only valid recovery; never delete or overwrite it.
    const racedFinal = await loadFinalizedProofObject(client, finalKey, expected);
    if (racedFinal) {
      await deletePrivateProofObjectQuietly(stagingKey, client);
      return racedFinal;
    }
    throw new ProofStorageError("The proof changed while it was being submitted. Upload it again");
  }

  try {
    const finalized = await client.send(
      new HeadObjectCommand({
        Bucket: BUCKETS.docs,
        Key: finalKey,
        IfMatch: copyEtag,
      }),
    );
    const finalMetadata = assertExpectedProofObjectMetadata(
      {
        contentType: finalized.ContentType,
        sizeBytes: finalized.ContentLength,
        objectEtag: finalized.ETag,
      },
      expected,
    );
    if (finalMetadata.objectEtag !== copyEtag) throw new Error("final ETag mismatch");
    await deletePrivateProofObjectQuietly(stagingKey, client);
    return { storageBucket: "docs", storageKey: finalKey, ...finalMetadata };
  } catch {
    // A copied final may already be observed by a concurrent submit. Preserve
    // it on ambiguous read failures; the database boundary decides ownership.
    throw new ProofStorageError("The proof changed while it was being submitted. Upload it again");
  }
}

export async function deletePrivateProofStagingUpload(
  serverSecret: string,
  payload: PrivateProofUploadDescriptor,
  client = getR2(),
): Promise<void> {
  const { stagingKey } = proofObjectKeys(serverSecret, payload.uploadId);
  try {
    await client.send(new DeleteObjectCommand({ Bucket: BUCKETS.docs, Key: stagingKey }));
  } catch {
    throw new Error("Private proof staging cleanup failed");
  }
}

export async function deletePrivateProofObjectQuietly(
  storageKey: string,
  client = getR2(),
): Promise<void> {
  try {
    await client.send(new DeleteObjectCommand({ Bucket: BUCKETS.docs, Key: storageKey }));
  } catch {
    console.error("[proof-storage] private object cleanup failed");
  }
}

export async function readPrivateProofObject(
  input: Readonly<{
    storageKey: string;
    objectEtag: string;
    contentType: string;
    sizeBytes: number;
  }>,
  client = getR2(),
): Promise<Uint8Array> {
  const contentType = input.contentType.toLowerCase();
  try {
    assertProofUploadMetadata({ contentType, sizeBytes: input.sizeBytes });
  } catch {
    throw new ProofStorageError("Private payment evidence is unavailable");
  }
  try {
    const object = await client.send(
      new GetObjectCommand({
        Bucket: BUCKETS.docs,
        Key: input.storageKey,
        IfMatch: input.objectEtag,
      }),
    );
    const bytes = await object.Body?.transformToByteArray();
    if (!bytes || bytes.byteLength !== input.sizeBytes) {
      throw new Error("private proof size mismatch");
    }
    return bytes;
  } catch {
    throw new ProofStorageError("Private payment evidence is unavailable");
  }
}
