import { createHash } from "node:crypto";

import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  type GetObjectCommandOutput,
  type HeadObjectCommandOutput,
  type S3Client,
} from "@aws-sdk/client-s3";

import {
  assertProtectedToken,
  assertSha256Digest,
  canonicalJson,
  compareUtf8Bytes,
  protectValue,
  sameDigest,
  sha256Digest,
  type ProtectedToken,
  type Sha256Digest,
} from "../sk90-reset/canonical";
import { Sk90ResetSafetyError, stop, type Sk90SafetyErrorCode } from "../sk90-reset/errors";
import {
  assertPrivateExecutionEnvelope,
  bindPrivateExecutionEnvelope,
  type PrivateExecutionEnvelope,
  type PrivateStorageObject,
  type PrivateStorageReference,
} from "../sk90-reset/private-envelope";
import { assertSk104ProductionManifest, type Sk104ProductionManifest } from "./contract";
import {
  assertSk104PrivateProductionDatabaseManifest,
  type Sk104PrivateProductionDatabaseManifest,
} from "./database";
import { fingerprintStorageMetadata } from "../sk90-reset/r2-rehearsal";
import type {
  MaybePromise,
  StorageBucketRole,
  StorageObjectMetadata,
} from "../sk90-reset/storage-port";

const BUCKET_PATTERN = /^(?!\d{1,3}(?:\.\d{1,3}){3}$)[a-z0-9](?:[a-z0-9.-]{1,61}[a-z0-9])$/;
const RECOVERY_PREFIX_PATTERN = /^sk104-cutover\/[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?\/recovery\/$/;
const CUTOVER_PREFIX = "sk104-cutover/";
const EXPECTED_RESET_OBJECT_COUNT = 9;

export type Sk104StorageClient = Pick<S3Client, "send">;

export type Sk104ProductionStorageTarget = Readonly<{
  endpoint: string;
  buckets: Readonly<Record<StorageBucketRole, string>>;
}>;

/**
 * The factory is deliberately invoked only after the endpoint account identity
 * and both exact bucket names match the approved production fingerprint.
 * Credentials may be closed over by the caller, but must never be accepted by
 * or printed from this adapter.
 */
export type Sk104StorageClientFactory = (
  target: Sk104ProductionStorageTarget,
) => Sk104StorageClient;

export type Sk104ProductionStorageConfig = Readonly<{
  targetClass: "canonical_production";
  endpoint: string;
  buckets: Readonly<Record<StorageBucketRole, string>>;
  recoveryPrefix: string;
  approvedTargetFingerprint: Sha256Digest;
  forbiddenTargetFingerprint: Sha256Digest;
  clientFactory: Sk104StorageClientFactory;
}>;

export type Sk104NoWriterMaintenanceAuthorizationBinding = Readonly<{
  contract: "sk104-storage-no-writer-mutation-v1";
  action: "delete_source";
  maintenanceMode: "writers_blocked";
  targetStorageFingerprint: Sha256Digest;
  artifactDigest: Sha256Digest;
  restorePointFingerprint: Sha256Digest;
  protectedSourceKey: ProtectedToken;
  protectedRecoveryKey: ProtectedToken;
  expectedSourceVersionFingerprint: Sha256Digest;
}>;

/**
 * DeleteObject has no documented conditional-delete contract in Cloudflare R2.
 * The caller must therefore prove that application writers are blocked for the
 * exact target, artifact, restore point, and protected object immediately before
 * every unconditional DeleteObject call. A rejected proof must throw.
 */
export type NoWriterMaintenanceAuthorizationCheck = (
  binding: Sk104NoWriterMaintenanceAuthorizationBinding,
) => MaybePromise<void>;

export type Sk104ProductionStorageObjectReceipt = Readonly<{
  bucketRole: StorageBucketRole;
  protectedSourceKey: ProtectedToken;
  protectedRecoveryKey: ProtectedToken;
  contentFingerprint: Sha256Digest;
  metadataFingerprint: Sha256Digest;
  recoveryVerified: true;
  sourceDeleted: true;
  copyReconciled: boolean;
  deleteReconciled: boolean;
}>;

export type Sk104PreparedStorageObjectReceipt = Readonly<{
  bucketRole: StorageBucketRole;
  protectedSourceKey: ProtectedToken;
  protectedRecoveryKey: ProtectedToken;
  sizeBytes: number;
  contentFingerprint: Sha256Digest;
  metadataFingerprint: Sha256Digest;
  recoveryVerified: true;
}>;

export type Sk104StorageRestorePointReceipt = Readonly<{
  contract: "sk104-production-storage-restore-point-v1";
  artifactDigest: Sha256Digest;
  targetStorageFingerprint: Sha256Digest;
  objectCount: 9;
  objects: readonly Sk104PreparedStorageObjectReceipt[];
  restorePointFingerprint: Sha256Digest;
}>;

export type Sk104ProductionStorageReceipt = Readonly<{
  contract: "sk104-production-storage-receipt-v1";
  artifactDigest: Sha256Digest;
  targetStorageFingerprint: Sha256Digest;
  objectCount: number;
  copiedCount: number;
  copyReconciledCount: number;
  deletedCount: number;
  deleteReconciledCount: number;
  objects: readonly Sk104ProductionStorageObjectReceipt[];
  receiptDigest: Sha256Digest;
}>;

export type Sk104StorageRestoreObjectReceipt = Readonly<{
  bucketRole: StorageBucketRole;
  protectedSourceKey: ProtectedToken;
  protectedRecoveryKey: ProtectedToken;
  contentFingerprint: Sha256Digest;
  metadataFingerprint: Sha256Digest;
  sourceRestored: true;
  recoveryRetained: true;
  copyReconciled: boolean;
}>;

export type Sk104StorageRestoreReceipt = Readonly<{
  contract: "sk104-production-storage-restore-receipt-v1";
  artifactDigest: Sha256Digest;
  targetStorageFingerprint: Sha256Digest;
  restorePointFingerprint: Sha256Digest;
  objectCount: 9;
  restoredCount: 9;
  recoveryRetainedCount: 9;
  objects: readonly Sk104StorageRestoreObjectReceipt[];
  receiptDigest: Sha256Digest;
}>;

export type Sk104StorageVerificationReceipt = Readonly<{
  contract: "sk104-production-storage-verification-v1";
  artifactDigest: Sha256Digest;
  targetStorageFingerprint: Sha256Digest;
  restorePointFingerprint: Sha256Digest;
  expectedSourceState: "absent" | "restored";
  objectCount: 9;
  recoveryVerifiedCount: 9;
  sourceVerifiedCount: 9;
  receiptDigest: Sha256Digest;
}>;

export type Sk104PrivateStorageDiscovery = Readonly<{
  references: readonly PrivateStorageReference[];
  objects: readonly PrivateStorageObject[];
  targetStorageFingerprint: Sha256Digest;
  enumerationFingerprint: Sha256Digest;
}>;

type AuthorizationFreshnessCheck = () => MaybePromise<void>;

type ExactResetObject = Readonly<{
  bucketRole: StorageBucketRole;
  sourceKey: string;
  protectedSourceKey: ProtectedToken;
  recoveryKey: string;
  protectedRecoveryKey: ProtectedToken;
  sizeBytes: number;
  contentFingerprint: Sha256Digest;
  metadataFingerprint: Sha256Digest;
}>;

type ExactObservation = Readonly<{
  etag: string;
  sizeBytes: number;
  contentFingerprint: Sha256Digest;
  metadataFingerprint: Sha256Digest;
}>;

type PreparedResetObject = Readonly<{
  object: ExactResetObject;
  source: ExactObservation | null;
  copyReconciled: boolean;
}>;

function restorePointReceipt(
  artifactDigest: Sha256Digest,
  targetStorageFingerprint: Sha256Digest,
  objects: readonly ExactResetObject[],
): Sk104StorageRestorePointReceipt {
  assertSha256Digest(targetStorageFingerprint);
  if (objects.length !== EXPECTED_RESET_OBJECT_COUNT) stop("RESET_PLAN_MISMATCH");
  const body = {
    contract: "sk104-production-storage-restore-point-v1" as const,
    artifactDigest,
    targetStorageFingerprint,
    objectCount: EXPECTED_RESET_OBJECT_COUNT,
    objects: objects.map((object) => ({
      bucketRole: object.bucketRole,
      protectedSourceKey: object.protectedSourceKey,
      protectedRecoveryKey: object.protectedRecoveryKey,
      sizeBytes: object.sizeBytes,
      contentFingerprint: object.contentFingerprint,
      metadataFingerprint: object.metadataFingerprint,
      recoveryVerified: true as const,
    })),
  };
  return {
    ...body,
    objectCount: 9,
    restorePointFingerprint: sha256Digest(canonicalJson(body)),
  };
}

function verificationReceipt(
  artifactDigest: Sha256Digest,
  targetStorageFingerprint: Sha256Digest,
  restorePointFingerprint: Sha256Digest,
  expectedSourceState: "absent" | "restored",
): Sk104StorageVerificationReceipt {
  const body = {
    contract: "sk104-production-storage-verification-v1" as const,
    artifactDigest,
    targetStorageFingerprint,
    restorePointFingerprint,
    expectedSourceState,
    objectCount: 9 as const,
    recoveryVerifiedCount: 9 as const,
    sourceVerifiedCount: 9 as const,
  };
  return { ...body, receiptDigest: sha256Digest(canonicalJson(body)) };
}

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

function normalizedProductionEndpoint(value: string): Readonly<{
  endpoint: string;
  accountIdentity: string;
}> {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    stop("STORAGE_TARGET_MISMATCH");
  }
  const match = /^([0-9a-f]{32})\.r2\.cloudflarestorage\.com$/.exec(endpoint.hostname);
  if (
    endpoint.protocol !== "https:" ||
    !match ||
    endpoint.username !== "" ||
    endpoint.password !== "" ||
    endpoint.port !== "" ||
    (endpoint.pathname !== "" && endpoint.pathname !== "/") ||
    endpoint.search !== "" ||
    endpoint.hash !== ""
  ) {
    stop("STORAGE_TARGET_MISMATCH");
  }
  return {
    endpoint: endpoint.origin,
    accountIdentity: match[1] ?? stop("STORAGE_TARGET_MISMATCH"),
  };
}

