import { createHash } from "node:crypto";

import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  S3Client,
  type GetObjectCommandOutput,
  type HeadObjectCommandOutput,
} from "@aws-sdk/client-s3";

import {
  assertProtectedToken,
  assertSha256Digest,
  canonicalJson,
  compareUtf8Bytes,
  sameDigest,
  sha256Digest,
  type ProtectedToken,
  type Sha256Digest,
} from "./canonical";
import { Sk90ResetSafetyError, stop, type Sk90SafetyErrorCode } from "./errors";
import type {
  ObservedStorageObject,
  QuarantineCopyReceipt,
  RawKeyTokenHook,
  RawStorageEnvelope,
  RawStorageEnvelopeEntry,
  SecondRunStorageSnapshot,
  Sk90R2RehearsalAdapter,
  Sk90R2RehearsalConfig,
  Sk90S3Client,
  StorageBucketRole,
  StorageDeleteProgressReceipt,
  StorageDeleteResult,
  StorageMutationCounters,
  StorageNamespaceDataState,
  StorageNamespaceSnapshot,
  StorageNamespaceStateObservation,
  StorageObjectMetadata,
  StorageRecoveryState,
  StorageRestoreResult,
  StorageSnapshotExpectation,
} from "./storage-port";

const R2_ENDPOINT_PATTERN = /^[0-9a-f]{32}\.r2\.cloudflarestorage\.com$/;
const BUCKET_PATTERN = /^(?!\d{1,3}(?:\.\d{1,3}){3}$)[a-z0-9](?:[a-z0-9.-]{1,61}[a-z0-9])$/;
const NAMESPACE_PATTERN = /^sk90-rehearsal\/[a-z0-9][a-z0-9-]{7,63}$/;
const MAX_LIST_PAGES = 10_000;
const BUCKET_ROLES = ["audio", "docs"] as const;

type ListedObject = Readonly<{
  bucketRole: StorageBucketRole;
  logicalKey: string;
  physicalKey: string;
  etag: string;
  sizeBytes: number;
  lastModified: string;
}>;

type PhysicalObservation = Readonly<{
  etag: string;
  sizeBytes: number;
  contentFingerprint: Sha256Digest;
  metadataFingerprint: Sha256Digest;
}>;

type AuthorizationFreshnessCheck = () => void | Promise<void>;

type MetadataCarrier = Pick<
  HeadObjectCommandOutput | GetObjectCommandOutput,
  | "CacheControl"
  | "ContentDisposition"
  | "ContentEncoding"
  | "ContentLanguage"
  | "ContentType"
  | "Metadata"
>;

function isSafeBucket(value: string): boolean {
  return (
    BUCKET_PATTERN.test(value) &&
    !value.includes("..") &&
    !value.includes(".-") &&
    !value.includes("-.")
  );
}

export function assertSk90R2RehearsalConfig(config: Sk90R2RehearsalConfig): true {
  let endpoint: URL;
  try {
    endpoint = new URL(config.endpoint);
  } catch {
    stop("REHEARSAL_ENV_INVALID");
  }

  if (
    endpoint.protocol !== "https:" ||
    endpoint.username !== "" ||
    endpoint.password !== "" ||
    endpoint.port !== "" ||
    endpoint.pathname !== "/" ||
    endpoint.search !== "" ||
    endpoint.hash !== "" ||
    !R2_ENDPOINT_PATTERN.test(endpoint.hostname) ||
    config.accessKeyId.trim().length < 16 ||
    config.secretAccessKey.trim().length < 32 ||
    !isSafeBucket(config.buckets.audio) ||
    !isSafeBucket(config.buckets.docs) ||
    config.buckets.audio === config.buckets.docs ||
    !NAMESPACE_PATTERN.test(config.namespace)
  ) {
    stop("REHEARSAL_ENV_INVALID");
  }

  return true;
}

/** Construct only from injected SK-90 values; this function never reads ambient environment. */
export function createSk90R2RehearsalClient(config: Sk90R2RehearsalConfig): Sk90S3Client {
  assertSk90R2RehearsalConfig(config);
  return new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    // Conditional requests provide the retry boundary. Do not blindly replay a
    // mutation after an ambiguous transport response.
    maxAttempts: 1,
  });
}

export function fingerprintStorageBytes(bytes: Uint8Array): Sha256Digest {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function normalizeMetadata(metadata: StorageObjectMetadata): StorageObjectMetadata {
  const custom = [...metadata.custom].map(([key, value]) => {
    if (key.length === 0 || typeof value !== "string") stop("STORAGE_OBJECT_DRIFT");
    return [key, value] as const;
  });
  custom.sort((left, right) => compareUtf8Bytes(left[0], right[0]));
  for (let index = 1; index < custom.length; index += 1) {
    if (custom[index - 1]?.[0] === custom[index]?.[0]) stop("STORAGE_OBJECT_DRIFT");
  }

  if (metadata.expiresAt !== null) {
    const expires = new Date(metadata.expiresAt);
    if (!Number.isFinite(expires.getTime()) || expires.toISOString() !== metadata.expiresAt) {
      stop("STORAGE_OBJECT_DRIFT");
    }
  }

  return {
    cacheControl: metadata.cacheControl,
    contentDisposition: metadata.contentDisposition,
    contentEncoding: metadata.contentEncoding,
    contentLanguage: metadata.contentLanguage,
    contentType: metadata.contentType,
    expiresAt: metadata.expiresAt,
    custom,
  };
}

export function fingerprintStorageMetadata(metadata: StorageObjectMetadata): Sha256Digest {
  return sha256Digest(canonicalJson(normalizeMetadata(metadata)));
}

function metadataFromOutput(output: MetadataCarrier): StorageObjectMetadata {
  let expiresAt: string | null = null;
  const expires: unknown = Reflect.get(output, "Expires");
  if (expires !== undefined) {
    if (!(expires instanceof Date) || !Number.isFinite(expires.getTime())) {
      stop("STORAGE_OBJECT_DRIFT");
    }
    expiresAt = expires.toISOString();
  }
  const custom = Object.entries(output.Metadata ?? {}).map(([key, value]) => {
    if (typeof value !== "string") stop("STORAGE_OBJECT_DRIFT");
    return [key, value] as const;
  });
  return normalizeMetadata({
    cacheControl: output.CacheControl ?? null,
    contentDisposition: output.ContentDisposition ?? null,
    contentEncoding: output.ContentEncoding ?? null,
    contentLanguage: output.ContentLanguage ?? null,
    contentType: output.ContentType ?? null,
    expiresAt,
    custom,
  });
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const name: unknown = Reflect.get(error, "name");
  const metadata: unknown = Reflect.get(error, "$metadata");
  const status: unknown =
    typeof metadata === "object" && metadata !== null
      ? Reflect.get(metadata, "httpStatusCode")
      : undefined;
  return status === 404 || name === "NotFound" || name === "NoSuchKey";
}

async function safely<Value>(
  operation: () => Promise<Value>,
  failureCode: Sk90SafetyErrorCode,
): Promise<Value> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof Sk90ResetSafetyError) throw error;
    stop(failureCode);
  }
}

