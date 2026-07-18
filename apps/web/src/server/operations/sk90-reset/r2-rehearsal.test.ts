import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  type CopyObjectCommandInput,
  type DeleteObjectCommandInput,
  type S3Client,
} from "@aws-sdk/client-s3";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";

import { protectValue, sha256Digest, type ProtectedToken } from "./canonical";
import { Sk90ResetSafetyError, type Sk90SafetyErrorCode } from "./errors";
import {
  assertSk90R2RehearsalConfig,
  createSk90R2Rehearsal,
  createSk90R2RehearsalClient,
  fingerprintStorageBytes,
  fingerprintStorageMetadata,
} from "./r2-rehearsal";
import type {
  RawKeyTokenHook,
  RawStorageEnvelope,
  Sk90R2RehearsalConfig,
  Sk90S3Client,
  StorageObjectMetadata,
} from "./storage-port";

const HMAC_KEY = "test-only-r2-rehearsal-key-at-least-32-bytes";

const CONFIG: Sk90R2RehearsalConfig = {
  endpoint: `https://${"a".repeat(32)}.r2.cloudflarestorage.com`,
  accessKeyId: "isolated-access-key",
  secretAccessKey: "isolated-secret-key-at-least-32-bytes",
  buckets: {
    audio: "sk90-isolated-audio",
    docs: "sk90-isolated-docs",
  },
  namespace: "sk90-rehearsal/approved-sandbox",
};

const tokenForKey: RawKeyTokenHook = ({ scope, bucketRole, key }) =>
  protectValue(HMAC_KEY, `${scope}-key\0${bucketRole}\0${key}`);

const assertAuthorizationFresh = (): void => undefined;

const EMPTY_METADATA: StorageObjectMetadata = {
  cacheControl: null,
  contentDisposition: null,
  contentEncoding: null,
  contentLanguage: null,
  contentType: null,
  expiresAt: null,
  custom: [],
};

type FakeObject = {
  bytes: Uint8Array;
  etag: string;
  lastModified: Date;
  metadata: StorageObjectMetadata;
};

function required<Value>(value: Value | undefined): Value {
  if (value === undefined) throw new Error("Missing test fixture");
  return value;
}

function sdkFailure(status: number, name: string): Error {
  return Object.assign(new Error("private endpoint/key must not escape"), {
    name,
    $metadata: { httpStatusCode: status },
  });
}

function rawMetadata(metadata: StorageObjectMetadata) {
  return {
    CacheControl: metadata.cacheControl ?? undefined,
    ContentDisposition: metadata.contentDisposition ?? undefined,
    ContentEncoding: metadata.contentEncoding ?? undefined,
    ContentLanguage: metadata.contentLanguage ?? undefined,
    ContentType: metadata.contentType ?? undefined,
    Expires: metadata.expiresAt ? new Date(metadata.expiresAt) : undefined,
    Metadata: Object.fromEntries(metadata.custom),
  };
}

class FakeS3 {
  readonly copyInputs: CopyObjectCommandInput[] = [];
  readonly deleteInputs: DeleteObjectCommandInput[] = [];
  readonly objects = new Map<string, FakeObject>();
  readonly multipart = new Map<string, { key: string; uploadId: string }[]>();
  pageSize = 1;
  repeatContinuationToken = false;
  returnWrongPrefix = false;
  corruptNextCopy = false;
  failNextBodyStream = false;
  failAfterNextDelete = false;
  beforeFirstHead: (() => void) | undefined;
  afterFirstGet: (() => void) | undefined;
  beforeFirstDelete: (() => void) | undefined;
  private clock = 0;
  private headHookUsed = false;
  private getHookUsed = false;
  private deleteHookUsed = false;

  private identity(bucket: string, key: string): string {
    return `${bucket}\0${key}`;
  }

  put(bucket: string, key: string, bytes: Uint8Array, metadata = EMPTY_METADATA): void {
    this.clock += 1;
    const contentHex = fingerprintStorageBytes(bytes).slice("sha256:".length, 48);
    this.objects.set(this.identity(bucket, key), {
      bytes: Uint8Array.from(bytes),
      etag: `"${contentHex}-${String(this.clock)}"`,
      lastModified: new Date(Date.UTC(2026, 6, 17, 0, 0, this.clock)),
      metadata,
    });
  }

  remove(bucket: string, key: string): void {
    this.objects.delete(this.identity(bucket, key));
  }

  get(bucket: string, key: string): FakeObject | undefined {
    return this.objects.get(this.identity(bucket, key));
  }

