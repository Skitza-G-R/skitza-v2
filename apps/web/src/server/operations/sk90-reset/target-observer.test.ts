import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";

import { sha256Digest } from "./canonical";
import type { NeonPoolClientLike, NeonPoolLike, PgQueryResult } from "./database-adapter";
import { rehearsalTargetPolicyDigest, type RehearsalTargetPolicy } from "./policy";
import type { TargetObservationRequest } from "./runner";
import type { Sk90R2RehearsalConfig, Sk90S3Client } from "./storage-port";
import {
  assertActiveTargetObserverConfiguration,
  assertChallengeBoundTargetObservation,
  challengeBoundTargetObservationDigest,
  createActiveSk90TargetObserver,
  databaseTargetFingerprint,
  storageTargetFingerprint,
  targetAttestationObjectKey,
  type ActiveTargetObserverInput,
} from "./target-observer";

const HMAC_KEY = "target-observer-test-key-with-at-least-32-bytes";
const CURRENT_DATABASE = "private_sk90_rehearsal";
const PRIVATE_DATABASE_MARKER = "private-database-marker-not-for-output";
const AUDIO_BYTES = new TextEncoder().encode("private audio target attestation");
const DOCS_BYTES = new TextEncoder().encode("private docs target attestation");
const AUDIO_ETAG = '"private-audio-etag"';
const DOCS_ETAG = '"private-docs-etag"';

const STORAGE_CONFIG: Sk90R2RehearsalConfig = {
  endpoint: "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
  accessKeyId: "isolated-access-key",
  secretAccessKey: "isolated-secret-access-key-with-more-than-32-bytes",
  buckets: {
    audio: "sk90-rehearsal-audio",
    docs: "sk90-rehearsal-docs",
  },
  namespace: "sk90-rehearsal/target-observer-test",
};

type MutableDatabaseIdentity = {
  currentDatabase: string;
  privateMarker: string;
};

class FakeDatabasePool implements NeonPoolLike {
  readonly statements: string[] = [];
  connectCount = 0;
  releaseCount = 0;
  queryFailure: Error | null = null;
  extraRow = false;

  constructor(readonly identity: MutableDatabaseIdentity) {}

  connect(): Promise<NeonPoolClientLike> {
    this.connectCount += 1;
    return Promise.resolve({
      query: <Row extends Record<string, unknown>>(
        statement: string,
      ): Promise<PgQueryResult<Row>> => {
        this.statements.push(statement);
        if (this.queryFailure) return Promise.reject(this.queryFailure);
        const rows = this.extraRow ? [this.identity, { ...this.identity }] : [this.identity];
        return Promise.resolve({
          rows: rows as unknown as readonly Row[],
          rowCount: rows.length,
        });
      },
      release: (): void => {
        this.releaseCount += 1;
      },
    });
  }
}

class FakeStorage {
  readonly commands: GetObjectCommand[] = [];
  readonly fullyConsumedRoles: string[] = [];
  substituteDocsBody = false;

  send(command: unknown): Promise<unknown> {
    if (!(command instanceof GetObjectCommand)) throw new Error("unexpected private command");
    this.commands.push(command);
    const bucket = command.input.Bucket;
    const isAudio = bucket === STORAGE_CONFIG.buckets.audio;
    const role = isAudio ? "audio" : "docs";
    const expectedEtag = isAudio ? AUDIO_ETAG : DOCS_ETAG;
    const originalBytes = isAudio ? AUDIO_BYTES : DOCS_BYTES;
    const bytes =
      !isAudio && this.substituteDocsBody
        ? new TextEncoder().encode("private docs target attestatioN")
        : originalBytes;
    const first = bytes.slice(0, Math.ceil(bytes.byteLength / 2));
    const second = bytes.slice(first.byteLength);
    const consumed = this.fullyConsumedRoles;
    return Promise.resolve({
      ETag: expectedEtag,
      ContentLength: bytes.byteLength,
      Body: (async function* () {
        yield first;
        await Promise.resolve();
        yield second;
        consumed.push(role);
      })(),
    });
  }
}

function asClient(fake: FakeStorage): Sk90S3Client {
  return fake as unknown as Pick<S3Client, "send">;
}

function request(
  challengeToken: Awaited<
    ReturnType<ReturnType<typeof observerFixture>["observer"]["freshChallenge"]>
  >,
): TargetObservationRequest {
  return {
    action: "database_reset",
    challengeToken,
    issuedAt: "2026-07-17T10:00:00.000Z",
    expiresAt: "2026-07-17T10:04:00.000Z",
  };
}

