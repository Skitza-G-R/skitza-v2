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

import { AGREEMENT_PDF_CONTENT_TYPE, agreementPdfFileError } from "~/lib/agreement-pdf";
import { BUCKETS, encodeR2CopySource, getR2, getR2BrowserUpload } from "~/server/storage/r2";

import type { AgreementPdfDocument } from "./contract";
import { agreementPdfObjectKeys, type AgreementPdfUploadTokenPayload } from "./tokens";

const UPLOAD_URL_TTL_SECONDS = 5 * 60;
const CLOUDFLARE_COPY_DESTINATION_IF_NONE_MATCH = "cf-copy-destination-if-none-match" as const;

export class AgreementPdfStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgreementPdfStorageError";
  }
}

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
          throw new AgreementPdfStorageError("The agreement could not be saved.");
        }
        const headers: unknown = Reflect.get(request, "headers");
        if (typeof headers !== "object" || headers === null) {
          throw new AgreementPdfStorageError("The agreement could not be saved.");
        }
        Reflect.set(headers, CLOUDFLARE_COPY_DESTINATION_IF_NONE_MATCH, "*");
        return next(arguments_);
      },
      {
        step: "build",
        name: "agreementPdfCloudflareDestinationAbsentCondition",
        priority: "low",
      },
    );
  }
}

type ObjectMetadata = Readonly<{
  contentType: typeof AGREEMENT_PDF_CONTENT_TYPE;
  sizeBytes: number;
  objectEtag: string;
}>;

function assertExpectedMetadata(
  value: Readonly<{
    contentType: string | undefined;
    sizeBytes: number | undefined;
    objectEtag: string | undefined;
  }>,
  expected: Readonly<{ sizeBytes: number }>,
): ObjectMetadata {
  const contentType = (value.contentType ?? "").toLowerCase();
  const sizeBytes = value.sizeBytes ?? 0;
  const objectEtag = value.objectEtag ?? "";
  if (
    agreementPdfFileError({
      originalFileName: "agreement.pdf",
      contentType,
      sizeBytes,
    }) !== null ||
    contentType !== AGREEMENT_PDF_CONTENT_TYPE ||
    sizeBytes !== expected.sizeBytes ||
    objectEtag.length === 0 ||
    objectEtag.length > 200
  ) {
    throw new AgreementPdfStorageError(
      "The agreement changed while it was being submitted. Upload it again.",
    );
  }
  return { contentType: AGREEMENT_PDF_CONTENT_TYPE, sizeBytes, objectEtag };
}

async function headObject(client: S3Client, key: string): Promise<ObjectMetadata | null> {
  try {
    const object = await client.send(new HeadObjectCommand({ Bucket: BUCKETS.docs, Key: key }));
    return assertExpectedMetadata(
      {
        contentType: object.ContentType,
        sizeBytes: object.ContentLength,
        objectEtag: object.ETag,
      },
      { sizeBytes: object.ContentLength ?? 0 },
    );
  } catch {
    return null;
  }
}

async function readVerifiedPdf(
  client: S3Client,
  key: string,
  metadata: ObjectMetadata,
): Promise<{ bytes: Uint8Array; sha256: string }> {
  try {
    const object = await client.send(
      new GetObjectCommand({
        Bucket: BUCKETS.docs,
        Key: key,
        IfMatch: metadata.objectEtag,
      }),
    );
    const bytes = await object.Body?.transformToByteArray();
    if (
      !bytes ||
      bytes.byteLength !== metadata.sizeBytes ||
      bytes.byteLength < 5 ||
      String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-"
    ) {
      throw new Error("invalid PDF signature");
    }
    return {
      bytes,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  } catch {
    throw new AgreementPdfStorageError(
      "The uploaded file is not a valid PDF or changed while it was checked. Upload it again.",
    );
  }
}

async function loadFinal(
  client: S3Client,
  finalKey: string,
  payload: AgreementPdfUploadTokenPayload,
): Promise<AgreementPdfDocument | null> {
  const metadata = await headObject(client, finalKey);
  if (!metadata) return null;
  const exact = assertExpectedMetadata(metadata, { sizeBytes: payload.sizeBytes });
  const { sha256 } = await readVerifiedPdf(client, finalKey, exact);
  return {
    storageBucket: "docs",
    storageKey: finalKey,
    originalFileName: payload.originalFileName,
    contentType: AGREEMENT_PDF_CONTENT_TYPE,
    sizeBytes: exact.sizeBytes,
    objectEtag: exact.objectEtag,
    sha256,
  };
}

export async function createPrivateAgreementPdfUpload(
  serverSecret: string,
  payload: AgreementPdfUploadTokenPayload,
  client = getR2BrowserUpload(),
): Promise<{ uploadUrl: string; expiresInSeconds: number }> {
  const { stagingKey } = agreementPdfObjectKeys(serverSecret, payload.uploadId);
  const uploadUrl = await getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: BUCKETS.docs,
      Key: stagingKey,
      ContentType: AGREEMENT_PDF_CONTENT_TYPE,
      ContentLength: payload.sizeBytes,
    }),
    { expiresIn: UPLOAD_URL_TTL_SECONDS },
  );
  return { uploadUrl, expiresInSeconds: UPLOAD_URL_TTL_SECONDS };
}

