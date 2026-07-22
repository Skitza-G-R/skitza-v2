import { createHash } from "node:crypto";

import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";

import { protectValue, sha256Digest, type Sha256Digest } from "../sk90-reset/canonical";
import {
  bindPrivateExecutionEnvelope,
  type PrivateExecutionEnvelope,
  type PrivateStorageObject,
  type PrivateStorageReference,
} from "../sk90-reset/private-envelope";
import { fingerprintStorageMetadata } from "../sk90-reset/r2-rehearsal";
import type { StorageBucketRole, StorageObjectMetadata } from "../sk90-reset/storage-port";
import {
  createSk104ProductionStorageAdapter,
  sk104ProductionStorageTargetFingerprint,
  type Sk104NoWriterMaintenanceAuthorizationBinding,
  type Sk104StorageClient,
} from "./storage";

const HMAC_KEY = "sk104-private-envelope-test-hmac-key-long-enough";
const ARTIFACT_DIGEST = sha256Digest("sk104-production-artifact");
const BUCKETS = { audio: "private-audio", docs: "private-docs" } as const;
const ENDPOINT = `https://${"a".repeat(32)}.r2.cloudflarestorage.com`;
const TARGET_FINGERPRINT = sk104ProductionStorageTargetFingerprint({
  endpoint: ENDPOINT,
  buckets: BUCKETS,
});
const FORBIDDEN_TARGET_FINGERPRINT = sk104ProductionStorageTargetFingerprint({
  endpoint: `https://${"b".repeat(32)}.r2.cloudflarestorage.com`,
  buckets: BUCKETS,
});
const RECOVERY_PREFIX = "sk104-cutover/approved-live/recovery/";
const DEFAULT_METADATA: StorageObjectMetadata = {
  cacheControl: "private, no-store",
  contentDisposition: null,
  contentEncoding: null,
  contentLanguage: null,
  contentType: "application/octet-stream",
  expiresAt: null,
  custom: [["skitza-test", "yes"]],
};

type StoredObject = Readonly<{
  bytes: Uint8Array;
  etag: string;
  metadata: StorageObjectMetadata;
}>;

type ObjectFixture = Readonly<{
  object: PrivateStorageObject;
  bytes: Uint8Array;
}>;