  addMultipart(bucket: string, key: string, uploadId: string): void {
    this.multipart.set(bucket, [...(this.multipart.get(bucket) ?? []), { key, uploadId }]);
  }

  armBeforeNextDelete(callback: () => void): void {
    this.deleteHookUsed = false;
    this.beforeFirstDelete = callback;
  }

  private listObjects(command: ListObjectsV2Command) {
    const bucket = required(command.input.Bucket);
    const prefix = required(command.input.Prefix);
    const offset = command.input.ContinuationToken
      ? Number(command.input.ContinuationToken.slice("cursor:".length))
      : 0;
    const entries = [...this.objects.entries()]
      .filter(([identity]) => identity.startsWith(`${bucket}\0${prefix}`))
      .map(([identity, object]) => ({ key: identity.slice(bucket.length + 1), object }))
      .sort((left, right) => Buffer.compare(Buffer.from(left.key), Buffer.from(right.key)));
    const page = entries.slice(offset, offset + this.pageSize);
    const nextOffset = offset + page.length;
    const truncated = nextOffset < entries.length;
    const nextToken = truncated
      ? this.repeatContinuationToken
        ? (command.input.ContinuationToken ?? "cursor:0")
        : `cursor:${String(nextOffset)}`
      : undefined;
    return {
      Contents: page.map(({ key, object }, index) => ({
        Key: this.returnWrongPrefix && offset === 0 && index === 0 ? `wrong/${key}` : key,
        ETag: object.etag,
        Size: object.bytes.byteLength,
        LastModified: object.lastModified,
      })),
      IsTruncated: truncated,
      KeyCount: page.length,
      NextContinuationToken: nextToken,
    };
  }

  private listMultipart(command: ListMultipartUploadsCommand) {
    const bucket = required(command.input.Bucket);
    const prefix = required(command.input.Prefix);
    const uploads = (this.multipart.get(bucket) ?? []).filter(({ key }) => key.startsWith(prefix));
    return {
      Uploads: uploads.map(({ key, uploadId }) => ({ Key: key, UploadId: uploadId })),
      IsTruncated: false,
    };
  }

  private head(command: HeadObjectCommand) {
    if (!this.headHookUsed) {
      this.headHookUsed = true;
      this.beforeFirstHead?.();
    }
    const bucket = required(command.input.Bucket);
    const key = required(command.input.Key);
    const object = this.get(bucket, key);
    if (!object) throw sdkFailure(404, "NotFound");
    if (command.input.IfMatch && command.input.IfMatch !== object.etag) {
      throw sdkFailure(412, "PreconditionFailed");
    }
    return {
      ETag: object.etag,
      ContentLength: object.bytes.byteLength,
      LastModified: object.lastModified,
      ...rawMetadata(object.metadata),
    };
  }

  private getObject(command: GetObjectCommand) {
    const bucket = required(command.input.Bucket);
    const key = required(command.input.Key);
    const object = this.get(bucket, key);
    if (!object) throw sdkFailure(404, "NoSuchKey");
    if (command.input.IfMatch && command.input.IfMatch !== object.etag) {
      throw sdkFailure(412, "PreconditionFailed");
    }
    const first = object.bytes.slice(0, Math.ceil(object.bytes.byteLength / 2));
    const second = object.bytes.slice(first.byteLength);
    let body: Readable | AsyncIterable<Uint8Array> = Readable.from([first, second]);
    if (this.failNextBodyStream) {
      this.failNextBodyStream = false;
      body = (async function* failingBody() {
        yield first;
        await Promise.resolve();
        throw new Error("private stream details must not escape");
      })();
    }
    const result = {
      Body: body,
      ETag: object.etag,
      ContentLength: object.bytes.byteLength,
      LastModified: object.lastModified,
      ...rawMetadata(object.metadata),
    };
    if (!this.getHookUsed) {
      this.getHookUsed = true;
      this.afterFirstGet?.();
    }
    return result;
  }