export async function finalizePrivateAgreementPdfUpload(
  serverSecret: string,
  payload: AgreementPdfUploadTokenPayload,
  client = getR2(),
): Promise<AgreementPdfDocument> {
  const { stagingKey, finalKey } = agreementPdfObjectKeys(serverSecret, payload.uploadId);
  const existing = await loadFinal(client, finalKey, payload);
  if (existing) {
    await deletePrivateAgreementPdfStagingQuietly(stagingKey, client);
    return existing;
  }
  const staged = await headObject(client, stagingKey);
  if (!staged) {
    throw new AgreementPdfStorageError("The agreement upload expired. Upload it again.");
  }
  const metadata = assertExpectedMetadata(staged, { sizeBytes: payload.sizeBytes });
  await readVerifiedPdf(client, stagingKey, metadata);

  try {
    const copied = await client.send(
      new DestinationAbsentCopyObjectCommand({
        Bucket: BUCKETS.docs,
        Key: finalKey,
        CopySource: `/${encodeR2CopySource(BUCKETS.docs, stagingKey)}`,
        CopySourceIfMatch: metadata.objectEtag,
        MetadataDirective: "COPY",
      }),
    );
    if (!copied.CopyObjectResult?.ETag) throw new Error("missing final ETag");
  } catch {
    const raced = await loadFinal(client, finalKey, payload);
    if (!raced) {
      throw new AgreementPdfStorageError(
        "The agreement changed while it was being submitted. Upload it again.",
      );
    }
    await deletePrivateAgreementPdfStagingQuietly(stagingKey, client);
    return raced;
  }

  const finalized = await loadFinal(client, finalKey, payload);
  if (!finalized) {
    throw new AgreementPdfStorageError(
      "The agreement could not be verified after upload. Upload it again.",
    );
  }
  await deletePrivateAgreementPdfStagingQuietly(stagingKey, client);
  return finalized;
}

export async function deletePrivateAgreementPdfStaging(
  serverSecret: string,
  payload: AgreementPdfUploadTokenPayload,
  client = getR2(),
): Promise<void> {
  const { stagingKey } = agreementPdfObjectKeys(serverSecret, payload.uploadId);
  await client.send(new DeleteObjectCommand({ Bucket: BUCKETS.docs, Key: stagingKey }));
}

async function deletePrivateAgreementPdfStagingQuietly(
  stagingKey: string,
  client: S3Client,
): Promise<void> {
  try {
    await client.send(new DeleteObjectCommand({ Bucket: BUCKETS.docs, Key: stagingKey }));
  } catch {
    // Best-effort only after an immutable final object is verified.
  }
}

export async function readPrivateAgreementPdf(
  document: Omit<AgreementPdfDocument, "storageBucket"> & Readonly<{ storageBucket: string }>,
  client = getR2(),
): Promise<Uint8Array> {
  if (document.storageBucket !== "docs") {
    throw new AgreementPdfStorageError("Private agreement metadata is invalid.");
  }
  const metadata = assertExpectedMetadata(
    await headObject(client, document.storageKey).then((value) => {
      if (!value) throw new AgreementPdfStorageError("Private agreement was not found.");
      return value;
    }),
    { sizeBytes: document.sizeBytes },
  );
  if (metadata.objectEtag !== document.objectEtag) {
    throw new AgreementPdfStorageError("Private agreement integrity check failed.");
  }
  const loaded = await readVerifiedPdf(client, document.storageKey, metadata);
  if (loaded.sha256 !== document.sha256) {
    throw new AgreementPdfStorageError("Private agreement integrity check failed.");
  }
  return loaded.bytes;
}