export function sk104ProductionStorageTargetFingerprint(
  target: Sk104ProductionStorageTarget,
): Sha256Digest {
  const endpoint = normalizedProductionEndpoint(target.endpoint);
  if (
    !isSafeBucket(target.buckets.audio) ||
    !isSafeBucket(target.buckets.docs) ||
    target.buckets.audio === target.buckets.docs
  ) {
    stop("STORAGE_TARGET_MISMATCH");
  }
  return sha256Digest(
    canonicalJson({
      contract: "sk104-production-storage-target-v1",
      provider: "cloudflare-r2",
      endpoint: endpoint.endpoint,
      accountIdentity: endpoint.accountIdentity,
      audioBucket: target.buckets.audio,
      docsBucket: target.buckets.docs,
    }),
  );
}

function assertConfig(config: Sk104ProductionStorageConfig): Readonly<{
  target: Sk104ProductionStorageTarget;
  targetFingerprint: Sha256Digest;
}> {
  const candidate = config as unknown as Record<string, unknown>;
  const buckets = candidate.buckets;
  const audio: unknown =
    typeof buckets === "object" && buckets !== null ? Reflect.get(buckets, "audio") : undefined;
  const docs: unknown =
    typeof buckets === "object" && buckets !== null ? Reflect.get(buckets, "docs") : undefined;
  if (
    candidate.targetClass !== "canonical_production" ||
    typeof candidate.endpoint !== "string" ||
    typeof audio !== "string" ||
    typeof docs !== "string" ||
    !isSafeBucket(audio) ||
    !isSafeBucket(docs) ||
    audio === docs ||
    typeof candidate.recoveryPrefix !== "string" ||
    !RECOVERY_PREFIX_PATTERN.test(candidate.recoveryPrefix) ||
    typeof candidate.clientFactory !== "function"
  ) {
    stop("STORAGE_TARGET_MISMATCH");
  }
  assertSha256Digest(config.approvedTargetFingerprint);
  assertSha256Digest(config.forbiddenTargetFingerprint);
  if (sameDigest(config.approvedTargetFingerprint, config.forbiddenTargetFingerprint)) {
    stop("STORAGE_TARGET_MISMATCH");
  }
  const target = {
    endpoint: normalizedProductionEndpoint(config.endpoint).endpoint,
    buckets: { audio, docs },
  } as const;
  const targetFingerprint = sk104ProductionStorageTargetFingerprint(target);
  if (sameDigest(targetFingerprint, config.forbiddenTargetFingerprint)) {
    stop("STORAGE_TARGET_FORBIDDEN");
  }
  if (!sameDigest(targetFingerprint, config.approvedTargetFingerprint)) {
    stop("STORAGE_TARGET_MISMATCH");
  }
  return { target, targetFingerprint };
}