  private copy(command: CopyObjectCommand) {
    const input = command.input;
    this.copyInputs.push(input);
    const destinationBucket = required(input.Bucket);
    const destinationKey = required(input.Key);
    const copySource = decodeURIComponent(required(input.CopySource));
    const separator = copySource.indexOf("/");
    const sourceBucket = copySource.slice(0, separator);
    const sourceKey = copySource.slice(separator + 1);
    const source = this.get(sourceBucket, sourceKey);
    if (!source) throw sdkFailure(404, "NoSuchKey");
    if (input.CopySourceIfMatch && input.CopySourceIfMatch !== source.etag) {
      throw sdkFailure(412, "PreconditionFailed");
    }
    const destination = this.get(destinationBucket, destinationKey);
    if (input.IfNoneMatch === "*" && destination) {
      throw sdkFailure(412, "PreconditionFailed");
    }
    if (input.IfMatch && input.IfMatch !== destination?.etag) {
      throw sdkFailure(412, "PreconditionFailed");
    }
    const bytes = this.corruptNextCopy
      ? Uint8Array.from([...source.bytes, 0xff])
      : Uint8Array.from(source.bytes);
    this.corruptNextCopy = false;
    this.put(destinationBucket, destinationKey, bytes, source.metadata);
    return {
      CopyObjectResult: { ETag: required(this.get(destinationBucket, destinationKey)).etag },
    };
  }

  private deleteObject(command: DeleteObjectCommand) {
    if (!this.deleteHookUsed) {
      this.deleteHookUsed = true;
      this.beforeFirstDelete?.();
    }
    const input = command.input;
    this.deleteInputs.push(input);
    const bucket = required(input.Bucket);
    const key = required(input.Key);
    const object = this.get(bucket, key);
    if (input.IfMatch && object && input.IfMatch !== object.etag) {
      throw sdkFailure(412, "PreconditionFailed");
    }
    this.remove(bucket, key);
    if (this.failAfterNextDelete) {
      this.failAfterNextDelete = false;
      throw new Error("ambiguous private delete response");
    }
    return {};
  }

  send(command: unknown): Promise<unknown> {
    if (command instanceof ListObjectsV2Command) return Promise.resolve(this.listObjects(command));
    if (command instanceof ListMultipartUploadsCommand) {
      return Promise.resolve(this.listMultipart(command));
    }
    if (command instanceof HeadObjectCommand) return Promise.resolve(this.head(command));
    if (command instanceof GetObjectCommand) return Promise.resolve(this.getObject(command));
    if (command instanceof CopyObjectCommand) return Promise.resolve(this.copy(command));
    if (command instanceof DeleteObjectCommand) return Promise.resolve(this.deleteObject(command));
    return Promise.reject(new Error("Unexpected fake command"));
  }
}

function clientFor(fake: FakeS3): Sk90S3Client {
  return fake as unknown as Pick<S3Client, "send">;
}

function dataKey(logicalKey: string): string {
  return `${CONFIG.namespace}/data/${logicalKey}`;
}

function probeKey(
  artifactDigest: ReturnType<typeof sha256Digest>,
  entry: RawStorageEnvelope["entries"][number],
): string {
  return `${CONFIG.namespace}/restore-probe/${artifactDigest.slice("sha256:".length)}/${entry.bucketRole}/${entry.protectedKey.slice("hmac-sha256:".length)}`;
}

function expectedMetadata(contentType: string): StorageObjectMetadata {
  return {
    ...EMPTY_METADATA,
    contentType,
    custom: [["fixture", "isolated"]],
  };
}

function addEnvelopeObject(
  fake: FakeS3,
  input: {
    bucketRole: "audio" | "docs";
    logicalKey: string;
    bytes: Uint8Array;
    ownership: "reset_exclusive" | "preserved_only";
    metadata: StorageObjectMetadata;
  },
) {
  fake.put(
    CONFIG.buckets[input.bucketRole],
    dataKey(input.logicalKey),
    input.bytes,
    input.metadata,
  );
  return {
    bucketRole: input.bucketRole,
    logicalKey: input.logicalKey,
    protectedKey: tokenForKey({
      scope: "data",
      bucketRole: input.bucketRole,
      key: input.logicalKey,
    }),
    ownership: input.ownership,
    sizeBytes: input.bytes.byteLength,
    contentFingerprint: fingerprintStorageBytes(input.bytes),
    metadataFingerprint: fingerprintStorageMetadata(input.metadata),
  } as const;
}