function validateSafeLogicalKey(key: string): void {
  const segments = key.split("/");
  if (
    key.length === 0 ||
    key.startsWith("/") ||
    key.includes("\\") ||
    key.includes("\0") ||
    segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    stop("ARTIFACT_BINDING_MISMATCH");
  }
}

function physicalIdentity(bucketRole: StorageBucketRole, logicalKey: string): string {
  return `${bucketRole}\0${logicalKey}`;
}

function sortedEntries(entries: readonly RawStorageEnvelopeEntry[]): RawStorageEnvelopeEntry[] {
  return [...entries].sort((left, right) =>
    compareUtf8Bytes(
      `${left.bucketRole}:${left.protectedKey}`,
      `${right.bucketRole}:${right.protectedKey}`,
    ),
  );
}

function encodePathSegment(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function encodeCopySource(bucket: string, key: string): string {
  return [bucket, ...key.split("/")].map(encodePathSegment).join("/");
}

function digestHex(digest: Sha256Digest): string {
  assertSha256Digest(digest);
  return digest.slice("sha256:".length);
}

function protectedHex(token: ProtectedToken): string {
  assertProtectedToken(token);
  return token.slice("hmac-sha256:".length);
}

function snapshotFingerprint(objects: readonly ObservedStorageObject[]): Sha256Digest {
  const protectedObjects = objects
    .map((object) => ({
      bucketRole: object.bucketRole,
      protectedKey: object.protectedKey,
      ownership: object.ownership,
      sizeBytes: object.sizeBytes,
      contentFingerprint: object.contentFingerprint,
      metadataFingerprint: object.metadataFingerprint,
    }))
    .sort((left, right) =>
      compareUtf8Bytes(
        `${left.bucketRole}:${left.protectedKey}`,
        `${right.bucketRole}:${right.protectedKey}`,
      ),
    );
  return sha256Digest(canonicalJson(protectedObjects));
}

function deletedObjectsFingerprint(entries: readonly RawStorageEnvelopeEntry[]): Sha256Digest {
  const deleted = sortedEntries(entries).map((entry) => ({
    bucketRole: entry.bucketRole,
    protectedKey: entry.protectedKey,
    contentFingerprint: entry.contentFingerprint,
  }));
  return sha256Digest(canonicalJson(deleted));
}

function sameSnapshotVersion(
  before: StorageNamespaceSnapshot,
  after: StorageNamespaceSnapshot,
): boolean {
  if (before.objects.length !== after.objects.length) return false;
  const normalize = (snapshot: StorageNamespaceSnapshot) =>
    [...snapshot.objects]
      .sort((left, right) => compareUtf8Bytes(left.protectedKey, right.protectedKey))
      .map((object) => ({
        protectedKey: object.protectedKey,
        etag: object.etag,
        lastModified: object.lastModified,
      }));
  return canonicalJson(normalize(before)) === canonicalJson(normalize(after));
}

function assertCounterShape(counters: StorageMutationCounters): void {
  for (const count of Object.values(counters)) {
    if (!Number.isSafeInteger(count) || count < 0) stop("POST_RESET_INTEGRITY_MISMATCH");
  }
}

class R2RehearsalAdapter implements Sk90R2RehearsalAdapter {
  private readonly dataPrefix: string;
  private readonly recoveryPrefix: string;
  private readonly probePrefix: string;
  private copyAttempts = 0;
  private copiesSucceeded = 0;
  private deleteAttempts = 0;
  private deletesSucceeded = 0;

  constructor(
    private readonly client: Sk90S3Client,
    private readonly config: Sk90R2RehearsalConfig,
    private readonly tokenForKey: RawKeyTokenHook,
  ) {
    assertSk90R2RehearsalConfig(config);
    this.dataPrefix = `${config.namespace}/data/`;
    this.recoveryPrefix = `${config.namespace}/recovery/`;
    this.probePrefix = `${config.namespace}/restore-probe/`;
  }

  getMutationCounters(): StorageMutationCounters {
    return {
      copyAttempts: this.copyAttempts,
      copiesSucceeded: this.copiesSucceeded,
      deleteAttempts: this.deleteAttempts,
      deletesSucceeded: this.deletesSucceeded,
    };
  }

  private bucket(bucketRole: StorageBucketRole): string {
    return this.config.buckets[bucketRole];
  }

  private dataKey(logicalKey: string): string {
    validateSafeLogicalKey(logicalKey);
    const key = `${this.dataPrefix}${logicalKey}`;
    if (Buffer.byteLength(key, "utf8") > 1024) stop("ARTIFACT_BINDING_MISMATCH");
    return key;
  }

  private recoveryKey(artifactDigest: Sha256Digest, entry: RawStorageEnvelopeEntry): string {
    return `${this.recoveryPrefix}${digestHex(artifactDigest)}/${entry.bucketRole}/${protectedHex(entry.protectedKey)}`;
  }

  private probeKey(artifactDigest: Sha256Digest, entry: RawStorageEnvelopeEntry): string {
    return `${this.probePrefix}${digestHex(artifactDigest)}/${entry.bucketRole}/${protectedHex(entry.protectedKey)}`;
  }

  private token(input: Parameters<RawKeyTokenHook>[0]): ProtectedToken {
    let token: ProtectedToken;
    try {
      token = this.tokenForKey(input);
    } catch (error) {
      if (error instanceof Sk90ResetSafetyError) throw error;
      stop("ARTIFACT_BINDING_MISMATCH");
    }
    assertProtectedToken(token);
    return token;
  }

  private validateEnvelope(envelope: RawStorageEnvelope): void {
    const rawEntries: unknown = envelope.entries;
    if (!Array.isArray(rawEntries)) stop("ARTIFACT_BINDING_MISMATCH");
    const identities = new Set<string>();
    const protectedKeys = new Set<string>();
    for (const entry of envelope.entries) {
      const bucketRole: unknown = entry.bucketRole;
      const ownership: unknown = entry.ownership;
      if (
        (bucketRole !== "audio" && bucketRole !== "docs") ||
        (ownership !== "reset_exclusive" && ownership !== "preserved_only")
      ) {
        stop("ARTIFACT_BINDING_MISMATCH");
      }
      validateSafeLogicalKey(entry.logicalKey);
      assertProtectedToken(entry.protectedKey);
      assertSha256Digest(entry.contentFingerprint);
      assertSha256Digest(entry.metadataFingerprint);
      if (!Number.isSafeInteger(entry.sizeBytes) || entry.sizeBytes < 0) {
        stop("ARTIFACT_BINDING_MISMATCH");
      }
      const observedToken = this.token({
        scope: "data",
        bucketRole: entry.bucketRole,
        key: entry.logicalKey,
      });
      if (!sameDigest(observedToken, entry.protectedKey)) stop("ARTIFACT_BINDING_MISMATCH");
      const identity = physicalIdentity(entry.bucketRole, entry.logicalKey);
      if (identities.has(identity) || protectedKeys.has(entry.protectedKey)) {
        stop("ARTIFACT_BINDING_MISMATCH");
      }
      identities.add(identity);
      protectedKeys.add(entry.protectedKey);
      this.dataKey(entry.logicalKey);
    }
  }

  private async listRoleObjects(
    bucketRole: StorageBucketRole,
    expectedMaximum: number,
  ): Promise<ListedObject[]> {
    const bucket = this.bucket(bucketRole);
    const seenKeys = new Set<string>();
    const seenTokens = new Set<string>();
    const objects: ListedObject[] = [];
    let continuationToken: string | undefined;

    for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
      const output = await safely(
        () =>
          this.client.send(
            new ListObjectsV2Command({
              Bucket: bucket,
              Prefix: this.dataPrefix,
              MaxKeys: 1000,
              ...(continuationToken === undefined ? {} : { ContinuationToken: continuationToken }),
            }),
          ),
        "STORAGE_OBJECT_DRIFT",
      );
      const contents = output.Contents ?? [];
      if (
        (output.KeyCount !== undefined && output.KeyCount !== contents.length) ||
        (output.CommonPrefixes?.length ?? 0) !== 0 ||
        typeof output.IsTruncated !== "boolean"
      ) {
        stop("STORAGE_OBJECT_DRIFT");
      }

      for (const listed of contents) {
        const key = listed.Key;
        const sizeBytes = listed.Size;
        if (
          typeof key !== "string" ||
          !key.startsWith(this.dataPrefix) ||
          key === this.dataPrefix ||
          typeof listed.ETag !== "string" ||
          listed.ETag.length === 0 ||
          typeof sizeBytes !== "number" ||
          !Number.isSafeInteger(sizeBytes) ||
          sizeBytes < 0 ||
          !(listed.LastModified instanceof Date) ||
          !Number.isFinite(listed.LastModified.getTime())
        ) {
          stop("STORAGE_OBJECT_DRIFT");
        }
        const logicalKey = key.slice(this.dataPrefix.length);
        validateSafeLogicalKey(logicalKey);
        if (seenKeys.has(key)) stop("STORAGE_OBJECT_DRIFT");
        seenKeys.add(key);
        objects.push({
          bucketRole,
          logicalKey,
          physicalKey: key,
          etag: listed.ETag,
          sizeBytes,
          lastModified: listed.LastModified.toISOString(),
        });
        if (objects.length > expectedMaximum) stop("STORAGE_OBJECT_DRIFT");
      }

      if (!output.IsTruncated) {
        if (output.NextContinuationToken !== undefined) stop("STORAGE_OBJECT_DRIFT");
        return objects;
      }
      const next = output.NextContinuationToken;
      if (!next || seenTokens.has(next)) stop("STORAGE_OBJECT_DRIFT");
      seenTokens.add(next);
      continuationToken = next;
    }

    stop("STORAGE_OBJECT_DRIFT");
  }

  private async assertNoMultipartUploads(
    bucketRole: StorageBucketRole,
    prefix = this.dataPrefix,
  ): Promise<void> {
    const bucket = this.bucket(bucketRole);
    const seenTokens = new Set<string>();
    let keyMarker: string | undefined;
    let uploadIdMarker: string | undefined;

    for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
      const output = await safely(
        () =>
          this.client.send(
            new ListMultipartUploadsCommand({
              Bucket: bucket,
              Prefix: prefix,
              MaxUploads: 1000,
              ...(keyMarker === undefined ? {} : { KeyMarker: keyMarker }),
              ...(uploadIdMarker === undefined ? {} : { UploadIdMarker: uploadIdMarker }),
            }),
          ),
        "STORAGE_OBJECT_DRIFT",
      );
      if (typeof output.IsTruncated !== "boolean") stop("STORAGE_OBJECT_DRIFT");
      for (const upload of output.Uploads ?? []) {
        if (
          typeof upload.Key !== "string" ||
          !upload.Key.startsWith(prefix) ||
          typeof upload.UploadId !== "string" ||
          upload.UploadId.length === 0
        ) {
          stop("STORAGE_OBJECT_DRIFT");
        }
        stop("STORAGE_OBJECT_DRIFT");
      }
      if (!output.IsTruncated) {
        if (output.NextKeyMarker !== undefined || output.NextUploadIdMarker !== undefined) {
          stop("STORAGE_OBJECT_DRIFT");
        }
        return;
      }
      const nextKey = output.NextKeyMarker;
      const nextUpload = output.NextUploadIdMarker;
      if (!nextKey || !nextUpload) stop("STORAGE_OBJECT_DRIFT");
      const identity = `${nextKey}\0${nextUpload}`;
      if (seenTokens.has(identity)) stop("STORAGE_OBJECT_DRIFT");
      seenTokens.add(identity);
      keyMarker = nextKey;
      uploadIdMarker = nextUpload;
    }

    stop("STORAGE_OBJECT_DRIFT");
  }

  private async listPhysicalKeys(
    bucketRole: StorageBucketRole,
    prefix: string,
    expectedMaximum: number,
  ): Promise<string[]> {
    const bucket = this.bucket(bucketRole);
    const seenKeys = new Set<string>();
    const seenTokens = new Set<string>();
    const keys: string[] = [];
    let continuationToken: string | undefined;

    for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
      const output = await safely(
        () =>
          this.client.send(
            new ListObjectsV2Command({
              Bucket: bucket,
              Prefix: prefix,
              MaxKeys: 1000,
              ...(continuationToken === undefined ? {} : { ContinuationToken: continuationToken }),
            }),
          ),
        "STORAGE_OBJECT_DRIFT",
      );
      const contents = output.Contents ?? [];
      if (
        (output.KeyCount !== undefined && output.KeyCount !== contents.length) ||
        (output.CommonPrefixes?.length ?? 0) !== 0 ||
        typeof output.IsTruncated !== "boolean"
      ) {
        stop("STORAGE_OBJECT_DRIFT");
      }
      for (const listed of contents) {
        const key = listed.Key;
        if (
          typeof key !== "string" ||
          !key.startsWith(prefix) ||
          typeof listed.ETag !== "string" ||
          listed.ETag.length === 0 ||
          typeof listed.Size !== "number" ||
          !Number.isSafeInteger(listed.Size) ||
          listed.Size < 0 ||
          !(listed.LastModified instanceof Date) ||
          !Number.isFinite(listed.LastModified.getTime()) ||
          seenKeys.has(key)
        ) {
          stop("STORAGE_OBJECT_DRIFT");
        }
        seenKeys.add(key);
        keys.push(key);
        if (keys.length > expectedMaximum) stop("STORAGE_OBJECT_DRIFT");
      }
      if (!output.IsTruncated) {
        if (output.NextContinuationToken !== undefined) stop("STORAGE_OBJECT_DRIFT");
        return keys.sort(compareUtf8Bytes);
      }
      const next = output.NextContinuationToken;
      if (!next || seenTokens.has(next)) stop("STORAGE_OBJECT_DRIFT");
      seenTokens.add(next);
      continuationToken = next;
    }
    stop("STORAGE_OBJECT_DRIFT");
  }

  async assertNamespaceState(
    input: Readonly<{
      artifactDigest: Sha256Digest;
      envelope: RawStorageEnvelope;
      dataState: StorageNamespaceDataState;
      recoveryState: StorageRecoveryState;
    }>,
  ): Promise<StorageNamespaceStateObservation> {
    assertSha256Digest(input.artifactDigest);
    this.validateEnvelope(input.envelope);
    const dataState: unknown = input.dataState;
    const recoveryState: unknown = input.recoveryState;
    if (
      (dataState !== "pre" && dataState !== "post" && dataState !== "approved_subset") ||
      (recoveryState !== "empty" &&
        recoveryState !== "approved_subset" &&
        recoveryState !== "complete")
    ) {
      stop("PHASE_STATE_INVALID");
    }

    const resetEntries = input.envelope.entries.filter(
      (entry) => entry.ownership === "reset_exclusive",
    );
    const expectedData = new Map(
      input.envelope.entries.map((entry) => [
        `${entry.bucketRole}\0${this.dataKey(entry.logicalKey)}`,
        entry,
      ]),
    );
    const expectedRecovery = new Set(
      resetEntries.map(
        (entry) => `${entry.bucketRole}\0${this.recoveryKey(input.artifactDigest, entry)}`,
      ),
    );
    const expectedProbes = new Map(
      resetEntries.map((entry) => [
        `${entry.bucketRole}\0${this.probeKey(input.artifactDigest, entry)}`,
        entry,
      ]),
    );
    const observedData = new Set<string>();
    const observedRecovery = new Set<string>();
    const observedProbes = new Map<string, RawStorageEnvelopeEntry>();
    const rootPrefix = `${this.config.namespace}/`;

    for (const bucketRole of BUCKET_ROLES) {
      await this.assertNoMultipartUploads(bucketRole, rootPrefix);
      const keys = await this.listPhysicalKeys(
        bucketRole,
        rootPrefix,
        input.envelope.entries.length + resetEntries.length * 2,
      );
      for (const key of keys) {
        const identity = `${bucketRole}\0${key}`;
        if (key.startsWith(this.probePrefix)) {
          const expected = expectedProbes.get(identity);
          if (input.recoveryState !== "approved_subset" || !expected) {
            stop("QUARANTINE_PROOF_MISMATCH");
          }
          observedProbes.set(identity, expected);
          continue;
        }
        if (key.startsWith(this.dataPrefix)) {
          if (!expectedData.has(identity)) stop("STORAGE_OBJECT_DRIFT");
          observedData.add(identity);
          continue;
        }
        if (key.startsWith(this.recoveryPrefix)) {
          if (!expectedRecovery.has(identity)) stop("QUARANTINE_PROOF_MISMATCH");
          observedRecovery.add(identity);
          continue;
        }
        stop("STORAGE_OBJECT_DRIFT");
      }
    }

    for (const [identity, entry] of observedProbes) {
      const separator = identity.indexOf("\0");
      const key = identity.slice(separator + 1);
      await this.observePhysical(entry.bucketRole, key, entry, "QUARANTINE_PROOF_MISMATCH");
    }

    const expectedDataForState = [...expectedData.entries()].filter(([, entry]) =>
      input.dataState === "post" ? entry.ownership === "preserved_only" : true,
    );
    if (input.dataState === "pre" || input.dataState === "post") {
      if (
        observedData.size !== expectedDataForState.length ||
        expectedDataForState.some(([identity]) => !observedData.has(identity))
      ) {
        stop("STORAGE_OBJECT_DRIFT");
      }
    } else {
      for (const [identity, entry] of expectedData) {
        if (entry.ownership === "preserved_only" && !observedData.has(identity)) {
          stop("STORAGE_OBJECT_MISSING");
        }
      }
    }

    if (
      (input.recoveryState === "empty" && observedRecovery.size !== 0) ||
      (input.recoveryState === "complete" &&
        (observedRecovery.size !== expectedRecovery.size ||
          [...expectedRecovery].some((identity) => !observedRecovery.has(identity))))
    ) {
      stop("QUARANTINE_PROOF_MISMATCH");
    }
    const preservedCount = input.envelope.entries.filter(
      (entry) => entry.ownership === "preserved_only",
    ).length;
    return {
      dataState:
        observedData.size === input.envelope.entries.length
          ? "pre"
          : observedData.size === preservedCount
            ? "post"
            : "partial",
      recoveryState:
        observedRecovery.size === 0
          ? "empty"
          : observedRecovery.size === expectedRecovery.size
            ? "complete"
            : "approved_subset",
    };
  }

  private async listNamespace(expectedMaximum: number): Promise<ListedObject[]> {
    const listed: ListedObject[] = [];
    for (const bucketRole of BUCKET_ROLES) {
      await this.assertNoMultipartUploads(bucketRole);
      listed.push(...(await this.listRoleObjects(bucketRole, expectedMaximum)));
      if (listed.length > expectedMaximum) stop("STORAGE_OBJECT_DRIFT");
    }
    listed.sort((left, right) =>
      compareUtf8Bytes(
        physicalIdentity(left.bucketRole, left.logicalKey),
        physicalIdentity(right.bucketRole, right.logicalKey),
      ),
    );
    return listed;
  }

  private assertListedMatchesEntries(
    listed: readonly ListedObject[],
    entries: readonly RawStorageEnvelopeEntry[],
  ): void {
    if (listed.length !== entries.length) stop("STORAGE_OBJECT_DRIFT");
    const expected = new Set(
      entries.map((entry) => physicalIdentity(entry.bucketRole, entry.logicalKey)),
    );
    for (const object of listed) {
      const identity = physicalIdentity(object.bucketRole, object.logicalKey);
      if (!expected.delete(identity)) stop("STORAGE_OBJECT_DRIFT");
    }
    if (expected.size !== 0) stop("STORAGE_OBJECT_MISSING");
  }

  private async hashBody(
    body: unknown,
  ): Promise<Readonly<{ bytes: number; digest: Sha256Digest }>> {
    const hash = createHash("sha256");
    let bytes = 0;
    const consume = (chunk: Uint8Array): void => {
      bytes += chunk.byteLength;
      if (!Number.isSafeInteger(bytes)) stop("STORAGE_OBJECT_DRIFT");
      hash.update(chunk);
    };

    if (body instanceof Uint8Array) {
      consume(body);
    } else if (
      typeof body === "object" &&
      body !== null &&
      typeof Reflect.get(body, Symbol.asyncIterator) === "function"
    ) {
      const iterable = body as AsyncIterable<unknown>;
      for await (const chunk of iterable) {
        if (!(chunk instanceof Uint8Array)) stop("STORAGE_OBJECT_DRIFT");
        consume(chunk);
      }
    } else {
      stop("STORAGE_OBJECT_MISSING");
    }

    return { bytes, digest: `sha256:${hash.digest("hex")}` };
  }

  private async inspectListed(
    listed: ListedObject,
    expected: RawStorageEnvelopeEntry,
  ): Promise<ObservedStorageObject> {
    const bucket = this.bucket(listed.bucketRole);
    const head = await safely(
      () =>
        this.client.send(
          new HeadObjectCommand({ Bucket: bucket, Key: listed.physicalKey, IfMatch: listed.etag }),
        ),
      "STORAGE_OBJECT_DRIFT",
    );
    if (
      typeof head.ETag !== "string" ||
      head.ETag !== listed.etag ||
      head.ContentLength !== listed.sizeBytes ||
      !(head.LastModified instanceof Date) ||
      !Number.isFinite(head.LastModified.getTime()) ||
      // R2's ListObjects result preserves milliseconds while the HTTP
      // Last-Modified header used by HeadObject has whole-second precision.
      // Keep list-to-list stability exact, but compare these two APIs at their
      // shared precision. ETag, size, full bytes, and metadata remain exact.
      Math.floor(head.LastModified.getTime() / 1000) !==
        Math.floor(Date.parse(listed.lastModified) / 1000)
    ) {
      stop("STORAGE_OBJECT_DRIFT");
    }
    const headMetadata = fingerprintStorageMetadata(metadataFromOutput(head));

    const object = await safely(
      () =>
        this.client.send(
          new GetObjectCommand({ Bucket: bucket, Key: listed.physicalKey, IfMatch: head.ETag }),
        ),
      "STORAGE_OBJECT_DRIFT",
    );
    if (
      object.ETag !== head.ETag ||
      object.ContentLength !== head.ContentLength ||
      !sameDigest(fingerprintStorageMetadata(metadataFromOutput(object)), headMetadata)
    ) {
      stop("STORAGE_OBJECT_DRIFT");
    }
    const content = await safely(() => this.hashBody(object.Body), "STORAGE_OBJECT_DRIFT");
    if (
      content.bytes !== listed.sizeBytes ||
      expected.sizeBytes !== listed.sizeBytes ||
      !sameDigest(content.digest, expected.contentFingerprint) ||
      !sameDigest(headMetadata, expected.metadataFingerprint)
    ) {
      stop("STORAGE_OBJECT_DRIFT");
    }

    return {
      ...expected,
      etag: head.ETag,
      lastModified: listed.lastModified,
    };
  }

  private listedFingerprint(listed: readonly ListedObject[]): string {
    return canonicalJson(
      listed.map((entry) => ({
        bucketRole: entry.bucketRole,
        logicalKey: entry.logicalKey,
        etag: entry.etag,
        sizeBytes: entry.sizeBytes,
        lastModified: entry.lastModified,
      })),
    );
  }

  private async captureStableForEntries(
    envelope: RawStorageEnvelope,
    entries: readonly RawStorageEnvelopeEntry[],
    expectation: StorageNamespaceSnapshot["expectation"],
  ): Promise<StorageNamespaceSnapshot> {
    this.validateEnvelope(envelope);
    const first = await this.listNamespace(envelope.entries.length);
    this.assertListedMatchesEntries(first, entries);
    const expectedByIdentity = new Map(
      entries.map((entry) => [physicalIdentity(entry.bucketRole, entry.logicalKey), entry]),
    );
    const observed: ObservedStorageObject[] = [];
    for (const listed of first) {
      const expected = expectedByIdentity.get(
        physicalIdentity(listed.bucketRole, listed.logicalKey),
      );
      if (!expected) stop("STORAGE_OBJECT_DRIFT");
      observed.push(await this.inspectListed(listed, expected));
    }
    const second = await this.listNamespace(envelope.entries.length);
    this.assertListedMatchesEntries(second, entries);
    if (this.listedFingerprint(first) !== this.listedFingerprint(second)) {
      stop("STORAGE_OBJECT_DRIFT");
    }
    observed.sort((left, right) => compareUtf8Bytes(left.protectedKey, right.protectedKey));
    return {
      expectation,
      objectCount: observed.length,
      activeMultipartUploadCount: 0,
      objects: observed,
      fingerprint: snapshotFingerprint(observed),
    };
  }

  async captureStableSnapshot(
    envelope: RawStorageEnvelope,
    expectation: StorageSnapshotExpectation,
  ): Promise<StorageNamespaceSnapshot> {
    this.validateEnvelope(envelope);
    const entries =
      expectation === "pre"
        ? envelope.entries
        : envelope.entries.filter((entry) => entry.ownership === "preserved_only");
    return this.captureStableForEntries(envelope, entries, expectation);
  }

  private async headOrNull(
    bucketRole: StorageBucketRole,
    key: string,
    failureCode: Sk90SafetyErrorCode,
  ): Promise<HeadObjectCommandOutput | null> {
    try {
      return await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket(bucketRole), Key: key }),
      );
    } catch (error) {
      if (isNotFound(error)) return null;
      if (error instanceof Sk90ResetSafetyError) throw error;
      stop(failureCode);
    }
  }

  private async observePhysical(
    bucketRole: StorageBucketRole,
    key: string,
    expected: RawStorageEnvelopeEntry,
    failureCode: Sk90SafetyErrorCode,
  ): Promise<PhysicalObservation> {
    const head = await this.headOrNull(bucketRole, key, failureCode);
    if (!head || typeof head.ETag !== "string" || !Number.isSafeInteger(head.ContentLength)) {
      stop(failureCode);
    }
    const sizeBytes = head.ContentLength;
    if (sizeBytes === undefined || sizeBytes < 0) stop(failureCode);
    const metadataFingerprint = fingerprintStorageMetadata(metadataFromOutput(head));
    const object = await safely(
      () =>
        this.client.send(
          new GetObjectCommand({
            Bucket: this.bucket(bucketRole),
            Key: key,
            IfMatch: head.ETag,
          }),
        ),
      failureCode,
    );
    if (
      object.ETag !== head.ETag ||
      object.ContentLength !== sizeBytes ||
      !sameDigest(fingerprintStorageMetadata(metadataFromOutput(object)), metadataFingerprint)
    ) {
      stop(failureCode);
    }
    const content = await safely(() => this.hashBody(object.Body), failureCode);
    if (
      content.bytes !== sizeBytes ||
      sizeBytes !== expected.sizeBytes ||
      !sameDigest(content.digest, expected.contentFingerprint) ||
      !sameDigest(metadataFingerprint, expected.metadataFingerprint)
    ) {
      stop(failureCode);
    }
    return {
      etag: head.ETag,
      sizeBytes,
      contentFingerprint: content.digest,
      metadataFingerprint,
    };
  }

  private async conditionalCopy(
    input: Readonly<{
      bucketRole: StorageBucketRole;
      sourceKey: string;
      sourceEtag: string;
      destinationKey: string;
      failureCode: Sk90SafetyErrorCode;
      assertAuthorizationFresh: AuthorizationFreshnessCheck;
    }>,
  ): Promise<void> {
    await input.assertAuthorizationFresh();
    this.copyAttempts += 1;
    await safely(
      () =>
        this.client.send(
          new CopyObjectCommand({
            Bucket: this.bucket(input.bucketRole),
            Key: input.destinationKey,
            CopySource: encodeCopySource(this.bucket(input.bucketRole), input.sourceKey),
            CopySourceIfMatch: input.sourceEtag,
            IfNoneMatch: "*",
            MetadataDirective: "COPY",
          }),
        ),
      input.failureCode,
    );
    this.copiesSucceeded += 1;
  }

  private async forceRestoreCopy(
    input: Readonly<{
      bucketRole: StorageBucketRole;
      sourceKey: string;
      sourceEtag: string;
      destinationKey: string;
      destinationEtag: string;
      assertAuthorizationFresh: AuthorizationFreshnessCheck;
    }>,
  ): Promise<void> {
    await input.assertAuthorizationFresh();
    this.copyAttempts += 1;
    await safely(
      () =>
        this.client.send(
          new CopyObjectCommand({
            Bucket: this.bucket(input.bucketRole),
            Key: input.destinationKey,
            CopySource: encodeCopySource(this.bucket(input.bucketRole), input.sourceKey),
            CopySourceIfMatch: input.sourceEtag,
            IfMatch: input.destinationEtag,
            MetadataDirective: "COPY",
          }),
        ),
      "RESTORE_PROOF_MISMATCH",
    );
    this.copiesSucceeded += 1;
  }

  private async conditionalDelete(
    input: Readonly<{
      bucketRole: StorageBucketRole;
      key: string;
      etag: string;
      failureCode: Sk90SafetyErrorCode;
      assertAuthorizationFresh: AuthorizationFreshnessCheck;
    }>,
  ): Promise<void> {
    await input.assertAuthorizationFresh();
    this.deleteAttempts += 1;
    await safely(
      () =>
        this.client.send(
          new DeleteObjectCommand({
            Bucket: this.bucket(input.bucketRole),
            Key: input.key,
            IfMatch: input.etag,
          }),
        ),
      input.failureCode,
    );
    this.deletesSucceeded += 1;
    if ((await this.headOrNull(input.bucketRole, input.key, input.failureCode)) !== null) {
      stop(input.failureCode);
    }
  }

  private async ensureRecoveryCopy(
    artifactDigest: Sha256Digest,
    entry: RawStorageEnvelopeEntry,
    source: ObservedStorageObject,
    assertAuthorizationFresh: AuthorizationFreshnessCheck,
  ): Promise<Readonly<{ recoveryKey: string; observation: PhysicalObservation }>> {
    const recoveryKey = this.recoveryKey(artifactDigest, entry);
    if (
      (await this.headOrNull(entry.bucketRole, recoveryKey, "QUARANTINE_PROOF_MISMATCH")) === null
    ) {
      await this.conditionalCopy({
        bucketRole: entry.bucketRole,
        sourceKey: this.dataKey(entry.logicalKey),
        sourceEtag: source.etag,
        destinationKey: recoveryKey,
        failureCode: "QUARANTINE_PROOF_MISMATCH",
        assertAuthorizationFresh,
      });
    }
    const observation = await this.observePhysical(
      entry.bucketRole,
      recoveryKey,
      entry,
      "QUARANTINE_PROOF_MISMATCH",
    );
    return { recoveryKey, observation };
  }

  private async verifyRestoreProbe(
    artifactDigest: Sha256Digest,
    entry: RawStorageEnvelopeEntry,
    recovery: Readonly<{ recoveryKey: string; observation: PhysicalObservation }>,
    assertAuthorizationFresh: AuthorizationFreshnessCheck,
  ): Promise<void> {
    const probeKey = this.probeKey(artifactDigest, entry);
    let probe = await this.headOrNull(entry.bucketRole, probeKey, "QUARANTINE_PROOF_MISMATCH");
    if (probe === null) {
      await this.conditionalCopy({
        bucketRole: entry.bucketRole,
        sourceKey: recovery.recoveryKey,
        sourceEtag: recovery.observation.etag,
        destinationKey: probeKey,
        failureCode: "QUARANTINE_PROOF_MISMATCH",
        assertAuthorizationFresh,
      });
      probe = await this.headOrNull(entry.bucketRole, probeKey, "QUARANTINE_PROOF_MISMATCH");
    }
    const verified = await this.observePhysical(
      entry.bucketRole,
      probeKey,
      entry,
      "QUARANTINE_PROOF_MISMATCH",
    );
    if (!probe || probe.ETag !== verified.etag) stop("QUARANTINE_PROOF_MISMATCH");
    await this.conditionalDelete({
      bucketRole: entry.bucketRole,
      key: probeKey,
      etag: verified.etag,
      failureCode: "QUARANTINE_PROOF_MISMATCH",
      assertAuthorizationFresh,
    });
  }

  async quarantineResetObjects(
    input: Readonly<{
      artifactDigest: Sha256Digest;
      envelope: RawStorageEnvelope;
      assertAuthorizationFresh: AuthorizationFreshnessCheck;
    }>,
  ): Promise<
    Readonly<{
      sourceBeforeFingerprint: Sha256Digest;
      sourceAfterFingerprint: Sha256Digest;
      copies: readonly QuarantineCopyReceipt[];
    }>
  > {
    assertSha256Digest(input.artifactDigest);
    this.validateEnvelope(input.envelope);
    await this.assertNamespaceState({
      artifactDigest: input.artifactDigest,
      envelope: input.envelope,
      dataState: "pre",
      recoveryState: "approved_subset",
    });
    const before = await this.captureStableSnapshot(input.envelope, "pre");
    const sourceByToken = new Map(before.objects.map((object) => [object.protectedKey, object]));
    const copies: QuarantineCopyReceipt[] = [];
    const resetEntries = sortedEntries(
      input.envelope.entries.filter((entry) => entry.ownership === "reset_exclusive"),
    );
    for (const entry of resetEntries) {
      const source = sourceByToken.get(entry.protectedKey);
      if (!source) stop("QUARANTINE_PROOF_MISMATCH");
      const recovery = await this.ensureRecoveryCopy(
        input.artifactDigest,
        entry,
        source,
        input.assertAuthorizationFresh,
      );
      await this.verifyRestoreProbe(
        input.artifactDigest,
        entry,
        recovery,
        input.assertAuthorizationFresh,
      );
      const protectedCopyKey = this.token({
        scope: "recovery",
        bucketRole: entry.bucketRole,
        key: recovery.recoveryKey,
      });
      copies.push({
        bucketRole: entry.bucketRole,
        protectedSourceKey: entry.protectedKey,
        sourceContentFingerprint: entry.contentFingerprint,
        protectedCopyKey,
        copyContentFingerprint: recovery.observation.contentFingerprint,
        copyExists: true,
        restoreVerified: true,
      });
    }
    const after = await this.captureStableSnapshot(input.envelope, "pre");
    await this.assertNamespaceState({
      artifactDigest: input.artifactDigest,
      envelope: input.envelope,
      dataState: "pre",
      recoveryState: "complete",
    });
    if (!sameDigest(before.fingerprint, after.fingerprint) || !sameSnapshotVersion(before, after)) {
      stop("STORAGE_OBJECT_DRIFT");
    }
    return {
      sourceBeforeFingerprint: before.fingerprint,
      sourceAfterFingerprint: after.fingerprint,
      copies,
    };
  }

  private async verifyAllRecoveryCopies(
    artifactDigest: Sha256Digest,
    resetEntries: readonly RawStorageEnvelopeEntry[],
  ): Promise<Map<ProtectedToken, PhysicalObservation>> {
    const observed = new Map<ProtectedToken, PhysicalObservation>();
    for (const entry of resetEntries) {
      observed.set(
        entry.protectedKey,
        await this.observePhysical(
          entry.bucketRole,
          this.recoveryKey(artifactDigest, entry),
          entry,
          "QUARANTINE_PROOF_MISMATCH",
        ),
      );
    }
    return observed;
  }

  private async discoverPresentEntries(
    envelope: RawStorageEnvelope,
  ): Promise<RawStorageEnvelopeEntry[]> {
    const listed = await this.listNamespace(envelope.entries.length);
    const byIdentity = new Map(
      envelope.entries.map((entry) => [
        physicalIdentity(entry.bucketRole, entry.logicalKey),
        entry,
      ]),
    );
    const present: RawStorageEnvelopeEntry[] = [];
    for (const object of listed) {
      const entry = byIdentity.get(physicalIdentity(object.bucketRole, object.logicalKey));
      if (!entry) stop("STORAGE_OBJECT_DRIFT");
      present.push(entry);
    }
    for (const entry of envelope.entries) {
      if (
        entry.ownership === "preserved_only" &&
        !present.some((candidate) => candidate.protectedKey === entry.protectedKey)
      ) {
        stop("STORAGE_OBJECT_MISSING");
      }
    }
    return present;
  }

  private async notifyDeleteProgress(
    callback: ((receipt: StorageDeleteProgressReceipt) => unknown) | undefined,
    receipt: StorageDeleteProgressReceipt,
  ): Promise<void> {
    if (!callback) return;
    await safely(async () => {
      await callback(receipt);
    }, "UNEXPECTED_FAILURE");
  }

  async deleteResetObjects(
    input: Readonly<{
      artifactDigest: Sha256Digest;
      envelope: RawStorageEnvelope;
      completedProtectedKeys: readonly ProtectedToken[];
      mutationStarted: boolean;
      assertAuthorizationFresh: AuthorizationFreshnessCheck;
      onProgress?: (receipt: StorageDeleteProgressReceipt) => unknown;
    }>,
  ): Promise<StorageDeleteResult> {
    assertSha256Digest(input.artifactDigest);
    this.validateEnvelope(input.envelope);
    await this.assertNamespaceState({
      artifactDigest: input.artifactDigest,
      envelope: input.envelope,
      dataState: "approved_subset",
      recoveryState: "complete",
    });
    if (typeof input.mutationStarted !== "boolean") stop("PHASE_STATE_INVALID");
    const resetEntries = sortedEntries(
      input.envelope.entries.filter((entry) => entry.ownership === "reset_exclusive"),
    );
    for (const token of input.completedProtectedKeys) assertProtectedToken(token);
    if (
      new Set(input.completedProtectedKeys).size !== input.completedProtectedKeys.length ||
      !input.completedProtectedKeys.every((token) =>
        resetEntries.some((entry) => entry.protectedKey === token),
      ) ||
      (input.completedProtectedKeys.length > 0 && !input.mutationStarted)
    ) {
      stop("PHASE_STATE_INVALID");
    }
    const completedSet = new Set(input.completedProtectedKeys);
    await this.verifyAllRecoveryCopies(input.artifactDigest, resetEntries);

    const presentEntries = await this.discoverPresentEntries(input.envelope);
    const presentTokens = new Set(presentEntries.map((entry) => entry.protectedKey));
    for (const completed of input.completedProtectedKeys) {
      if (presentTokens.has(completed)) stop("STORAGE_OBJECT_DRIFT");
    }
    const current = await this.captureStableForEntries(input.envelope, presentEntries, "custom");
    const currentByToken = new Map(current.objects.map((object) => [object.protectedKey, object]));
    let reconciledCount = 0;

    for (const entry of resetEntries) {
      if (presentTokens.has(entry.protectedKey)) continue;
      if (completedSet.has(entry.protectedKey)) continue;
      if (!input.mutationStarted) stop("STORAGE_OBJECT_MISSING");
      reconciledCount += 1;
      await this.notifyDeleteProgress(input.onProgress, {
        protectedKey: entry.protectedKey,
        reconciled: true,
      });
    }

    for (const entry of resetEntries) {
      if (!presentTokens.has(entry.protectedKey)) continue;
      const observed = currentByToken.get(entry.protectedKey);
      if (!observed) stop("STORAGE_OBJECT_DRIFT");
      // Re-read the exact recovery copy immediately before its destructive
      // source operation. The earlier all-set check is not a mutation ticket.
      await this.observePhysical(
        entry.bucketRole,
        this.recoveryKey(input.artifactDigest, entry),
        entry,
        "QUARANTINE_PROOF_MISMATCH",
      );
      await this.observePhysical(
        entry.bucketRole,
        this.dataKey(entry.logicalKey),
        entry,
        "STORAGE_OBJECT_DRIFT",
      );
      await this.conditionalDelete({
        bucketRole: entry.bucketRole,
        key: this.dataKey(entry.logicalKey),
        etag: observed.etag,
        failureCode: "STORAGE_OBJECT_DRIFT",
        assertAuthorizationFresh: input.assertAuthorizationFresh,
      });
      await this.notifyDeleteProgress(input.onProgress, {
        protectedKey: entry.protectedKey,
        reconciled: false,
      });
    }

    const postSnapshot = await this.captureStableSnapshot(input.envelope, "post");
    await this.assertNamespaceState({
      artifactDigest: input.artifactDigest,
      envelope: input.envelope,
      dataState: "post",
      recoveryState: "complete",
    });
    return {
      deletedCount: resetEntries.length,
      reconciledCount,
      deletedObjectsFingerprint: deletedObjectsFingerprint(resetEntries),
      postSnapshot,
    };
  }

  async restoreResetObjects(
    input: Readonly<{
      artifactDigest: Sha256Digest;
      envelope: RawStorageEnvelope;
      forceReplay: boolean;
      assertAuthorizationFresh: AuthorizationFreshnessCheck;
      onProgress?: (
        receipt: Readonly<{
          protectedKey: ProtectedToken;
          alreadyPresent: boolean;
          replayed: boolean;
        }>,
      ) => void | Promise<void>;
    }>,
  ): Promise<StorageRestoreResult> {
    assertSha256Digest(input.artifactDigest);
    if (typeof input.forceReplay !== "boolean") stop("RESTORE_PROOF_MISMATCH");
    this.validateEnvelope(input.envelope);
    await this.assertNamespaceState({
      artifactDigest: input.artifactDigest,
      envelope: input.envelope,
      dataState: "approved_subset",
      recoveryState: "complete",
    });
    const resetEntries = sortedEntries(
      input.envelope.entries.filter((entry) => entry.ownership === "reset_exclusive"),
    );
    const recovery = await this.verifyAllRecoveryCopies(input.artifactDigest, resetEntries);
    const presentEntries = await this.discoverPresentEntries(input.envelope);
    const current = await this.captureStableForEntries(input.envelope, presentEntries, "custom");
    const presentByToken = new Map(current.objects.map((entry) => [entry.protectedKey, entry]));
    let restoredCount = 0;
    let replayedCount = 0;
    let alreadyPresentCount = 0;

    for (const entry of resetEntries) {
      const present = presentByToken.get(entry.protectedKey);
      const alreadyPresent = present !== undefined;
      if (alreadyPresent && !input.forceReplay) {
        alreadyPresentCount += 1;
        if (input.onProgress) {
          await safely(async () => {
            await input.onProgress?.({
              protectedKey: entry.protectedKey,
              alreadyPresent: true,
              replayed: false,
            });
          }, "UNEXPECTED_FAILURE");
        }
        continue;
      }
      const recoveryObservation = recovery.get(entry.protectedKey);
      if (!recoveryObservation) stop("RESTORE_PROOF_MISMATCH");
      const copyInput = {
        bucketRole: entry.bucketRole,
        sourceKey: this.recoveryKey(input.artifactDigest, entry),
        sourceEtag: recoveryObservation.etag,
        destinationKey: this.dataKey(entry.logicalKey),
      };
      if (alreadyPresent) {
        await this.forceRestoreCopy({
          ...copyInput,
          destinationEtag: present.etag,
          assertAuthorizationFresh: input.assertAuthorizationFresh,
        });
        replayedCount += 1;
      } else {
        await this.conditionalCopy({
          ...copyInput,
          failureCode: "RESTORE_PROOF_MISMATCH",
          assertAuthorizationFresh: input.assertAuthorizationFresh,
        });
      }
      await this.observePhysical(
        entry.bucketRole,
        this.dataKey(entry.logicalKey),
        entry,
        "RESTORE_PROOF_MISMATCH",
      );
      restoredCount += 1;
      if (input.onProgress) {
        await safely(async () => {
          await input.onProgress?.({
            protectedKey: entry.protectedKey,
            alreadyPresent,
            replayed: alreadyPresent,
          });
        }, "UNEXPECTED_FAILURE");
      }
    }

    const result = {
      restoredCount,
      replayedCount,
      alreadyPresentCount,
      snapshot: await this.captureStableSnapshot(input.envelope, "pre"),
    };
    await this.assertNamespaceState({
      artifactDigest: input.artifactDigest,
      envelope: input.envelope,
      dataState: "pre",
      recoveryState: "complete",
    });
    return result;
  }

  async captureSecondRunStorageSnapshot(
    input: Readonly<{
      envelope: RawStorageEnvelope;
      expected: StorageSnapshotExpectation;
      beforeSnapshot: StorageNamespaceSnapshot;
      beforeCounters: StorageMutationCounters;
    }>,
  ): Promise<SecondRunStorageSnapshot> {
    assertCounterShape(input.beforeCounters);
    const after = await this.captureStableSnapshot(input.envelope, input.expected);
    const counters = this.getMutationCounters();
    const delta = {
      copyAttempts: counters.copyAttempts - input.beforeCounters.copyAttempts,
      copiesSucceeded: counters.copiesSucceeded - input.beforeCounters.copiesSucceeded,
      deleteAttempts: counters.deleteAttempts - input.beforeCounters.deleteAttempts,
      deletesSucceeded: counters.deletesSucceeded - input.beforeCounters.deletesSucceeded,
    };
    if (
      !sameDigest(input.beforeSnapshot.fingerprint, after.fingerprint) ||
      Object.values(delta).some((value) => value !== 0)
    ) {
      stop("POST_RESET_INTEGRITY_MISMATCH");
    }
    return {
      beforeFingerprint: input.beforeSnapshot.fingerprint,
      afterFingerprint: after.fingerprint,
      copyAttempts: 0,
      copiesSucceeded: 0,
      deleteAttempts: 0,
      deletesSucceeded: 0,
      unchanged: true,
    };
  }
}

export function createSk90R2Rehearsal(
  input: Readonly<{
    client: Sk90S3Client;
    config: Sk90R2RehearsalConfig;
    tokenForKey: RawKeyTokenHook;
  }>,
): Sk90R2RehearsalAdapter {
  return new R2RehearsalAdapter(input.client, input.config, input.tokenForKey);
}