function observerFixture() {
  const database = new FakeDatabasePool({
    currentDatabase: CURRENT_DATABASE,
    privateMarker: PRIVATE_DATABASE_MARKER,
  });
  const storage = new FakeStorage();
  const objectKey = targetAttestationObjectKey(STORAGE_CONFIG.namespace);
  const databaseFingerprint = databaseTargetFingerprint({
    currentDatabase: CURRENT_DATABASE,
    privateMarker: PRIVATE_DATABASE_MARKER,
  });
  const storageFingerprint = storageTargetFingerprint({
    endpointOrigin: new URL(STORAGE_CONFIG.endpoint).origin,
    namespace: STORAGE_CONFIG.namespace,
    attestations: [
      {
        bucketRole: "audio",
        bucket: STORAGE_CONFIG.buckets.audio,
        objectKey,
        etag: AUDIO_ETAG,
        sizeBytes: AUDIO_BYTES.byteLength,
        contentFingerprint: sha256Digest(new TextDecoder().decode(AUDIO_BYTES)),
      },
      {
        bucketRole: "docs",
        bucket: STORAGE_CONFIG.buckets.docs,
        objectKey,
        etag: DOCS_ETAG,
        sizeBytes: DOCS_BYTES.byteLength,
        contentFingerprint: sha256Digest(new TextDecoder().decode(DOCS_BYTES)),
      },
    ],
  });
  const policy: RehearsalTargetPolicy = {
    targetClass: "isolated_nonproduction",
    database: {
      observed: databaseFingerprint,
      approved: databaseFingerprint,
      forbidden: [sha256Digest("live-db"), sha256Digest("frozen-db")],
    },
    storage: {
      observed: storageFingerprint,
      approved: storageFingerprint,
      forbidden: [sha256Digest("live-storage")],
    },
    isolation: {
      databaseRestorePointReady: true,
      storageRestorePointReady: true,
      exclusiveStorageNamespace: true,
      exclusiveStorageWriter: true,
    },
  };
  const input: ActiveTargetObserverInput = {
    hmacKey: HMAC_KEY,
    databasePool: database,
    storageClient: asClient(storage),
    storageConfig: STORAGE_CONFIG,
    databaseAttestation: {
      expectedCurrentDatabase: CURRENT_DATABASE,
      expectedPrivateMarker: PRIVATE_DATABASE_MARKER,
    },
    storageAttestations: {
      audio: {
        bucketRole: "audio",
        expectedEtag: AUDIO_ETAG,
        expectedSizeBytes: AUDIO_BYTES.byteLength,
        expectedContentFingerprint: sha256Digest(new TextDecoder().decode(AUDIO_BYTES)),
      },
      docs: {
        bucketRole: "docs",
        expectedEtag: DOCS_ETAG,
        expectedSizeBytes: DOCS_BYTES.byteLength,
        expectedContentFingerprint: sha256Digest(new TextDecoder().decode(DOCS_BYTES)),
      },
    },
    approvedPolicy: {
      targetClass: "isolated_nonproduction",
      policyDigest: rehearsalTargetPolicyDigest(policy),
      database: {
        approved: databaseFingerprint,
        forbidden: policy.database.forbidden as readonly ReturnType<typeof sha256Digest>[],
      },
      storage: {
        approved: storageFingerprint,
        forbidden: policy.storage.forbidden as readonly ReturnType<typeof sha256Digest>[],
      },
      isolation: policy.isolation,
    },
  };
  return {
    database,
    storage,
    input,
    observer: createActiveSk90TargetObserver(input),
    policy,
    objectKey,
  };
}