function digestBytes(bytes: Uint8Array): Sha256Digest {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function metadataOutput(metadata: StorageObjectMetadata): Record<string, unknown> {
  return {
    CacheControl: metadata.cacheControl ?? undefined,
    ContentDisposition: metadata.contentDisposition ?? undefined,
    ContentEncoding: metadata.contentEncoding ?? undefined,
    ContentLanguage: metadata.contentLanguage ?? undefined,
    ContentType: metadata.contentType ?? undefined,
    Expires: metadata.expiresAt === null ? undefined : new Date(metadata.expiresAt),
    Metadata: Object.fromEntries(metadata.custom),
  };
}

function missing(): Error {
  return Object.assign(new Error("private fake missing"), {
    name: "NotFound",
    $metadata: { httpStatusCode: 404 },
  });
}

function conditionFailed(): Error {
  return Object.assign(new Error("private fake condition failed"), {
    name: "PreconditionFailed",
    $metadata: { httpStatusCode: 412 },
  });
}

function identity(bucket: string, key: string): string {
  return `${bucket}\0${key}`;
}

function decodeCopySource(value: string): Readonly<{ bucket: string; key: string }> {
  const [bucket = "", ...segments] = value.split("/").map(decodeURIComponent);
  return { bucket, key: segments.join("/") };
}

class FakeStorage {
  readonly objects = new Map<string, StoredObject>();
  readonly commands: Readonly<Record<string, unknown>>[] = [];
  throwAfterCopy = false;
  throwAfterDelete = false;
  dualStreamingBody = false;
  transformToByteArrayCalls = 0;
  #copyThrew = false;
  #deleteThrew = false;
  #etag = 100;

  put(bucket: string, key: string, bytes: Uint8Array, metadata = DEFAULT_METADATA): void {
    this.objects.set(identity(bucket, key), {
      bytes: new Uint8Array(bytes),
      etag: `"etag-${String(this.#etag++)}"`,
      metadata,
    });
  }

  has(bucket: string, key: string): boolean {
    return this.objects.has(identity(bucket, key));
  }

  remove(bucket: string, key: string): void {
    this.objects.delete(identity(bucket, key));
  }

  asClient(): Sk104StorageClient {
    return this as unknown as Sk104StorageClient;
  }

  async send(command: unknown): Promise<Record<string, unknown>> {
    await Promise.resolve();
    const input = (command as { input: Record<string, unknown> }).input;
    this.commands.push({
      name:
        command instanceof CopyObjectCommand
          ? "CopyObjectCommand"
          : (command as object).constructor.name,
      ...input,
    });
    const bucket = input.Bucket as string;
    const key = input.Key as string;
    const current = this.objects.get(identity(bucket, key));

    if (command instanceof HeadObjectCommand) {
      if (!current) throw missing();
      return {
        ETag: current.etag,
        ContentLength: current.bytes.byteLength,
        ...metadataOutput(current.metadata),
      };
    }
    if (command instanceof GetObjectCommand) {
      if (!current) throw missing();
      if (input.IfMatch !== current.etag) throw conditionFailed();
      return {
        ETag: current.etag,
        ContentLength: current.bytes.byteLength,
        Body: this.dualStreamingBody
          ? {
              [Symbol.asyncIterator]: async function* () {
                await Promise.resolve();
                const middle = Math.max(1, Math.floor(current.bytes.byteLength / 2));
                yield current.bytes.slice(0, middle);
                yield current.bytes.slice(middle);
              },
              transformToByteArray: async () => {
                await Promise.resolve();
                this.transformToByteArrayCalls += 1;
                throw new Error("streaming body must not be buffered");
              },
            }
          : new Uint8Array(current.bytes),
        ...metadataOutput(current.metadata),
      };
    }
    if (command instanceof CopyObjectCommand) {
      expect(Reflect.get(command as object, "destinationCondition")).toEqual({
        header: "cf-copy-destination-if-none-match",
        value: "*",
      });
      if (current) throw conditionFailed();
      const source = decodeCopySource(input.CopySource as string);
      const sourceObject = this.objects.get(identity(source.bucket, source.key));
      if (!sourceObject || input.CopySourceIfMatch !== sourceObject.etag) throw conditionFailed();
      this.put(bucket, key, sourceObject.bytes, sourceObject.metadata);
      if (this.throwAfterCopy && !this.#copyThrew) {
        this.#copyThrew = true;
        throw new Error("ambiguous private fake copy");
      }
      return { CopyObjectResult: { ETag: this.objects.get(identity(bucket, key))?.etag } };
    }
    if (command instanceof DeleteObjectCommand) {
      if (!current) throw conditionFailed();
      expect(input.IfMatch).toBeUndefined();
      this.objects.delete(identity(bucket, key));
      if (this.throwAfterDelete && !this.#deleteThrew) {
        this.#deleteThrew = true;
        throw new Error("ambiguous private fake delete");
      }
      return {};
    }
    throw new Error("broad or unknown storage operation");
  }
}

function privateObject(
  bucketRole: StorageBucketRole,
  key: string,
  bytes: Uint8Array,
  ownership: PrivateStorageObject["ownership"] = "reset_exclusive",
): PrivateStorageObject {
  return {
    bucketRole,
    key,
    ownership,
    sizeBytes: bytes.byteLength,
    contentFingerprint: digestBytes(bytes),
    metadataFingerprint: fingerprintStorageMetadata(DEFAULT_METADATA),
  };
}

function resetFixtures(
  primary: readonly Readonly<{
    bucketRole: StorageBucketRole;
    key: string;
    bytes: Uint8Array;
  }>[],
): ObjectFixture[] {
  const fixtures = primary.map((item) => ({
    object: privateObject(item.bucketRole, item.key, item.bytes),
    bytes: item.bytes,
  }));
  for (let index = fixtures.length; index < 9; index += 1) {
    const bucketRole: StorageBucketRole = index % 2 === 0 ? "audio" : "docs";
    const bytes = new TextEncoder().encode(`approved reset object ${String(index)}`);
    fixtures.push({
      object: privateObject(
        bucketRole,
        `producers/reset-${String(index)}/approved/object-${String(index)}`,
        bytes,
      ),
      bytes,
    });
  }
  return fixtures;
}

function seedSources(storage: FakeStorage, fixtures: readonly ObjectFixture[]): void {
  for (const fixture of fixtures) {
    storage.put(BUCKETS[fixture.object.bucketRole], fixture.object.key, fixture.bytes);
  }
}

function providers(): Parameters<typeof bindPrivateExecutionEnvelope>[0]["providerReferences"] {
  const base = {
    mode: "test" as const,
    attested: true as const,
    chargeEnabled: false as const,
    externalCharge: false as const,
    liveSchedule: false as const,
  };
  return [
    ...[1, 2, 3].map((index) => ({
      ...base,
      sourceKind: "producer_stripe_account" as const,
      ownerId: `10000000-0000-4000-8000-00000000000${String(index)}`,
      providerValue: `acct_test_${String(index)}`,
      provider: "stripe" as const,
    })),
    ...[4, 5, 6, 7].map((index) => ({
      ...base,
      sourceKind: "booking_tranzila_confirmation" as const,
      ownerId: `10000000-0000-4000-8000-00000000000${String(index)}`,
      providerValue: `tranzila-test-${String(index)}`,
      provider: "tranzila" as const,
    })),
  ];
}

function envelope(
  objects: readonly PrivateStorageObject[],
  references: readonly PrivateStorageReference[] = objects.map((object) => ({
    bucketRole: object.bucketRole,
    key: object.key,
    referencedBy: object.ownership === "reset_exclusive" ? "reset" : "preserved",
  })),
): PrivateExecutionEnvelope {
  return bindPrivateExecutionEnvelope(
    {
      artifactDigest: ARTIFACT_DIGEST,
      manifestDigest: sha256Digest("manifest"),
      targetPolicyDigest: sha256Digest("production-target"),
      rows: [],
      storageReferences: references,
      storageObjects: objects,
      providerReferences: providers(),
    },
    HMAC_KEY,
  );
}

function recoveryKey(bucketRole: StorageBucketRole, sourceKey: string): string {
  const sourceToken = protectValue(HMAC_KEY, `storage-key\0${bucketRole}\0${sourceKey}`);
  return `${RECOVERY_PREFIX}${ARTIFACT_DIGEST.slice("sha256:".length)}/${bucketRole}/${sourceToken.slice("hmac-sha256:".length)}`;
}

function adapter(storage: FakeStorage) {
  return createSk104ProductionStorageAdapter({
    targetClass: "canonical_production",
    endpoint: ENDPOINT,
    buckets: BUCKETS,
    recoveryPrefix: RECOVERY_PREFIX,
    approvedTargetFingerprint: TARGET_FINGERPRINT,
    forbiddenTargetFingerprint: FORBIDDEN_TARGET_FINGERPRINT,
    clientFactory: () => storage.asClient(),
  });
}

async function prepareRecovery(
  cutover: ReturnType<typeof adapter>,
  input: Omit<
    Parameters<ReturnType<typeof adapter>["prepareResetObjectRecovery"]>[0],
    "expectedRestorePointFingerprint"
  >,
) {
  const planned = cutover.planResetObjectRecovery({
    envelope: input.envelope,
    expectedTargetFingerprint: input.expectedTargetFingerprint,
    hmacKey: input.hmacKey,
  });
  return cutover.prepareResetObjectRecovery({
    ...input,
    expectedRestorePointFingerprint: planned.restorePointFingerprint,
  });
}

function noWriters(
  observed: Sk104NoWriterMaintenanceAuthorizationBinding[] = [],
): (binding: Sk104NoWriterMaintenanceAuthorizationBinding) => void {
  return (binding) => {
    expect(binding).toMatchObject({
      contract: "sk104-storage-no-writer-mutation-v1",
      action: "delete_source",
      maintenanceMode: "writers_blocked",
      targetStorageFingerprint: TARGET_FINGERPRINT,
      artifactDigest: ARTIFACT_DIGEST,
    });
    observed.push(binding);
  };
}

describe("SK-104 exact production storage cutover", () => {
  it.each([
    {
      name: "unapproved",
      endpoint: `https://${"c".repeat(32)}.r2.cloudflarestorage.com`,
      buckets: BUCKETS,
      approved: TARGET_FINGERPRINT,
      forbidden: FORBIDDEN_TARGET_FINGERPRINT,
      code: "STORAGE_TARGET_MISMATCH",
    },
    {
      name: "forbidden",
      endpoint: `https://${"b".repeat(32)}.r2.cloudflarestorage.com`,
      buckets: BUCKETS,
      approved: TARGET_FINGERPRINT,
      forbidden: FORBIDDEN_TARGET_FINGERPRINT,
      code: "STORAGE_TARGET_FORBIDDEN",
    },
    {
      name: "wrong-bucket",
      endpoint: ENDPOINT,
      buckets: { audio: "wrong-private-audio", docs: BUCKETS.docs },
      approved: TARGET_FINGERPRINT,
      forbidden: FORBIDDEN_TARGET_FINGERPRINT,
      code: "STORAGE_TARGET_MISMATCH",
    },
  ])("rejects a $name storage target before client creation or calls", (candidate) => {
    const storage = new FakeStorage();
    const clientFactory = vi.fn(() => storage.asClient());

    expect(() =>
      createSk104ProductionStorageAdapter({
        targetClass: "canonical_production",
        endpoint: candidate.endpoint,
        buckets: candidate.buckets,
        recoveryPrefix: RECOVERY_PREFIX,
        approvedTargetFingerprint: candidate.approved,
        forbiddenTargetFingerprint: candidate.forbidden,
        clientFactory,
      }),
    ).toThrow(expect.objectContaining({ code: candidate.code }));
    expect(clientFactory).not.toHaveBeenCalled();
    expect(storage.commands).toHaveLength(0);
  });

  it("copies, verifies, and deletes only exact reset-owned envelope objects", async () => {
    const storage = new FakeStorage();
    const resetAudioKey = "producers/reset/tracks/version/audio.wav";
    const resetDocsKey = "producers/reset/proofs/request/final/proof.pdf";
    const preservedKey = "producers/preserved/tracks/version/audio.wav";
    const audioBytes = new TextEncoder().encode("approved reset audio");
    const docsBytes = new TextEncoder().encode("approved reset proof");
    const preservedBytes = new TextEncoder().encode("preserve me");
    const reset = resetFixtures([
      { bucketRole: "audio", key: resetAudioKey, bytes: audioBytes },
      { bucketRole: "docs", key: resetDocsKey, bytes: docsBytes },
    ]);
    const objects = [
      ...reset.map((fixture) => fixture.object),
      privateObject("audio", preservedKey, preservedBytes, "preserved_only"),
    ];
    seedSources(storage, reset);
    storage.put(BUCKETS.audio, preservedKey, preservedBytes);
    const freshness = vi.fn();
    const noWriterBindings: Sk104NoWriterMaintenanceAuthorizationBinding[] = [];
    const cutover = adapter(storage);

    const prepared = await prepareRecovery(cutover, {
      envelope: envelope(objects),
      expectedTargetFingerprint: TARGET_FINGERPRINT,
      hmacKey: HMAC_KEY,
      assertAuthorizationFresh: freshness,
    });
    expect(prepared.objectCount).toBe(9);
    expect(storage.commands.some((command) => command.name === "DeleteObjectCommand")).toBe(false);
    expect(JSON.stringify(prepared)).not.toContain(resetAudioKey);
    const preparedAgain = await prepareRecovery(cutover, {
      envelope: envelope(objects),
      expectedTargetFingerprint: TARGET_FINGERPRINT,
      hmacKey: HMAC_KEY,
      assertAuthorizationFresh: freshness,
    });
    expect(preparedAgain).toEqual(prepared);
    const copiesBeforeDelete = storage.commands.filter(
      (command) => command.name === "CopyObjectCommand",
    ).length;

    const receipt = await cutover.deletePreparedResetObjects({
      envelope: envelope(objects),
      expectedTargetFingerprint: TARGET_FINGERPRINT,
      hmacKey: HMAC_KEY,
      expectedRestorePointFingerprint: prepared.restorePointFingerprint,
      mutationStarted: false,
      assertAuthorizationFresh: freshness,
      assertNoWriterMaintenanceAuthorization: noWriters(noWriterBindings),
    });

    expect(receipt.objectCount).toBe(9);
    expect(receipt.copiedCount).toBe(9);
    expect(receipt.deletedCount).toBe(9);
    expect(storage.commands.filter((command) => command.name === "CopyObjectCommand")).toHaveLength(
      copiesBeforeDelete,
    );
    expect(freshness).toHaveBeenCalledTimes(27);
    expect(noWriterBindings).toHaveLength(9);
    expect(new Set(noWriterBindings.map((binding) => binding.protectedSourceKey)).size).toBe(9);
    expect(storage.has(BUCKETS.audio, resetAudioKey)).toBe(false);
    expect(storage.has(BUCKETS.docs, resetDocsKey)).toBe(false);
    expect(storage.has(BUCKETS.audio, preservedKey)).toBe(true);
    expect(storage.has(BUCKETS.audio, recoveryKey("audio", resetAudioKey))).toBe(true);
    expect(storage.has(BUCKETS.docs, recoveryKey("docs", resetDocsKey))).toBe(true);
    expect(storage.commands.some((command) => String(command.name).startsWith("List"))).toBe(false);
    const deletes = storage.commands
      .filter((command) => command.name === "DeleteObjectCommand")
      .map((command) => [command.Bucket, command.Key]);
    expect(deletes).toHaveLength(9);
    for (const fixture of reset) {
      expect(deletes).toContainEqual([BUCKETS[fixture.object.bucketRole], fixture.object.key]);
    }
    expect(deletes).not.toContainEqual([BUCKETS.audio, preservedKey]);
    const firstDeleteIndex = storage.commands.findIndex(
      (command) => command.name === "DeleteObjectCommand",
    );
    expect(firstDeleteIndex).toBeGreaterThan(-1);
    const beforeFirstDelete = storage.commands.slice(0, firstDeleteIndex);
    expect(
      beforeFirstDelete.filter((command) => command.name === "CopyObjectCommand"),
    ).toHaveLength(9);
    for (const fixture of reset) {
      expect(beforeFirstDelete).toContainEqual(
        expect.objectContaining({
          name: "GetObjectCommand",
          Bucket: BUCKETS[fixture.object.bucketRole],
          Key: recoveryKey(fixture.object.bucketRole, fixture.object.key),
        }),
      );
    }
    const publicReceipt = JSON.stringify(receipt);
    expect(publicReceipt).not.toContain(resetAudioKey);
    expect(publicReceipt).not.toContain(resetDocsKey);
    expect(publicReceipt).not.toContain(preservedKey);
  });

  it("reconciles an ambiguous copy and delete, then resumes without another mutation", async () => {
    const storage = new FakeStorage();
    storage.throwAfterCopy = true;
    storage.throwAfterDelete = true;
    const key = "producers/reset/tracks/version/ambiguous.wav";
    const bytes = new TextEncoder().encode("ambiguous but exact");
    const fixtures = resetFixtures([{ bucketRole: "audio", key, bytes }]);
    const bound = envelope(fixtures.map((fixture) => fixture.object));
    seedSources(storage, fixtures);
    const cutover = adapter(storage);

    const prepared = await prepareRecovery(cutover, {
      envelope: bound,
      expectedTargetFingerprint: TARGET_FINGERPRINT,
      hmacKey: HMAC_KEY,
      assertAuthorizationFresh: vi.fn(),
    });
    const first = await cutover.deletePreparedResetObjects({
      envelope: bound,
      expectedTargetFingerprint: TARGET_FINGERPRINT,
      hmacKey: HMAC_KEY,
      expectedRestorePointFingerprint: prepared.restorePointFingerprint,
      mutationStarted: false,
      assertAuthorizationFresh: vi.fn(),
      assertNoWriterMaintenanceAuthorization: noWriters(),
    });
    expect(first.objects[0]).toMatchObject({ copyReconciled: true, deleteReconciled: true });
    const mutationCount = storage.commands.filter(
      (command) => command.name === "CopyObjectCommand" || command.name === "DeleteObjectCommand",
    ).length;

    const resumed = await cutover.deletePreparedResetObjects({
      envelope: bound,
      expectedTargetFingerprint: TARGET_FINGERPRINT,
      hmacKey: HMAC_KEY,
      expectedRestorePointFingerprint: prepared.restorePointFingerprint,
      mutationStarted: true,
      assertAuthorizationFresh: vi.fn(),
      assertNoWriterMaintenanceAuthorization: noWriters(),
    });
    expect(resumed.objects[0]).toMatchObject({ copyReconciled: true, deleteReconciled: true });
    expect(
      storage.commands.filter(
        (command) => command.name === "CopyObjectCommand" || command.name === "DeleteObjectCommand",
      ),
    ).toHaveLength(mutationCount);
  });

  it("fails closed before delete when an existing recovery copy differs", async () => {
    const storage = new FakeStorage();
    const key = "producers/reset/tracks/version/source.wav";
    const bytes = new TextEncoder().encode("source bytes");
    const fixtures = resetFixtures([{ bucketRole: "audio", key, bytes }]);
    seedSources(storage, fixtures);
    storage.put(BUCKETS.audio, recoveryKey("audio", key), new TextEncoder().encode("wrong bytes"));

    await expect(
      prepareRecovery(adapter(storage), {
        envelope: envelope(fixtures.map((fixture) => fixture.object)),
        expectedTargetFingerprint: TARGET_FINGERPRINT,
        hmacKey: HMAC_KEY,
        assertAuthorizationFresh: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: "QUARANTINE_PROOF_MISMATCH" });
    expect(storage.has(BUCKETS.audio, key)).toBe(true);
    expect(storage.commands.some((command) => command.name === "DeleteObjectCommand")).toBe(false);
  });

  it.each(["missing", "drifted"] as const)(
    "refuses delete when one prepared recovery copy is %s",
    async (failure) => {
      const storage = new FakeStorage();
      const key = "producers/reset/tracks/version/prepared.wav";
      const bytes = new TextEncoder().encode("prepared source");
      const fixtures = resetFixtures([{ bucketRole: "audio", key, bytes }]);
      seedSources(storage, fixtures);
      const bound = envelope(fixtures.map((fixture) => fixture.object));
      const cutover = adapter(storage);
      const prepared = await prepareRecovery(cutover, {
        envelope: bound,
        expectedTargetFingerprint: TARGET_FINGERPRINT,
        hmacKey: HMAC_KEY,
        assertAuthorizationFresh: vi.fn(),
      });
      const exactRecoveryKey = recoveryKey("audio", key);
      if (failure === "missing") storage.remove(BUCKETS.audio, exactRecoveryKey);
      else {
        storage.put(
          BUCKETS.audio,
          exactRecoveryKey,
          new TextEncoder().encode("drifted prepared copy"),
        );
      }
      const deletesBefore = storage.commands.filter(
        (command) => command.name === "DeleteObjectCommand",
      ).length;

      await expect(
        cutover.deletePreparedResetObjects({
          envelope: bound,
          expectedTargetFingerprint: TARGET_FINGERPRINT,
          hmacKey: HMAC_KEY,
          expectedRestorePointFingerprint: prepared.restorePointFingerprint,
          mutationStarted: false,
          assertAuthorizationFresh: vi.fn(),
          assertNoWriterMaintenanceAuthorization: noWriters(),
        }),
      ).rejects.toMatchObject({ code: "QUARANTINE_PROOF_MISMATCH" });
      expect(
        storage.commands.filter((command) => command.name === "DeleteObjectCommand"),
      ).toHaveLength(deletesBefore);
      expect(storage.has(BUCKETS.audio, key)).toBe(true);
    },
  );

  it("does not reinterpret a missing source as a resume without durable mutation proof", async () => {
    const storage = new FakeStorage();
    const key = "producers/reset/tracks/version/missing.wav";
    const bytes = new TextEncoder().encode("verified recovery only");
    const fixtures = resetFixtures([{ bucketRole: "audio", key, bytes }]);
    seedSources(storage, fixtures);
    const bound = envelope(fixtures.map((fixture) => fixture.object));
    const cutover = adapter(storage);
    const prepared = await prepareRecovery(cutover, {
      envelope: bound,
      expectedTargetFingerprint: TARGET_FINGERPRINT,
      hmacKey: HMAC_KEY,
      assertAuthorizationFresh: vi.fn(),
    });
    storage.remove(BUCKETS.audio, key);

    await expect(
      cutover.deletePreparedResetObjects({
        envelope: bound,
        expectedTargetFingerprint: TARGET_FINGERPRINT,
        hmacKey: HMAC_KEY,
        expectedRestorePointFingerprint: prepared.restorePointFingerprint,
        mutationStarted: false,
        assertAuthorizationFresh: vi.fn(),
        assertNoWriterMaintenanceAuthorization: noWriters(),
      }),
    ).rejects.toMatchObject({ code: "STORAGE_OBJECT_MISSING" });
    expect(storage.commands.some((command) => command.name === "DeleteObjectCommand")).toBe(false);
  });

  it("requires exactly nine reset-owned objects before contacting storage", async () => {
    const storage = new FakeStorage();
    const fixtures = resetFixtures([
      {
        bucketRole: "audio",
        key: "producers/reset/tracks/version/count.wav",
        bytes: new TextEncoder().encode("count"),
      },
    ]).slice(0, 8);

    await expect(
      prepareRecovery(adapter(storage), {
        envelope: envelope(fixtures.map((fixture) => fixture.object)),
        expectedTargetFingerprint: TARGET_FINGERPRINT,
        hmacKey: HMAC_KEY,
        assertAuthorizationFresh: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: "RESET_PLAN_MISMATCH" });
    expect(storage.commands).toHaveLength(0);
  });

  it("rejects shared or unapproved ownership without contacting storage", async () => {
    const storage = new FakeStorage();
    const key = "producers/shared/tracks/version/audio.wav";
    const bytes = new TextEncoder().encode("shared");
    const fixtures = resetFixtures([{ bucketRole: "audio", key, bytes }]);
    const objects = fixtures.map((fixture) => fixture.object);
    const bound = envelope(objects, [
      ...objects.map((object) => ({
        bucketRole: object.bucketRole,
        key: object.key,
        referencedBy: "reset" as const,
      })),
      { bucketRole: "audio", key, referencedBy: "preserved" },
    ]);

    await expect(
      prepareRecovery(adapter(storage), {
        envelope: bound,
        expectedTargetFingerprint: TARGET_FINGERPRINT,
        hmacKey: HMAC_KEY,
        assertAuthorizationFresh: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: "STORAGE_OBJECT_SHARED" });
    expect(storage.commands).toHaveLength(0);
  });

  it("does not expose a raw key when source verification fails", async () => {
    const storage = new FakeStorage();
    const key = "producers/private-name/tracks/private-version/secret.wav";
    const approved = new TextEncoder().encode("approved");
    const fixtures = resetFixtures([{ bucketRole: "audio", key, bytes: approved }]);
    seedSources(storage, fixtures.slice(1));
    storage.put(BUCKETS.audio, key, new TextEncoder().encode("drifted"));

    let failure: unknown;
    try {
      await prepareRecovery(adapter(storage), {
        envelope: envelope(fixtures.map((fixture) => fixture.object)),
        expectedTargetFingerprint: TARGET_FINGERPRINT,
        hmacKey: HMAC_KEY,
        assertAuthorizationFresh: vi.fn(),
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ code: "STORAGE_OBJECT_DRIFT" });
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).not.toContain(key);
    expect(storage.commands.some((command) => command.name === "DeleteObjectCommand")).toBe(false);
  });

  it("sanitizes a freshness-check failure before any storage mutation", async () => {
    const storage = new FakeStorage();
    const key = "producers/private-name/tracks/private-version/freshness.wav";
    const bytes = new TextEncoder().encode("freshness source");
    const fixtures = resetFixtures([{ bucketRole: "audio", key, bytes }]);
    seedSources(storage, fixtures);

    let failure: unknown;
    try {
      await prepareRecovery(adapter(storage), {
        envelope: envelope(fixtures.map((fixture) => fixture.object)),
        expectedTargetFingerprint: TARGET_FINGERPRINT,
        hmacKey: HMAC_KEY,
        assertAuthorizationFresh: () => {
          throw new Error(`stale private key: ${key}`);
        },
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({ code: "FRESH_TARGET_AUTHORIZATION_INVALID" });
    expect((failure as Error).message).not.toContain(key);
    expect(storage.commands.some((command) => command.name === "CopyObjectCommand")).toBe(false);
    expect(storage.commands.some((command) => command.name === "DeleteObjectCommand")).toBe(false);
  });

  it("re-observes after each no-writer authorization and stops a changed source", async () => {
    const storage = new FakeStorage();
    const key = "producers/reset/tracks/version/no-writer.wav";
    const bytes = new TextEncoder().encode("same bytes, changed object version");
    const fixtures = resetFixtures([{ bucketRole: "audio", key, bytes }]);
    seedSources(storage, fixtures);
    const bound = envelope(fixtures.map((fixture) => fixture.object));
    const cutover = adapter(storage);
    const prepared = await prepareRecovery(cutover, {
      envelope: bound,
      expectedTargetFingerprint: TARGET_FINGERPRINT,
      hmacKey: HMAC_KEY,
      assertAuthorizationFresh: vi.fn(),
    });
    const bindings: Sk104NoWriterMaintenanceAuthorizationBinding[] = [];

    await expect(
      cutover.deletePreparedResetObjects({
        envelope: bound,
        expectedTargetFingerprint: TARGET_FINGERPRINT,
        hmacKey: HMAC_KEY,
        expectedRestorePointFingerprint: prepared.restorePointFingerprint,
        mutationStarted: false,
        assertAuthorizationFresh: vi.fn(),
        assertNoWriterMaintenanceAuthorization: (binding) => {
          noWriters(bindings)(binding);
          if (bindings.length === 1) {
            for (const fixture of fixtures) {
              storage.put(BUCKETS[fixture.object.bucketRole], fixture.object.key, fixture.bytes);
            }
          }
        },
      }),
    ).rejects.toMatchObject({ code: "STORAGE_OBJECT_DRIFT" });
    expect(bindings).toHaveLength(1);
    expect(storage.commands.some((command) => command.name === "DeleteObjectCommand")).toBe(false);
  });

  it("rechecks approval immediately before deleting a source", async () => {
    const storage = new FakeStorage();
    const fixtures = resetFixtures([
      {
        bucketRole: "audio",
        key: "producers/reset/tracks/version/expiry-before-delete.wav",
        bytes: new TextEncoder().encode("expires before delete"),
      },
    ]);
    seedSources(storage, fixtures);
    const bound = envelope(fixtures.map((fixture) => fixture.object));
    const cutover = adapter(storage);
    const prepared = await prepareRecovery(cutover, {
      envelope: bound,
      expectedTargetFingerprint: TARGET_FINGERPRINT,
      hmacKey: HMAC_KEY,
      assertAuthorizationFresh: vi.fn(),
    });
    let freshnessChecks = 0;

    await expect(
      cutover.deletePreparedResetObjects({
        envelope: bound,
        expectedTargetFingerprint: TARGET_FINGERPRINT,
        hmacKey: HMAC_KEY,
        expectedRestorePointFingerprint: prepared.restorePointFingerprint,
        mutationStarted: false,
        assertAuthorizationFresh: () => {
          freshnessChecks += 1;
          if (freshnessChecks === 2) throw new Error("expired before delete");
        },
        assertNoWriterMaintenanceAuthorization: noWriters(),
      }),
    ).rejects.toMatchObject({ code: "FRESH_TARGET_AUTHORIZATION_INVALID" });
    expect(storage.commands.some((command) => command.name === "DeleteObjectCommand")).toBe(false);
  });

  it("rechecks approval immediately before restoring a source", async () => {
    const storage = new FakeStorage();
    const fixtures = resetFixtures([
      {
        bucketRole: "audio",
        key: "producers/reset/tracks/version/expiry-before-restore.wav",
        bytes: new TextEncoder().encode("expires before restore"),
      },
    ]);
    seedSources(storage, fixtures);
    const bound = envelope(fixtures.map((fixture) => fixture.object));
    const cutover = adapter(storage);
    const prepared = await prepareRecovery(cutover, {
      envelope: bound,
      expectedTargetFingerprint: TARGET_FINGERPRINT,
      hmacKey: HMAC_KEY,
      assertAuthorizationFresh: vi.fn(),
    });
    await cutover.deletePreparedResetObjects({
      envelope: bound,
      expectedTargetFingerprint: TARGET_FINGERPRINT,
      hmacKey: HMAC_KEY,
      expectedRestorePointFingerprint: prepared.restorePointFingerprint,
      mutationStarted: false,
      assertAuthorizationFresh: vi.fn(),
      assertNoWriterMaintenanceAuthorization: noWriters(),
    });
    const copyCountBeforeRestore = storage.commands.filter(
      (command) => command.name === "CopyObjectCommand",
    ).length;
    let freshnessChecks = 0;

    await expect(
      cutover.restoreResetObjectsFromRecovery({
        envelope: bound,
        expectedTargetFingerprint: TARGET_FINGERPRINT,
        hmacKey: HMAC_KEY,
        expectedRestorePointFingerprint: prepared.restorePointFingerprint,
        assertAuthorizationFresh: () => {
          freshnessChecks += 1;
          if (freshnessChecks === 2) throw new Error("expired before restore");
        },
      }),
    ).rejects.toMatchObject({ code: "FRESH_TARGET_AUTHORIZATION_INVALID" });
    expect(
      storage.commands.filter((command) => command.name === "CopyObjectCommand"),
    ).toHaveLength(copyCountBeforeRestore);
  });

  it("restores all nine exact sources, verifies both final states, and retains recovery", async () => {
    const storage = new FakeStorage();
    const key = "producers/reset/tracks/version/restore.wav";
    const bytes = new TextEncoder().encode("restore exact bytes");
    const fixtures = resetFixtures([{ bucketRole: "audio", key, bytes }]);
    seedSources(storage, fixtures);
    const bound = envelope(fixtures.map((fixture) => fixture.object));
    const cutover = adapter(storage);
    const prepared = await prepareRecovery(cutover, {
      envelope: bound,
      expectedTargetFingerprint: TARGET_FINGERPRINT,
      hmacKey: HMAC_KEY,
      assertAuthorizationFresh: vi.fn(),
    });
    await cutover.deletePreparedResetObjects({
      envelope: bound,
      expectedTargetFingerprint: TARGET_FINGERPRINT,
      hmacKey: HMAC_KEY,
      expectedRestorePointFingerprint: prepared.restorePointFingerprint,
      mutationStarted: false,
      assertAuthorizationFresh: vi.fn(),
      assertNoWriterMaintenanceAuthorization: noWriters(),
    });

    await expect(
      cutover.verifyResetSourcesAbsent({
        envelope: bound,
        expectedTargetFingerprint: TARGET_FINGERPRINT,
        hmacKey: HMAC_KEY,
        expectedRestorePointFingerprint: prepared.restorePointFingerprint,
      }),
    ).resolves.toMatchObject({ expectedSourceState: "absent", objectCount: 9 });

    const deletesBeforeRestore = storage.commands.filter(
      (command) => command.name === "DeleteObjectCommand",
    ).length;
    const restored = await cutover.restoreResetObjectsFromRecovery({
      envelope: bound,
      expectedTargetFingerprint: TARGET_FINGERPRINT,
      hmacKey: HMAC_KEY,
      expectedRestorePointFingerprint: prepared.restorePointFingerprint,
      assertAuthorizationFresh: vi.fn(),
    });
    expect(restored).toMatchObject({
      objectCount: 9,
      restoredCount: 9,
      recoveryRetainedCount: 9,
    });
    await expect(
      cutover.verifyResetSourcesRestored({
        envelope: bound,
        expectedTargetFingerprint: TARGET_FINGERPRINT,
        hmacKey: HMAC_KEY,
        expectedRestorePointFingerprint: prepared.restorePointFingerprint,
      }),
    ).resolves.toMatchObject({ expectedSourceState: "restored", objectCount: 9 });
    expect(
      storage.commands.filter((command) => command.name === "DeleteObjectCommand"),
    ).toHaveLength(deletesBeforeRestore);
    for (const fixture of fixtures) {
      expect(storage.has(BUCKETS[fixture.object.bucketRole], fixture.object.key)).toBe(true);
      expect(
        storage.has(
          BUCKETS[fixture.object.bucketRole],
          recoveryKey(fixture.object.bucketRole, fixture.object.key),
        ),
      ).toBe(true);
    }
  });

  it("refuses restore before any copy when one recovery object is missing", async () => {
    const storage = new FakeStorage();
    const key = "producers/reset/tracks/version/restore-missing.wav";
    const bytes = new TextEncoder().encode("restore requires every recovery object");
    const fixtures = resetFixtures([{ bucketRole: "audio", key, bytes }]);
    seedSources(storage, fixtures);
    const bound = envelope(fixtures.map((fixture) => fixture.object));
    const cutover = adapter(storage);
    const prepared = await prepareRecovery(cutover, {
      envelope: bound,
      expectedTargetFingerprint: TARGET_FINGERPRINT,
      hmacKey: HMAC_KEY,
      assertAuthorizationFresh: vi.fn(),
    });
    await cutover.deletePreparedResetObjects({
      envelope: bound,
      expectedTargetFingerprint: TARGET_FINGERPRINT,
      hmacKey: HMAC_KEY,
      expectedRestorePointFingerprint: prepared.restorePointFingerprint,
      mutationStarted: false,
      assertAuthorizationFresh: vi.fn(),
      assertNoWriterMaintenanceAuthorization: noWriters(),
    });
    storage.remove(BUCKETS.audio, recoveryKey("audio", key));
    const copiesBeforeRestore = storage.commands.filter(
      (command) => command.name === "CopyObjectCommand",
    ).length;

    await expect(
      cutover.restoreResetObjectsFromRecovery({
        envelope: bound,
        expectedTargetFingerprint: TARGET_FINGERPRINT,
        hmacKey: HMAC_KEY,
        expectedRestorePointFingerprint: prepared.restorePointFingerprint,
        assertAuthorizationFresh: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: "RESTORE_PROOF_MISMATCH" });
    expect(storage.commands.filter((command) => command.name === "CopyObjectCommand")).toHaveLength(
      copiesBeforeRestore,
    );
  });

  it("hashes a dual async-iterator/transform body as a stream", async () => {
    const storage = new FakeStorage();
    storage.dualStreamingBody = true;
    const fixtures = resetFixtures([
      {
        bucketRole: "audio",
        key: "producers/reset/tracks/version/stream.wav",
        bytes: new TextEncoder().encode("stream this body in chunks"),
      },
    ]);
    seedSources(storage, fixtures);

    await expect(
      prepareRecovery(adapter(storage), {
        envelope: envelope(fixtures.map((fixture) => fixture.object)),
        expectedTargetFingerprint: TARGET_FINGERPRINT,
        hmacKey: HMAC_KEY,
        assertAuthorizationFresh: vi.fn(),
      }),
    ).resolves.toMatchObject({ objectCount: 9 });
    expect(storage.transformToByteArrayCalls).toBe(0);
  });
});