function exactEnvelope(fake: FakeS3): RawStorageEnvelope {
  return {
    entries: [
      addEnvelopeObject(fake, {
        bucketRole: "audio",
        logicalKey: "producers/test/tracks/version/reset.wav",
        bytes: Uint8Array.from(Buffer.from("reset audio bytes")),
        ownership: "reset_exclusive",
        metadata: expectedMetadata("audio/wav"),
      }),
      addEnvelopeObject(fake, {
        bucketRole: "audio",
        logicalKey: "producers/test/tracks/version/preserved.wav",
        bytes: Uint8Array.from(Buffer.from("preserved audio bytes")),
        ownership: "preserved_only",
        metadata: expectedMetadata("audio/wav"),
      }),
      addEnvelopeObject(fake, {
        bucketRole: "docs",
        logicalKey: "producers/test/proofs/reset.pdf",
        bytes: Uint8Array.from(Buffer.from("reset proof bytes")),
        ownership: "reset_exclusive",
        metadata: expectedMetadata("application/pdf"),
      }),
    ],
  };
}

async function expectSafetyError(
  run: () => Promise<unknown>,
  code: Sk90SafetyErrorCode,
): Promise<void> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(Sk90ResetSafetyError);
    expect((error as Sk90ResetSafetyError).code).toBe(code);
    return;
  }
  throw new Error(`Expected safety error ${code}`);
}

describe("SK-90 dedicated R2 rehearsal boundary", () => {
  it("accepts only an explicit isolated R2 endpoint, buckets, credentials, and namespace", () => {
    expect(assertSk90R2RehearsalConfig(CONFIG)).toBe(true);
    expect(createSk90R2RehearsalClient(CONFIG)).toHaveProperty("send");

    for (const candidate of [
      { ...CONFIG, endpoint: "https://storage.example.com" },
      { ...CONFIG, namespace: "production" },
      { ...CONFIG, accessKeyId: "" },
      { ...CONFIG, buckets: { audio: CONFIG.buckets.audio, docs: CONFIG.buckets.audio } },
    ]) {
      expect(() => assertSk90R2RehearsalConfig(candidate)).toThrow(
        expect.objectContaining({ code: "REHEARSAL_ENV_INVALID" }),
      );
    }
  });

  it("exhaustively paginates both roles, streams full content, and creates a stable snapshot", async () => {
    const fake = new FakeS3();
    const envelope = exactEnvelope(fake);
    const adapter = createSk90R2Rehearsal({
      client: clientFor(fake),
      config: CONFIG,
      tokenForKey,
    });

    const snapshot = await adapter.captureStableSnapshot(envelope, "pre");

    expect(snapshot.objects).toHaveLength(3);
    expect(snapshot.activeMultipartUploadCount).toBe(0);
    expect(snapshot.objects.map((object) => object.contentFingerprint).sort()).toEqual(
      envelope.entries.map((entry) => entry.contentFingerprint).sort(),
    );
  });

  it("stops on token loops, wrong-prefix results, active multipart uploads, or extra objects", async () => {
    for (const setup of [
      (fake: FakeS3) => {
        fake.repeatContinuationToken = true;
      },
      (fake: FakeS3) => {
        fake.returnWrongPrefix = true;
      },
      (fake: FakeS3) => {
        fake.addMultipart(CONFIG.buckets.audio, dataKey("pending.wav"), "private-upload-id");
      },
      (fake: FakeS3) => {
        fake.put(
          CONFIG.buckets.docs,
          dataKey("unreferenced/private.bin"),
          Uint8Array.from([1, 2, 3]),
        );
      },
    ]) {
      const fake = new FakeS3();
      const envelope = exactEnvelope(fake);
      setup(fake);
      const adapter = createSk90R2Rehearsal({
        client: clientFor(fake),
        config: CONFIG,
        tokenForKey,
      });

      await expectSafetyError(
        () => adapter.captureStableSnapshot(envelope, "pre"),
        "STORAGE_OBJECT_DRIFT",
      );
    }
  });

  it.each([
    `${CONFIG.namespace}/recovery/unapproved/object`,
    `${CONFIG.namespace}/restore-probe/unapproved/object`,
    `${CONFIG.namespace}/unowned/object`,
  ])("rejects an extra object anywhere under the dedicated namespace: %s", async (extraKey) => {
    const fake = new FakeS3();
    const envelope = exactEnvelope(fake);
    fake.put(CONFIG.buckets.audio, extraKey, Uint8Array.from([1]));
    const adapter = createSk90R2Rehearsal({
      client: clientFor(fake),
      config: CONFIG,
      tokenForKey,
    });

    await expectSafetyError(
      () =>
        adapter.assertNamespaceState({
          artifactDigest: sha256Digest("artifact"),
          envelope,
          dataState: "pre",
          recoveryState: "empty",
        }),
      extraKey.includes("recovery") || extraKey.includes("restore-probe")
        ? "QUARANTINE_PROOF_MISMATCH"
        : "STORAGE_OBJECT_DRIFT",
    );
  });

  it("rejects a multipart upload under recovery, probe, or any other namespace prefix", async () => {
    for (const prefix of ["recovery", "restore-probe", "other"]) {
      const fake = new FakeS3();
      const envelope = exactEnvelope(fake);
      fake.addMultipart(
        CONFIG.buckets.docs,
        `${CONFIG.namespace}/${prefix}/pending`,
        "private-upload-id",
      );
      const adapter = createSk90R2Rehearsal({
        client: clientFor(fake),
        config: CONFIG,
        tokenForKey,
      });
      await expectSafetyError(
        () =>
          adapter.assertNamespaceState({
            artifactDigest: sha256Digest("artifact"),
            envelope,
            dataState: "pre",
            recoveryState: "empty",
          }),
        "STORAGE_OBJECT_DRIFT",
      );
    }
  });

  it("validates every raw key token before any storage request", async () => {
    const fake = new FakeS3();
    const envelope = exactEnvelope(fake);
    const first = required(envelope.entries[0]);
    const substituted: RawStorageEnvelope = {
      entries: [
        { ...first, protectedKey: protectValue(HMAC_KEY, "substituted") },
        ...envelope.entries.slice(1),
      ],
    };
    const adapter = createSk90R2Rehearsal({
      client: clientFor(fake),
      config: CONFIG,
      tokenForKey,
    });

    await expectSafetyError(
      () => adapter.captureStableSnapshot(substituted, "pre"),
      "ARTIFACT_BINDING_MISMATCH",
    );
  });

  it("stops when content changes between the first listing and conditional read", async () => {
    const fake = new FakeS3();
    const envelope = exactEnvelope(fake);
    const first = required(envelope.entries[0]);
    fake.beforeFirstHead = () => {
      fake.put(
        CONFIG.buckets[first.bucketRole],
        dataKey(first.logicalKey),
        Uint8Array.from(Buffer.from("concurrent different bytes")),
        expectedMetadata("audio/wav"),
      );
    };
    const adapter = createSk90R2Rehearsal({
      client: clientFor(fake),
      config: CONFIG,
      tokenForKey,
    });

    await expectSafetyError(
      () => adapter.captureStableSnapshot(envelope, "pre"),
      "STORAGE_OBJECT_DRIFT",
    );
  });

  it("turns a streaming failure into a redacted safety stop", async () => {
    const fake = new FakeS3();
    const envelope = exactEnvelope(fake);
    fake.failNextBodyStream = true;
    const adapter = createSk90R2Rehearsal({
      client: clientFor(fake),
      config: CONFIG,
      tokenForKey,
    });

    await expectSafetyError(
      () => adapter.captureStableSnapshot(envelope, "pre"),
      "STORAGE_OBJECT_DRIFT",
    );
  });
});