function validateExactKey(key: string, recoveryPrefix: string): void {
  const segments = key.split("/");
  if (
    key.length === 0 ||
    key.length > 1_024 ||
    key.startsWith("/") ||
    key.includes("\\") ||
    key.includes("\0") ||
    key.startsWith(recoveryPrefix) ||
    key.startsWith(CUTOVER_PREFIX) ||
    segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    stop("PRIVATE_ENVELOPE_MISMATCH");
  }
}

function digestHex(digest: Sha256Digest): string {
  return digest.slice("sha256:".length);
}

function protectedHex(token: ProtectedToken): string {
  assertProtectedToken(token);
  return token.slice("hmac-sha256:".length);
}

function recoveryKey(
  recoveryPrefix: string,
  artifactDigest: Sha256Digest,
  bucketRole: StorageBucketRole,
  protectedKey: ProtectedToken,
): string {
  return `${recoveryPrefix}${digestHex(artifactDigest)}/${bucketRole}/${protectedHex(protectedKey)}`;
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

const CLOUDFLARE_COPY_DESTINATION_IF_NONE_MATCH = "cf-copy-destination-if-none-match" as const;

/** CopyObject command with Cloudflare's documented destination condition. */
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
          stop("STORAGE_TARGET_MISMATCH");
        }
        const headers: unknown = Reflect.get(request, "headers");
        if (typeof headers !== "object" || headers === null) {
          stop("STORAGE_TARGET_MISMATCH");
        }
        Reflect.set(headers, CLOUDFLARE_COPY_DESTINATION_IF_NONE_MATCH, "*");
        return next(arguments_);
      },
      {
        step: "build",
        name: "sk104CloudflareDestinationAbsentCondition",
        priority: "low",
      },
    );
  }
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

async function safe<Value>(
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
  return {
    cacheControl: output.CacheControl ?? null,
    contentDisposition: output.ContentDisposition ?? null,
    contentEncoding: output.ContentEncoding ?? null,
    contentLanguage: output.ContentLanguage ?? null,
    contentType: output.ContentType ?? null,
    expiresAt,
    custom,
  };
}

function hasByteArrayTransform(
  body: unknown,
): body is Readonly<{ transformToByteArray: () => Promise<Uint8Array> }> {
  if (typeof body !== "object" || body === null) return false;
  return typeof Reflect.get(body, "transformToByteArray") === "function";
}

async function hashBody(body: unknown): Promise<Readonly<{ bytes: number; digest: Sha256Digest }>> {
  const hash = createHash("sha256");
  let bytes = 0;
  const consume = (value: Uint8Array): void => {
    bytes += value.byteLength;
    hash.update(value);
  };

  if (body instanceof Uint8Array) {
    consume(body);
  } else if (body instanceof Blob) {
    consume(new Uint8Array(await body.arrayBuffer()));
  } else if (
    typeof body === "object" &&
    body !== null &&
    Symbol.asyncIterator in body &&
    typeof body[Symbol.asyncIterator] === "function"
  ) {
    for await (const chunk of body as AsyncIterable<unknown>) {
      if (!(chunk instanceof Uint8Array)) stop("STORAGE_OBJECT_DRIFT");
      consume(chunk);
    }
  } else if (hasByteArrayTransform(body)) {
    consume(await body.transformToByteArray());
  } else if (body instanceof ReadableStream) {
    const reader = (body as ReadableStream<unknown>).getReader();
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      if (!(result.value instanceof Uint8Array)) stop("STORAGE_OBJECT_DRIFT");
      consume(result.value);
    }
  } else {
    stop("STORAGE_OBJECT_DRIFT");
  }

  return { bytes, digest: `sha256:${hash.digest("hex")}` };
}

function exactResetObjects(
  envelope: PrivateExecutionEnvelope,
  hmacKey: string,
  recoveryPrefix: string,
): ExactResetObject[] {
  const checked = assertPrivateExecutionEnvelope(envelope, hmacKey);
  const rawByIdentity = new Map(
    checked.storageObjects.map((object) => [`${object.bucketRole}\0${object.key}`, object]),
  );
  const references = new Map<string, Set<"reset" | "preserved">>();
  for (const reference of checked.storageReferences) {
    const identity = `${reference.bucketRole}\0${reference.key}`;
    const kinds = references.get(identity) ?? new Set<"reset" | "preserved">();
    kinds.add(reference.referencedBy);
    references.set(identity, kinds);
  }

  const result: ExactResetObject[] = [];
  for (const [identity, kinds] of references) {
    if (kinds.has("reset") && kinds.has("preserved")) stop("STORAGE_OBJECT_SHARED");
    if (!kinds.has("reset")) continue;
    const raw = rawByIdentity.get(identity);
    if (!raw || raw.ownership !== "reset_exclusive") stop("STORAGE_OWNERSHIP_UNVERIFIED");
  }

  for (const object of checked.storageObjects) {
    if (object.ownership !== "reset_exclusive") continue;
    const identity = `${object.bucketRole}\0${object.key}`;
    if (!references.get(identity)?.has("reset")) stop("STORAGE_OWNERSHIP_UNVERIFIED");
    validateExactKey(object.key, recoveryPrefix);
    const protectedSourceKey = protectValue(
      hmacKey,
      `storage-key\0${object.bucketRole}\0${object.key}`,
    );
    const exactRecoveryKey = recoveryKey(
      recoveryPrefix,
      checked.artifactDigest,
      object.bucketRole,
      protectedSourceKey,
    );
    result.push({
      bucketRole: object.bucketRole,
      sourceKey: object.key,
      protectedSourceKey,
      recoveryKey: exactRecoveryKey,
      protectedRecoveryKey: protectValue(
        hmacKey,
        `storage-recovery-key\0${object.bucketRole}\0${exactRecoveryKey}`,
      ),
      sizeBytes: object.sizeBytes,
      contentFingerprint: object.contentFingerprint,
      metadataFingerprint: object.metadataFingerprint,
    });
  }

  result.sort((left, right) => compareUtf8Bytes(left.protectedSourceKey, right.protectedSourceKey));
  if (result.length !== EXPECTED_RESET_OBJECT_COUNT) stop("RESET_PLAN_MISMATCH");
  const sourceIdentities = new Set(
    result.map((object) => `${object.bucketRole}\0${object.sourceKey}`),
  );
  for (const object of result) {
    if (sourceIdentities.has(`${object.bucketRole}\0${object.recoveryKey}`)) {
      stop("PRIVATE_ENVELOPE_MISMATCH");
    }
  }
  return result;
}