describe("active SK-90 target observer", () => {
  it("accepts both separately authorized partial-delete rollback actions", async () => {
    const fixture = observerFixture();

    const databaseChallenge = await fixture.observer.freshChallenge(
      "rollback_interrupt_database:after_partial_storage_delete",
    );
    const storageChallenge = await fixture.observer.freshChallenge(
      "rollback_interrupt_storage:after_partial_storage_delete",
    );

    expect(databaseChallenge).not.toBe(storageChallenge);
    expect(() =>
      fixture.observer.freshChallenge("rollback_interrupt:after_partial_storage_delete" as never),
    ).toThrow(expect.objectContaining({ code: "FRESH_TARGET_AUTHORIZATION_INVALID" }));
  });

  it("validates all private attestation bindings without using either client", () => {
    const fixture = observerFixture();
    const configuration = {
      hmacKey: fixture.input.hmacKey,
      storageConfig: fixture.input.storageConfig,
      databaseAttestation: fixture.input.databaseAttestation,
      storageAttestations: fixture.input.storageAttestations,
      approvedPolicy: fixture.input.approvedPolicy,
    };

    expect(assertActiveTargetObserverConfiguration(configuration)).toBe(true);
    expect(() =>
      assertActiveTargetObserverConfiguration({
        ...configuration,
        storageAttestations: {
          ...configuration.storageAttestations,
          docs: {
            ...configuration.storageAttestations.docs,
            expectedSizeBytes: DOCS_BYTES.byteLength + 1,
          },
        },
      }),
    ).toThrow(expect.objectContaining({ code: "TARGET_POLICY_MISMATCH" }));
    expect(fixture.database.connectCount).toBe(0);
    expect(fixture.storage.commands).toHaveLength(0);
  });

  it("actively queries the marker table and fully reads both authenticated storage attestations", async () => {
    const fixture = observerFixture();
    const challengeToken = await fixture.observer.freshChallenge("database_reset");
    const observation = await fixture.observer.observe(request(challengeToken));

    expect(fixture.database.connectCount).toBe(1);
    expect(fixture.database.releaseCount).toBe(1);
    expect(fixture.database.statements).toEqual([
      expect.stringContaining("FROM skitza_rehearsal.target_identity"),
    ]);
    expect(fixture.database.statements[0]).toContain("current_database()");
    expect(fixture.storage.commands).toHaveLength(2);
    expect(fixture.objectKey.startsWith(`${STORAGE_CONFIG.namespace}/`)).toBe(false);
    expect(
      fixture.storage.commands.map((command) => ({
        bucket: command.input.Bucket,
        key: command.input.Key,
        ifMatch: command.input.IfMatch,
      })),
    ).toEqual([
      {
        bucket: STORAGE_CONFIG.buckets.audio,
        key: fixture.objectKey,
        ifMatch: AUDIO_ETAG,
      },
      {
        bucket: STORAGE_CONFIG.buckets.docs,
        key: fixture.objectKey,
        ifMatch: DOCS_ETAG,
      },
    ]);
    expect(fixture.storage.fullyConsumedRoles).toEqual(["audio", "docs"]);
    expect(observation.policy).toEqual(fixture.policy);
    expect(observation.bindingDigest).toBe(challengeBoundTargetObservationDigest(observation));
    expect(assertChallengeBoundTargetObservation(observation)).toBe(true);
  });

  it("consumes each issued challenge before observation and rejects action substitution", async () => {
    const fixture = observerFixture();
    const challengeToken = await fixture.observer.freshChallenge("database_reset");
    await fixture.observer.observe(request(challengeToken));
    const connectCount = fixture.database.connectCount;

    await expect(fixture.observer.observe(request(challengeToken))).rejects.toMatchObject({
      code: "FRESHNESS_NONCE_REUSED",
    });
    expect(fixture.database.connectCount).toBe(connectCount);

    const substituted = await fixture.observer.freshChallenge("database_reset");
    await expect(
      fixture.observer.observe({
        ...request(substituted),
        action: "storage_delete",
      }),
    ).rejects.toMatchObject({ code: "FRESHNESS_NONCE_REUSED" });
    await expect(fixture.observer.observe(request(substituted))).rejects.toMatchObject({
      code: "FRESHNESS_NONCE_REUSED",
    });
    expect(fixture.database.connectCount).toBe(connectCount);
  });

  it("does not cache a prior target and rejects a substituted database marker", async () => {
    const fixture = observerFixture();
    const firstChallenge = await fixture.observer.freshChallenge("database_reset");
    await fixture.observer.observe(request(firstChallenge));
    fixture.database.identity.privateMarker = "substituted-private-marker";
    const secondChallenge = await fixture.observer.freshChallenge("database_reset");

    await expect(fixture.observer.observe(request(secondChallenge))).rejects.toMatchObject({
      code: "DATABASE_TARGET_MISMATCH",
    });
    expect(fixture.database.connectCount).toBe(2);
    expect(fixture.database.releaseCount).toBe(2);
  });

  it("binds the result to the exact challenge, action, and time window", async () => {
    const fixture = observerFixture();
    const challengeToken = await fixture.observer.freshChallenge("database_reset");
    const observation = await fixture.observer.observe(request(challengeToken));
    const substituteChallenge = await fixture.observer.freshChallenge("database_reset");

    expect(substituteChallenge).not.toBe(challengeToken);
    expect(() =>
      assertChallengeBoundTargetObservation({
        ...observation,
        challengeToken: substituteChallenge,
      }),
    ).toThrow(expect.objectContaining({ code: "FRESH_TARGET_AUTHORIZATION_INVALID" }));
    expect(
      challengeBoundTargetObservationDigest({
        ...observation,
        action: "storage_delete",
      }),
    ).not.toBe(observation.bindingDigest);
    expect(
      challengeBoundTargetObservationDigest({
        ...observation,
        expiresAt: "2026-07-17T10:03:59.000Z",
      }),
    ).not.toBe(observation.bindingDigest);
  });

  it("rejects substituted storage bytes after consuming the full body", async () => {
    const fixture = observerFixture();
    fixture.storage.substituteDocsBody = true;
    const challengeToken = await fixture.observer.freshChallenge("database_reset");

    await expect(fixture.observer.observe(request(challengeToken))).rejects.toMatchObject({
      code: "STORAGE_TARGET_MISMATCH",
    });
    expect(fixture.storage.fullyConsumedRoles).toEqual(["audio", "docs"]);
    expect(fixture.database.releaseCount).toBe(1);
  });

  it("redacts raw database failures and still releases the client", async () => {
    const fixture = observerFixture();
    fixture.database.queryFailure = new Error("private marker and database identifier leaked here");
    const challengeToken = await fixture.observer.freshChallenge("database_reset");

    let error: unknown;
    try {
      await fixture.observer.observe(request(challengeToken));
    } catch (failure: unknown) {
      error = failure;
    }
    expect(error).toMatchObject({ code: "UNEXPECTED_FAILURE" });
    expect(String(error)).not.toContain("private marker");
    expect(fixture.database.releaseCount).toBe(1);
  });
});