describe("SK-90 quarantine, delete, restore, and second-run R2 execution", () => {
  it("rechecks authorization after long reads and immediately before every storage mutation", async () => {
    const fake = new FakeS3();
    const envelope = exactEnvelope(fake);
    const adapter = createSk90R2Rehearsal({
      client: clientFor(fake),
      config: CONFIG,
      tokenForKey,
    });
    let checks = 0;

    await expectSafetyError(
      () =>
        adapter.quarantineResetObjects({
          artifactDigest: sha256Digest("artifact-expired-before-second-mutation"),
          envelope,
          assertAuthorizationFresh: () => {
            checks += 1;
            if (checks === 2) throw new Sk90ResetSafetyError("FRESHNESS_PROOF_INVALID");
          },
        }),
      "FRESHNESS_PROOF_INVALID",
    );

    expect(checks).toBe(2);
    expect(fake.copyInputs).toHaveLength(1);
    expect(fake.deleteInputs).toHaveLength(0);
  });

  it("stops an expired delete authorization after verification and before R2 deletion", async () => {
    const fake = new FakeS3();
    const envelope = exactEnvelope(fake);
    const adapter = createSk90R2Rehearsal({
      client: clientFor(fake),
      config: CONFIG,
      tokenForKey,
    });
    const artifactDigest = sha256Digest("artifact-expired-before-delete");
    await adapter.quarantineResetObjects({
      artifactDigest,
      envelope,
      assertAuthorizationFresh,
    });
    const deletesBefore = fake.deleteInputs.length;

    await expectSafetyError(
      () =>
        adapter.deleteResetObjects({
          artifactDigest,
          envelope,
          completedProtectedKeys: [],
          mutationStarted: false,
          assertAuthorizationFresh: () => {
            throw new Sk90ResetSafetyError("FRESHNESS_PROOF_INVALID");
          },
        }),
      "FRESHNESS_PROOF_INVALID",
    );

    expect(fake.deleteInputs).toHaveLength(deletesBefore);
  });

  it("stops an expired restore authorization after verification and before R2 copy", async () => {
    const fake = new FakeS3();
    const envelope = exactEnvelope(fake);
    const adapter = createSk90R2Rehearsal({
      client: clientFor(fake),
      config: CONFIG,
      tokenForKey,
    });
    const artifactDigest = sha256Digest("artifact-expired-before-restore");
    await adapter.quarantineResetObjects({
      artifactDigest,
      envelope,
      assertAuthorizationFresh,
    });
    await adapter.deleteResetObjects({
      artifactDigest,
      envelope,
      completedProtectedKeys: [],
      mutationStarted: false,
      assertAuthorizationFresh,
    });
    const copiesBefore = fake.copyInputs.length;

    await expectSafetyError(
      () =>
        adapter.restoreResetObjects({
          artifactDigest,
          envelope,
          forceReplay: false,
          assertAuthorizationFresh: () => {
            throw new Sk90ResetSafetyError("FRESHNESS_PROOF_INVALID");
          },
        }),
      "FRESHNESS_PROOF_INVALID",
    );

    expect(fake.copyInputs).toHaveLength(copiesBefore);
  });

  it("conditionally copies every reset object, fully verifies it, and proves a restore probe", async () => {
    const fake = new FakeS3();
    const envelope = exactEnvelope(fake);
    const adapter = createSk90R2Rehearsal({
      client: clientFor(fake),
      config: CONFIG,
      tokenForKey,
    });

    const result = await adapter.quarantineResetObjects({
      artifactDigest: fingerprintStorageBytes(Uint8Array.from(Buffer.from("artifact"))),
      envelope,
      assertAuthorizationFresh,
    });

    expect(result.copies).toHaveLength(2);
    expect(result.copies[0]).toMatchObject({ copyExists: true, restoreVerified: true });
    expect(result.sourceAfterFingerprint).toBe(result.sourceBeforeFingerprint);
    expect(fake.copyInputs).toHaveLength(4);
    expect(
      fake.copyInputs.every((input) => input.CopySourceIfMatch && input.IfNoneMatch === "*"),
    ).toBe(true);
    expect(fake.deleteInputs).toHaveLength(2);
    expect(fake.deleteInputs.every((input) => Boolean(input.IfMatch))).toBe(true);
  });

  it("resumes safely after a crash left an exact verified restore probe", async () => {
    const fake = new FakeS3();
    const envelope = exactEnvelope(fake);
    const artifactDigest = sha256Digest("artifact-with-probe-crash");
    const reset = required(envelope.entries.find((entry) => entry.ownership === "reset_exclusive"));
    const source = required(fake.get(CONFIG.buckets[reset.bucketRole], dataKey(reset.logicalKey)));
    fake.put(
      CONFIG.buckets[reset.bucketRole],
      probeKey(artifactDigest, reset),
      source.bytes,
      source.metadata,
    );
    const adapter = createSk90R2Rehearsal({
      client: clientFor(fake),
      config: CONFIG,
      tokenForKey,
    });

    const result = await adapter.quarantineResetObjects({
      artifactDigest,
      envelope,
      assertAuthorizationFresh,
    });

    expect(result.copies).toHaveLength(2);
    expect(fake.get(CONFIG.buckets[reset.bucketRole], probeKey(artifactDigest, reset))).toBe(
      undefined,
    );
  });

  it("reconciles an ambiguous probe delete on the next authorized retry", async () => {
    const fake = new FakeS3();
    const envelope = exactEnvelope(fake);
    const artifactDigest = sha256Digest("artifact-with-ambiguous-probe-delete");
    const adapter = createSk90R2Rehearsal({
      client: clientFor(fake),
      config: CONFIG,
      tokenForKey,
    });
    fake.failAfterNextDelete = true;

    await expectSafetyError(
      () =>
        adapter.quarantineResetObjects({
          artifactDigest,
          envelope,
          assertAuthorizationFresh,
        }),
      "QUARANTINE_PROOF_MISMATCH",
    );
    const resumed = await adapter.quarantineResetObjects({
      artifactDigest,
      envelope,
      assertAuthorizationFresh,
    });

    expect(resumed.copies).toHaveLength(2);
    expect(
      [...fake.objects.keys()].some((identity) =>
        identity.includes(`${CONFIG.namespace}/restore-probe/`),
      ),
    ).toBe(false);
  });

  it("rejects a corrupted quarantine copy before any target deletion", async () => {
    const fake = new FakeS3();
    const envelope = exactEnvelope(fake);
    fake.corruptNextCopy = true;
    const adapter = createSk90R2Rehearsal({
      client: clientFor(fake),
      config: CONFIG,
      tokenForKey,
    });

    await expectSafetyError(
      () =>
        adapter.quarantineResetObjects({
          artifactDigest: fingerprintStorageBytes(Uint8Array.from(Buffer.from("artifact"))),
          envelope,
          assertAuthorizationFresh,
        }),
      "QUARANTINE_PROOF_MISMATCH",
    );
    expect(
      envelope.entries.every((entry) =>
        fake.get(CONFIG.buckets[entry.bucketRole], dataKey(entry.logicalKey)),
      ),
    ).toBe(true);
  });

  it("conditionally deletes only reset objects, verifies absence, and reports per-object progress", async () => {
    const fake = new FakeS3();
    const envelope = exactEnvelope(fake);
    const adapter = createSk90R2Rehearsal({
      client: clientFor(fake),
      config: CONFIG,
      tokenForKey,
    });
    const artifactDigest = fingerprintStorageBytes(Uint8Array.from(Buffer.from("artifact")));
    await adapter.quarantineResetObjects({
      artifactDigest,
      envelope,
      assertAuthorizationFresh,
    });
    const progress: ProtectedToken[] = [];

    const result = await adapter.deleteResetObjects({
      artifactDigest,
      envelope,
      completedProtectedKeys: [],
      mutationStarted: false,
      assertAuthorizationFresh,
      onProgress: (receipt) => {
        progress.push(receipt.protectedKey);
      },
    });

    expect(result.deletedCount).toBe(2);
    expect(progress).toHaveLength(2);
    expect(result.postSnapshot.objects).toHaveLength(1);
    expect(result.postSnapshot.objects[0]?.ownership).toBe("preserved_only");
    expect(fake.deleteInputs.slice(-2).every((input) => Boolean(input.IfMatch))).toBe(true);
  });

  it("does not emit duplicate progress when durable state already records every deletion", async () => {
    const fake = new FakeS3();
    const envelope = exactEnvelope(fake);
    const adapter = createSk90R2Rehearsal({
      client: clientFor(fake),
      config: CONFIG,
      tokenForKey,
    });
    const artifactDigest = fingerprintStorageBytes(Uint8Array.from(Buffer.from("artifact")));
    await adapter.quarantineResetObjects({
      artifactDigest,
      envelope,
      assertAuthorizationFresh,
    });
    const first = await adapter.deleteResetObjects({
      artifactDigest,
      envelope,
      completedProtectedKeys: [],
      mutationStarted: false,
      assertAuthorizationFresh,
    });
    const completed = envelope.entries
      .filter((entry) => entry.ownership === "reset_exclusive")
      .map((entry) => entry.protectedKey);
    const progress: ProtectedToken[] = [];

    const resumed = await adapter.deleteResetObjects({
      artifactDigest,
      envelope,
      completedProtectedKeys: completed,
      mutationStarted: true,
      assertAuthorizationFresh,
      onProgress: (receipt) => {
        progress.push(receipt.protectedKey);
      },
    });

    expect(progress).toEqual([]);
    expect(resumed.postSnapshot.fingerprint).toBe(first.postSnapshot.fingerprint);
  });

  it("stops a concurrent overwrite through the delete precondition", async () => {
    const fake = new FakeS3();
    const envelope = exactEnvelope(fake);
    const adapter = createSk90R2Rehearsal({
      client: clientFor(fake),
      config: CONFIG,
      tokenForKey,
    });
    const artifactDigest = fingerprintStorageBytes(Uint8Array.from(Buffer.from("artifact")));
    await adapter.quarantineResetObjects({
      artifactDigest,
      envelope,
      assertAuthorizationFresh,
    });
    const firstReset = required(
      envelope.entries.find((entry) => entry.ownership === "reset_exclusive"),
    );
    fake.armBeforeNextDelete(() => {
      fake.put(
        CONFIG.buckets[firstReset.bucketRole],
        dataKey(firstReset.logicalKey),
        Uint8Array.from(Buffer.from("concurrent overwrite")),
        expectedMetadata("audio/wav"),
      );
    });

    await expectSafetyError(
      () =>
        adapter.deleteResetObjects({
          artifactDigest,
          envelope,
          completedProtectedKeys: [],
          mutationStarted: false,
          assertAuthorizationFresh,
        }),
      "STORAGE_OBJECT_DRIFT",
    );
  });

  it("reconciles a crash after deletion, restores exact bytes, and proves a zero-change second run", async () => {
    const fake = new FakeS3();
    const envelope = exactEnvelope(fake);
    const adapter = createSk90R2Rehearsal({
      client: clientFor(fake),
      config: CONFIG,
      tokenForKey,
    });
    const artifactDigest = fingerprintStorageBytes(Uint8Array.from(Buffer.from("artifact")));
    await adapter.quarantineResetObjects({
      artifactDigest,
      envelope,
      assertAuthorizationFresh,
    });
    const firstReset = required(
      envelope.entries.find((entry) => entry.ownership === "reset_exclusive"),
    );
    fake.remove(CONFIG.buckets[firstReset.bucketRole], dataKey(firstReset.logicalKey));
    const progress: { protectedKey: ProtectedToken; reconciled: boolean }[] = [];

    const deleted = await adapter.deleteResetObjects({
      artifactDigest,
      envelope,
      completedProtectedKeys: [],
      mutationStarted: true,
      assertAuthorizationFresh,
      onProgress: (receipt) => {
        progress.push(receipt);
      },
    });
    expect(progress.some((receipt) => receipt.reconciled)).toBe(true);

    const countersBeforeSecondRun = adapter.getMutationCounters();
    const secondRun = await adapter.captureSecondRunStorageSnapshot({
      envelope,
      expected: "post",
      beforeSnapshot: deleted.postSnapshot,
      beforeCounters: countersBeforeSecondRun,
    });
    expect(secondRun).toMatchObject({
      copyAttempts: 0,
      copiesSucceeded: 0,
      deleteAttempts: 0,
      deletesSucceeded: 0,
      unchanged: true,
    });

    const restored = await adapter.restoreResetObjects({
      artifactDigest,
      envelope,
      forceReplay: false,
      assertAuthorizationFresh,
    });
    expect(restored.snapshot.objects).toHaveLength(envelope.entries.length);
    expect(restored.snapshot.objects.map((entry) => entry.contentFingerprint).sort()).toEqual(
      envelope.entries.map((entry) => entry.contentFingerprint).sort(),
    );
  });

  it("force-replays verified recovery copies over exact existing objects and reports each copy", async () => {
    const fake = new FakeS3();
    const envelope = exactEnvelope(fake);
    const adapter = createSk90R2Rehearsal({
      client: clientFor(fake),
      config: CONFIG,
      tokenForKey,
    });
    const artifactDigest = fingerprintStorageBytes(Uint8Array.from(Buffer.from("artifact")));
    await adapter.quarantineResetObjects({
      artifactDigest,
      envelope,
      assertAuthorizationFresh,
    });
    const resetCount = envelope.entries.filter(
      (entry) => entry.ownership === "reset_exclusive",
    ).length;
    const before = adapter.getMutationCounters();
    const progress: Array<{
      protectedKey: ProtectedToken;
      alreadyPresent: boolean;
      replayed: boolean;
    }> = [];

    const restored = await adapter.restoreResetObjects({
      artifactDigest,
      envelope,
      forceReplay: true,
      assertAuthorizationFresh,
      onProgress: (receipt) => {
        progress.push(receipt);
      },
    });

    expect(restored).toMatchObject({
      restoredCount: resetCount,
      replayedCount: resetCount,
      alreadyPresentCount: 0,
    });
    expect(adapter.getMutationCounters().copiesSucceeded - before.copiesSucceeded).toBe(resetCount);
    expect(progress).toHaveLength(resetCount);
    expect(progress.every((receipt) => receipt.alreadyPresent && receipt.replayed)).toBe(true);
    expect(
      fake.copyInputs
        .slice(-resetCount)
        .every(
          (input) =>
            Boolean(input.CopySourceIfMatch) &&
            Boolean(input.IfMatch) &&
            input.IfNoneMatch === undefined,
        ),
    ).toBe(true);
    expect(restored.snapshot.fingerprint).toBe(
      (await adapter.captureStableSnapshot(envelope, "pre")).fingerprint,
    );
  });
});