export class Sk104ProductionStorageAdapter {
  readonly #client: Sk104StorageClient;
  readonly #buckets: Readonly<Record<StorageBucketRole, string>>;
  readonly #recoveryPrefix: string;
  readonly #targetFingerprint: Sha256Digest;

  constructor(config: Sk104ProductionStorageConfig) {
    const checked = assertConfig(config);
    let untrustedClient: unknown;
    try {
      untrustedClient = config.clientFactory(checked.target);
    } catch {
      stop("STORAGE_TARGET_MISMATCH");
    }
    if (
      typeof untrustedClient !== "object" ||
      untrustedClient === null ||
      typeof Reflect.get(untrustedClient, "send") !== "function"
    ) {
      stop("STORAGE_TARGET_MISMATCH");
    }
    this.#client = untrustedClient as Sk104StorageClient;
    this.#buckets = { ...checked.target.buckets };
    this.#recoveryPrefix = config.recoveryPrefix;
    this.#targetFingerprint = checked.targetFingerprint;
  }

  #bucket(role: StorageBucketRole): string {
    return this.#buckets[role];
  }

  #assertExpectedTarget(expectedTargetFingerprint: Sha256Digest): Sha256Digest {
    assertSha256Digest(expectedTargetFingerprint);
    if (!sameDigest(this.#targetFingerprint, expectedTargetFingerprint)) {
      stop("STORAGE_TARGET_MISMATCH");
    }
    return expectedTargetFingerprint;
  }

  async #headOrNull(
    object: ExactResetObject,
    key: string,
    failureCode: Sk90SafetyErrorCode,
  ): Promise<HeadObjectCommandOutput | null> {
    return this.#headRawOrNull(object.bucketRole, key, failureCode);
  }

  async #headRawOrNull(
    bucketRole: StorageBucketRole,
    key: string,
    failureCode: Sk90SafetyErrorCode,
  ): Promise<HeadObjectCommandOutput | null> {
    try {
      return await this.#client.send(
        new HeadObjectCommand({ Bucket: this.#bucket(bucketRole), Key: key }),
      );
    } catch (error) {
      if (isNotFound(error)) return null;
      if (error instanceof Sk90ResetSafetyError) throw error;
      stop(failureCode);
    }
  }

  async #discoverRawObject(
    bucketRole: StorageBucketRole,
    key: string,
  ): Promise<PrivateStorageObject> {
    validateExactKey(key, this.#recoveryPrefix);
    const head = await this.#headRawOrNull(bucketRole, key, "STORAGE_OBJECT_DRIFT");
    if (!head || typeof head.ETag !== "string" || !Number.isSafeInteger(head.ContentLength)) {
      stop("STORAGE_OBJECT_MISSING");
    }
    const sizeBytes = head.ContentLength;
    if (sizeBytes === undefined || sizeBytes < 0) stop("STORAGE_OBJECT_DRIFT");
    const metadataFingerprint = fingerprintStorageMetadata(metadataFromOutput(head));
    const fetched = await safe(
      () =>
        this.#client.send(
          new GetObjectCommand({
            Bucket: this.#bucket(bucketRole),
            Key: key,
            IfMatch: head.ETag,
          }),
        ),
      "STORAGE_OBJECT_DRIFT",
    );
    if (
      fetched.ETag !== head.ETag ||
      fetched.ContentLength !== sizeBytes ||
      !sameDigest(fingerprintStorageMetadata(metadataFromOutput(fetched)), metadataFingerprint)
    ) {
      stop("STORAGE_OBJECT_DRIFT");
    }
    const content = await safe(() => hashBody(fetched.Body), "STORAGE_OBJECT_DRIFT");
    if (content.bytes !== sizeBytes) stop("STORAGE_OBJECT_DRIFT");
    return {
      bucketRole,
      key,
      ownership: "reset_exclusive",
      sizeBytes,
      contentFingerprint: content.digest,
      metadataFingerprint,
    };
  }

  /** Read-only, exact-key storage discovery. No bucket listing is performed. */
  async discoverExactApprovedStorage(
    input: Readonly<{
      privateDatabaseManifest: Sk104PrivateProductionDatabaseManifest;
      expectedTargetFingerprint: Sha256Digest;
      hmacKey: string;
    }>,
  ): Promise<Sk104PrivateStorageDiscovery> {
    const targetStorageFingerprint = this.#assertExpectedTarget(
      input.expectedTargetFingerprint,
    );
    const database = assertSk104PrivateProductionDatabaseManifest(
      input.privateDatabaseManifest,
      input.hmacKey,
    );
    const references: PrivateStorageReference[] = database.storageReferences.map((reference) => ({
      bucketRole: reference.bucketRole,
      key: reference.key,
      referencedBy: reference.referencedBy,
    }));
    const identities = new Set(references.map((entry) => `${entry.bucketRole}\0${entry.key}`));
    if (
      references.length !== EXPECTED_RESET_OBJECT_COUNT ||
      identities.size !== EXPECTED_RESET_OBJECT_COUNT ||
      references.some((reference) => reference.referencedBy !== "reset")
    ) {
      stop("STORAGE_ENUMERATION_MISMATCH");
    }
    const objects: PrivateStorageObject[] = [];
    for (const reference of references) {
      objects.push(await this.#discoverRawObject(reference.bucketRole, reference.key));
    }
    objects.sort((left, right) =>
      compareUtf8Bytes(`${left.bucketRole}\0${left.key}`, `${right.bucketRole}\0${right.key}`),
    );
    const sanitized = objects.map((object) => ({
      bucketRole: object.bucketRole,
      protectedKey: protectValue(input.hmacKey, `storage-key\0${object.bucketRole}\0${object.key}`),
      ownership: object.ownership,
      sizeBytes: object.sizeBytes,
      contentFingerprint: object.contentFingerprint,
      metadataFingerprint: object.metadataFingerprint,
    }));
    return {
      references,
      objects,
      targetStorageFingerprint,
      enumerationFingerprint: sha256Digest(canonicalJson(sanitized)),
    };
  }

  buildPrivateStorageEnvelope(
    input: Readonly<{
      manifest: Sk104ProductionManifest;
      privateDatabaseManifest: Sk104PrivateProductionDatabaseManifest;
      discovery: Sk104PrivateStorageDiscovery;
      hmacKey: string;
    }>,
  ): PrivateExecutionEnvelope {
    const manifest = assertSk104ProductionManifest(input.manifest);
    this.#assertExpectedTarget(manifest.target.approvedStorageFingerprint);
    const database = assertSk104PrivateProductionDatabaseManifest(
      input.privateDatabaseManifest,
      input.hmacKey,
    );
    if (
      !sameDigest(input.discovery.enumerationFingerprint, manifest.storageEnumerationFingerprint) ||
      !sameDigest(
        input.discovery.targetStorageFingerprint,
        manifest.target.approvedStorageFingerprint,
      ) ||
      input.discovery.references.length !== EXPECTED_RESET_OBJECT_COUNT ||
      input.discovery.objects.length !== EXPECTED_RESET_OBJECT_COUNT
    ) {
      stop("STORAGE_ENUMERATION_MISMATCH");
    }
    return bindPrivateExecutionEnvelope(
      {
        artifactDigest: manifest.digest,
        manifestDigest: manifest.digest,
        targetPolicyDigest: manifest.target.policyDigest,
        rows: database.rows.map((row) => ({
          category: row.category,
          table: row.table,
          id: row.id,
          payload: { protectedContentHash: row.protectedContentHash },
        })),
        storageReferences: input.discovery.references,
        storageObjects: input.discovery.objects,
        providerReferences: database.mockEvidence.providerReferences,
      },
      input.hmacKey,
    );
  }

  planResetObjectRecovery(
    input: Readonly<{
      envelope: PrivateExecutionEnvelope;
      expectedTargetFingerprint: Sha256Digest;
      hmacKey: string;
    }>,
  ): Sk104StorageRestorePointReceipt {
    const checked = assertPrivateExecutionEnvelope(input.envelope, input.hmacKey);
    const targetStorageFingerprint = this.#assertExpectedTarget(
      input.expectedTargetFingerprint,
    );
    return restorePointReceipt(
      checked.artifactDigest,
      targetStorageFingerprint,
      exactResetObjects(checked, input.hmacKey, this.#recoveryPrefix),
    );
  }

  async #observe(
    object: ExactResetObject,
    key: string,
    failureCode: Sk90SafetyErrorCode,
  ): Promise<ExactObservation> {
    const head = await this.#headOrNull(object, key, failureCode);
    if (!head || typeof head.ETag !== "string" || !Number.isSafeInteger(head.ContentLength)) {
      stop(failureCode);
    }
    const sizeBytes = head.ContentLength;
    if (sizeBytes === undefined || sizeBytes < 0 || sizeBytes !== object.sizeBytes) {
      stop(failureCode);
    }
    const metadataFingerprint = fingerprintStorageMetadata(metadataFromOutput(head));
    const fetched = await safe(
      () =>
        this.#client.send(
          new GetObjectCommand({
            Bucket: this.#bucket(object.bucketRole),
            Key: key,
            IfMatch: head.ETag,
          }),
        ),
      failureCode,
    );
    if (
      fetched.ETag !== head.ETag ||
      fetched.ContentLength !== sizeBytes ||
      !sameDigest(fingerprintStorageMetadata(metadataFromOutput(fetched)), metadataFingerprint)
    ) {
      stop(failureCode);
    }
    const content = await safe(() => hashBody(fetched.Body), failureCode);
    if (
      content.bytes !== sizeBytes ||
      !sameDigest(content.digest, object.contentFingerprint) ||
      !sameDigest(metadataFingerprint, object.metadataFingerprint)
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

  async #ensureRecoveryCopy(
    object: ExactResetObject,
    source: ExactObservation,
    assertAuthorizationFresh: AuthorizationFreshnessCheck,
  ): Promise<Readonly<{ observation: ExactObservation; reconciled: boolean }>> {
    const existing = await this.#headOrNull(
      object,
      object.recoveryKey,
      "QUARANTINE_PROOF_MISMATCH",
    );
    if (existing) {
      return {
        observation: await this.#observe(object, object.recoveryKey, "QUARANTINE_PROOF_MISMATCH"),
        reconciled: true,
      };
    }

    await safe(async () => {
      await assertAuthorizationFresh();
    }, "FRESH_TARGET_AUTHORIZATION_INVALID");
    try {
      await this.#client.send(
        new DestinationAbsentCopyObjectCommand({
          Bucket: this.#bucket(object.bucketRole),
          Key: object.recoveryKey,
          CopySource: encodeCopySource(this.#bucket(object.bucketRole), object.sourceKey),
          CopySourceIfMatch: source.etag,
          MetadataDirective: "COPY",
        }),
      );
      return {
        observation: await this.#observe(object, object.recoveryKey, "QUARANTINE_PROOF_MISMATCH"),
        reconciled: false,
      };
    } catch (error) {
      if (error instanceof Sk90ResetSafetyError) throw error;
      const after = await this.#headOrNull(object, object.recoveryKey, "QUARANTINE_PROOF_MISMATCH");
      if (!after) stop("QUARANTINE_PROOF_MISMATCH");
      return {
        observation: await this.#observe(object, object.recoveryKey, "QUARANTINE_PROOF_MISMATCH"),
        reconciled: true,
      };
    }
  }

  async #deleteSource(
    object: ExactResetObject,
    source: ExactObservation,
    artifactDigest: Sha256Digest,
    restorePointFingerprint: Sha256Digest,
    assertAuthorizationFresh: AuthorizationFreshnessCheck,
    assertNoWriterMaintenanceAuthorization: NoWriterMaintenanceAuthorizationCheck,
  ): Promise<boolean> {
    await safe(async () => {
      await assertAuthorizationFresh();
    }, "FRESH_TARGET_AUTHORIZATION_INVALID");
    await safe(async () => {
      await assertNoWriterMaintenanceAuthorization({
        contract: "sk104-storage-no-writer-mutation-v1",
        action: "delete_source",
        maintenanceMode: "writers_blocked",
        targetStorageFingerprint: this.#targetFingerprint,
        artifactDigest,
        restorePointFingerprint,
        protectedSourceKey: object.protectedSourceKey,
        protectedRecoveryKey: object.protectedRecoveryKey,
        expectedSourceVersionFingerprint: sha256Digest(source.etag),
      });
    }, "FRESH_TARGET_AUTHORIZATION_INVALID");
    // Cloudflare documents no conditional DeleteObject header. After the
    // no-writer proof, re-observe the exact source and recovery and repeat the
    // freshness check immediately before the exact-key DeleteObject request.
    const authorizedSource = await this.#observe(object, object.sourceKey, "STORAGE_OBJECT_DRIFT");
    if (
      authorizedSource.etag !== source.etag ||
      !sameDigest(authorizedSource.contentFingerprint, source.contentFingerprint) ||
      !sameDigest(authorizedSource.metadataFingerprint, source.metadataFingerprint)
    ) {
      stop("STORAGE_OBJECT_DRIFT");
    }
    await this.#observe(object, object.recoveryKey, "QUARANTINE_PROOF_MISMATCH");
    await safe(async () => {
      await assertAuthorizationFresh();
    }, "FRESH_TARGET_AUTHORIZATION_INVALID");
    try {
      await this.#client.send(
        new DeleteObjectCommand({
          Bucket: this.#bucket(object.bucketRole),
          Key: object.sourceKey,
        }),
      );
    } catch (error) {
      if (error instanceof Sk90ResetSafetyError) throw error;
      if ((await this.#headOrNull(object, object.sourceKey, "STORAGE_OBJECT_DRIFT")) !== null) {
        stop("STORAGE_OBJECT_DRIFT");
      }
      return true;
    }
    if ((await this.#headOrNull(object, object.sourceKey, "STORAGE_OBJECT_DRIFT")) !== null) {
      stop("STORAGE_OBJECT_DRIFT");
    }
    return false;
  }

  async prepareResetObjectRecovery(
    input: Readonly<{
      envelope: PrivateExecutionEnvelope;
      expectedTargetFingerprint: Sha256Digest;
      expectedRestorePointFingerprint: Sha256Digest;
      hmacKey: string;
      assertAuthorizationFresh: AuthorizationFreshnessCheck;
    }>,
  ): Promise<Sk104StorageRestorePointReceipt> {
    if (typeof input.assertAuthorizationFresh !== "function") {
      stop("FRESH_TARGET_AUTHORIZATION_INVALID");
    }
    const checked = assertPrivateExecutionEnvelope(input.envelope, input.hmacKey);
    const targetStorageFingerprint = this.#assertExpectedTarget(
      input.expectedTargetFingerprint,
    );
    const exactObjects = exactResetObjects(checked, input.hmacKey, this.#recoveryPrefix);
    assertSha256Digest(input.expectedRestorePointFingerprint);
    const expectedRestorePoint = restorePointReceipt(
      checked.artifactDigest,
      targetStorageFingerprint,
      exactObjects,
    );
    if (
      !sameDigest(
        expectedRestorePoint.restorePointFingerprint,
        input.expectedRestorePointFingerprint,
      )
    ) {
      stop("QUARANTINE_PROOF_MISMATCH");
    }
    const sources = new Map<ProtectedToken, ExactObservation>();

    // Preparation is non-destructive. Every source must still exist and must
    // receive one exact, conditionally-created recovery copy.
    for (const object of exactObjects) {
      if ((await this.#headOrNull(object, object.sourceKey, "STORAGE_OBJECT_DRIFT")) === null) {
        stop("STORAGE_OBJECT_MISSING");
      }
      const source = await this.#observe(object, object.sourceKey, "STORAGE_OBJECT_DRIFT");
      sources.set(object.protectedSourceKey, source);
      const recovery = await this.#ensureRecoveryCopy(
        object,
        source,
        input.assertAuthorizationFresh,
      );
      if (
        !sameDigest(recovery.observation.contentFingerprint, source.contentFingerprint) ||
        !sameDigest(recovery.observation.metadataFingerprint, source.metadataFingerprint) ||
        recovery.observation.sizeBytes !== source.sizeBytes
      ) {
        stop("QUARANTINE_PROOF_MISMATCH");
      }
    }

    // Re-read the complete source and recovery sets after every copy. The
    // returned fingerprint therefore describes one stable restore point.
    for (const object of exactObjects) {
      const source = sources.get(object.protectedSourceKey);
      if (!source) stop("QUARANTINE_PROOF_MISMATCH");
      const currentSource = await this.#observe(object, object.sourceKey, "STORAGE_OBJECT_DRIFT");
      if (currentSource.etag !== source.etag) stop("STORAGE_OBJECT_DRIFT");
      const recovery = await this.#observe(object, object.recoveryKey, "QUARANTINE_PROOF_MISMATCH");
      if (
        !sameDigest(recovery.contentFingerprint, source.contentFingerprint) ||
        !sameDigest(recovery.metadataFingerprint, source.metadataFingerprint) ||
        recovery.sizeBytes !== source.sizeBytes
      ) {
        stop("QUARANTINE_PROOF_MISMATCH");
      }
    }

    return expectedRestorePoint;
  }

  async #verifyExactSourceState(
    exactObjects: readonly ExactResetObject[],
    artifactDigest: Sha256Digest,
    targetStorageFingerprint: Sha256Digest,
    restorePointFingerprint: Sha256Digest,
    expectedSourceState: "absent" | "restored",
  ): Promise<Sk104StorageVerificationReceipt> {
    for (const object of exactObjects) {
      await this.#observe(object, object.recoveryKey, "QUARANTINE_PROOF_MISMATCH");
      const sourceHead = await this.#headOrNull(object, object.sourceKey, "STORAGE_OBJECT_DRIFT");
      if (expectedSourceState === "absent") {
        if (sourceHead !== null) stop("STORAGE_OBJECT_DRIFT");
      } else {
        await this.#observe(object, object.sourceKey, "RESTORE_PROOF_MISMATCH");
      }
    }
    return verificationReceipt(
      artifactDigest,
      targetStorageFingerprint,
      restorePointFingerprint,
      expectedSourceState,
    );
  }

  async verifyResetSourcesAbsent(
    input: Readonly<{
      envelope: PrivateExecutionEnvelope;
      expectedTargetFingerprint: Sha256Digest;
      hmacKey: string;
      expectedRestorePointFingerprint: Sha256Digest;
    }>,
  ): Promise<Sk104StorageVerificationReceipt> {
    const checked = assertPrivateExecutionEnvelope(input.envelope, input.hmacKey);
    const targetStorageFingerprint = this.#assertExpectedTarget(
      input.expectedTargetFingerprint,
    );
    assertSha256Digest(input.expectedRestorePointFingerprint);
    const exactObjects = exactResetObjects(checked, input.hmacKey, this.#recoveryPrefix);
    const expected = restorePointReceipt(
      checked.artifactDigest,
      targetStorageFingerprint,
      exactObjects,
    );
    if (!sameDigest(expected.restorePointFingerprint, input.expectedRestorePointFingerprint)) {
      stop("QUARANTINE_PROOF_MISMATCH");
    }
    return this.#verifyExactSourceState(
      exactObjects,
      checked.artifactDigest,
      targetStorageFingerprint,
      input.expectedRestorePointFingerprint,
      "absent",
    );
  }

  async verifyResetSourcesRestored(
    input: Readonly<{
      envelope: PrivateExecutionEnvelope;
      expectedTargetFingerprint: Sha256Digest;
      hmacKey: string;
      expectedRestorePointFingerprint: Sha256Digest;
    }>,
  ): Promise<Sk104StorageVerificationReceipt> {
    const checked = assertPrivateExecutionEnvelope(input.envelope, input.hmacKey);
    const targetStorageFingerprint = this.#assertExpectedTarget(
      input.expectedTargetFingerprint,
    );
    assertSha256Digest(input.expectedRestorePointFingerprint);
    const exactObjects = exactResetObjects(checked, input.hmacKey, this.#recoveryPrefix);
    const expected = restorePointReceipt(
      checked.artifactDigest,
      targetStorageFingerprint,
      exactObjects,
    );
    if (!sameDigest(expected.restorePointFingerprint, input.expectedRestorePointFingerprint)) {
      stop("QUARANTINE_PROOF_MISMATCH");
    }
    return this.#verifyExactSourceState(
      exactObjects,
      checked.artifactDigest,
      targetStorageFingerprint,
      input.expectedRestorePointFingerprint,
      "restored",
    );
  }

  async deletePreparedResetObjects(
    input: Readonly<{
      envelope: PrivateExecutionEnvelope;
      expectedTargetFingerprint: Sha256Digest;
      hmacKey: string;
      expectedRestorePointFingerprint: Sha256Digest;
      /** Durable outer journal proof that at least one source delete was attempted. */
      mutationStarted: boolean;
      assertAuthorizationFresh: AuthorizationFreshnessCheck;
      assertNoWriterMaintenanceAuthorization: NoWriterMaintenanceAuthorizationCheck;
    }>,
  ): Promise<Sk104ProductionStorageReceipt> {
    if (
      typeof input.assertAuthorizationFresh !== "function" ||
      typeof input.assertNoWriterMaintenanceAuthorization !== "function"
    ) {
      stop("FRESH_TARGET_AUTHORIZATION_INVALID");
    }
    const checked = assertPrivateExecutionEnvelope(input.envelope, input.hmacKey);
    const targetStorageFingerprint = this.#assertExpectedTarget(
      input.expectedTargetFingerprint,
    );
    assertSha256Digest(input.expectedRestorePointFingerprint);
    if (typeof input.mutationStarted !== "boolean") stop("PHASE_STATE_INVALID");
    const exactObjects = exactResetObjects(checked, input.hmacKey, this.#recoveryPrefix);
    const expectedRestorePoint = restorePointReceipt(
      checked.artifactDigest,
      targetStorageFingerprint,
      exactObjects,
    );
    if (
      !sameDigest(
        expectedRestorePoint.restorePointFingerprint,
        input.expectedRestorePointFingerprint,
      )
    ) {
      stop("QUARANTINE_PROOF_MISMATCH");
    }
    const prepared: PreparedResetObject[] = [];
    const receipts: Sk104ProductionStorageObjectReceipt[] = [];

    // Verify the complete approved recovery set without creating anything.
    // A single absent or drifted copy stops before the first source delete.
    for (const object of exactObjects) {
      await this.#observe(object, object.recoveryKey, "QUARANTINE_PROOF_MISMATCH");
      const sourceHead = await this.#headOrNull(object, object.sourceKey, "STORAGE_OBJECT_DRIFT");
      if (!sourceHead) {
        if (!input.mutationStarted) stop("STORAGE_OBJECT_MISSING");
        prepared.push({ object, source: null, copyReconciled: true });
        continue;
      }
      prepared.push({
        object,
        source: await this.#observe(object, object.sourceKey, "STORAGE_OBJECT_DRIFT"),
        copyReconciled: true,
      });
    }

    // Delete only the exact source identities proven above. The no-writer
    // authorization path re-reads both sides immediately before each plain
    // exact-key delete.
    for (const item of prepared) {
      const { object, source } = item;
      if (source === null) {
        await this.#observe(object, object.recoveryKey, "QUARANTINE_PROOF_MISMATCH");
        receipts.push({
          bucketRole: object.bucketRole,
          protectedSourceKey: object.protectedSourceKey,
          protectedRecoveryKey: object.protectedRecoveryKey,
          contentFingerprint: object.contentFingerprint,
          metadataFingerprint: object.metadataFingerprint,
          recoveryVerified: true,
          sourceDeleted: true,
          copyReconciled: true,
          deleteReconciled: true,
        });
        continue;
      }
      const currentSource = await this.#observe(object, object.sourceKey, "STORAGE_OBJECT_DRIFT");
      if (currentSource.etag !== source.etag) stop("STORAGE_OBJECT_DRIFT");
      await this.#observe(object, object.recoveryKey, "QUARANTINE_PROOF_MISMATCH");
      const deleteReconciled = await this.#deleteSource(
        object,
        currentSource,
        checked.artifactDigest,
        input.expectedRestorePointFingerprint,
        input.assertAuthorizationFresh,
        input.assertNoWriterMaintenanceAuthorization,
      );
      receipts.push({
        bucketRole: object.bucketRole,
        protectedSourceKey: object.protectedSourceKey,
        protectedRecoveryKey: object.protectedRecoveryKey,
        contentFingerprint: object.contentFingerprint,
        metadataFingerprint: object.metadataFingerprint,
        recoveryVerified: true,
        sourceDeleted: true,
        copyReconciled: item.copyReconciled,
        deleteReconciled,
      });
    }

    await this.#verifyExactSourceState(
      exactObjects,
      checked.artifactDigest,
      targetStorageFingerprint,
      input.expectedRestorePointFingerprint,
      "absent",
    );

    const body = {
      contract: "sk104-production-storage-receipt-v1" as const,
      artifactDigest: checked.artifactDigest,
      targetStorageFingerprint,
      objectCount: receipts.length,
      copiedCount: receipts.length,
      copyReconciledCount: receipts.filter((receipt) => receipt.copyReconciled).length,
      deletedCount: receipts.length,
      deleteReconciledCount: receipts.filter((receipt) => receipt.deleteReconciled).length,
      objects: receipts,
    };
    return { ...body, receiptDigest: sha256Digest(canonicalJson(body)) };
  }

  async restoreResetObjectsFromRecovery(
    input: Readonly<{
      envelope: PrivateExecutionEnvelope;
      expectedTargetFingerprint: Sha256Digest;
      hmacKey: string;
      expectedRestorePointFingerprint: Sha256Digest;
      assertAuthorizationFresh: AuthorizationFreshnessCheck;
    }>,
  ): Promise<Sk104StorageRestoreReceipt> {
    if (typeof input.assertAuthorizationFresh !== "function") {
      stop("FRESH_TARGET_AUTHORIZATION_INVALID");
    }
    const checked = assertPrivateExecutionEnvelope(input.envelope, input.hmacKey);
    const targetStorageFingerprint = this.#assertExpectedTarget(
      input.expectedTargetFingerprint,
    );
    assertSha256Digest(input.expectedRestorePointFingerprint);
    const exactObjects = exactResetObjects(checked, input.hmacKey, this.#recoveryPrefix);
    const expected = restorePointReceipt(
      checked.artifactDigest,
      targetStorageFingerprint,
      exactObjects,
    );
    if (!sameDigest(expected.restorePointFingerprint, input.expectedRestorePointFingerprint)) {
      stop("RESTORE_PROOF_MISMATCH");
    }

    const sources = new Map<ProtectedToken, ExactObservation | null>();
    // Verify all nine recovery objects before the first restore copy.
    for (const object of exactObjects) {
      await this.#observe(object, object.recoveryKey, "RESTORE_PROOF_MISMATCH");
      const sourceHead = await this.#headOrNull(object, object.sourceKey, "RESTORE_PROOF_MISMATCH");
      sources.set(
        object.protectedSourceKey,
        sourceHead === null
          ? null
          : await this.#observe(object, object.sourceKey, "RESTORE_PROOF_MISMATCH"),
      );
    }

    const receipts: Sk104StorageRestoreObjectReceipt[] = [];
    for (const object of exactObjects) {
      const existingSource = sources.get(object.protectedSourceKey);
      if (existingSource === undefined) stop("RESTORE_PROOF_MISMATCH");
      let copyReconciled = existingSource !== null;
      if (existingSource === null) {
        await safe(async () => {
          await input.assertAuthorizationFresh();
        }, "FRESH_TARGET_AUTHORIZATION_INVALID");
        const recovery = await this.#observe(object, object.recoveryKey, "RESTORE_PROOF_MISMATCH");
        if ((await this.#headOrNull(object, object.sourceKey, "RESTORE_PROOF_MISMATCH")) !== null) {
          stop("RESTORE_PROOF_MISMATCH");
        }
        await safe(async () => {
          await input.assertAuthorizationFresh();
        }, "FRESH_TARGET_AUTHORIZATION_INVALID");
        try {
          await this.#client.send(
            new DestinationAbsentCopyObjectCommand({
              Bucket: this.#bucket(object.bucketRole),
              Key: object.sourceKey,
              CopySource: encodeCopySource(this.#bucket(object.bucketRole), object.recoveryKey),
              CopySourceIfMatch: recovery.etag,
              MetadataDirective: "COPY",
            }),
          );
        } catch (error) {
          if (error instanceof Sk90ResetSafetyError) throw error;
          if (
            (await this.#headOrNull(object, object.sourceKey, "RESTORE_PROOF_MISMATCH")) === null
          ) {
            stop("RESTORE_PROOF_MISMATCH");
          }
          copyReconciled = true;
        }
      }
      await this.#observe(object, object.sourceKey, "RESTORE_PROOF_MISMATCH");
      await this.#observe(object, object.recoveryKey, "RESTORE_PROOF_MISMATCH");
      receipts.push({
        bucketRole: object.bucketRole,
        protectedSourceKey: object.protectedSourceKey,
        protectedRecoveryKey: object.protectedRecoveryKey,
        contentFingerprint: object.contentFingerprint,
        metadataFingerprint: object.metadataFingerprint,
        sourceRestored: true,
        recoveryRetained: true,
        copyReconciled,
      });
    }

    await this.#verifyExactSourceState(
      exactObjects,
      checked.artifactDigest,
      targetStorageFingerprint,
      input.expectedRestorePointFingerprint,
      "restored",
    );
    const body = {
      contract: "sk104-production-storage-restore-receipt-v1" as const,
      artifactDigest: checked.artifactDigest,
      targetStorageFingerprint,
      restorePointFingerprint: input.expectedRestorePointFingerprint,
      objectCount: 9 as const,
      restoredCount: 9 as const,
      recoveryRetainedCount: 9 as const,
      objects: receipts,
    };
    return { ...body, receiptDigest: sha256Digest(canonicalJson(body)) };
  }
}

export function createSk104ProductionStorageAdapter(
  config: Sk104ProductionStorageConfig,
): Sk104ProductionStorageAdapter {
  return new Sk104ProductionStorageAdapter(config);
}
