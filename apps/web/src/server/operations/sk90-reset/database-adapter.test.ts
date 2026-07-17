import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { bindDiscoveryEvidence, prepareResetRun } from "./artifact";
import { protectValue, sha256Digest } from "./canonical";
import {
  assertConcurrentWriteStop,
  assertFreshDatabaseMutationAuthorization,
  assertNoUnresolvedPendingAudioUploads,
  collectCatalogFingerprint,
  collectDatabaseStorageReferencesFingerprint,
  Sk90DatabaseRehearsalAdapter,
  SK90_POST_RESET_EMPTY_TABLES,
  SK90_POST_RESET_LOCK_TABLES,
  SK90_REQUIRED_LOCK_TABLES,
  SK90_RESET_SOURCE_TABLES,
  type NeonPoolClientLike,
  type NeonPoolLike,
} from "./database-adapter";
import {
  SK90_APPROVED_RESET_INVENTORY,
  buildSanitizedManifest,
  buildStorageReferenceCoverage,
  fingerprintStorageReferences,
} from "./manifest";
import {
  assertRehearsalTarget,
  authorizeFreshTargetAction,
  buildMockEvidenceCoverage,
  mockEvidenceObservationDigest,
  rehearsalTargetPolicyDigest,
  targetObservationDigest,
  type MockEvidence,
  type RehearsalTargetPolicy,
} from "./policy";
import type { StorageReference } from "./storage";

const STORAGE_HMAC_KEY = "database-storage-reference-test-key-at-least-32-bytes";
const AUTH_ISSUED_AT = "2026-07-17T10:00:00.000Z";
const AUTH_EXPIRES_AT = "2026-07-17T10:04:00.000Z";
const AUTH_CURRENT_TIME = "2026-07-17T10:01:00.000Z";

function secondRunAuthorizationFixture() {
  const databaseFingerprint = sha256Digest("database-adapter-noop-database");
  const storageFingerprint = sha256Digest("database-adapter-noop-storage");
  const policy: RehearsalTargetPolicy = {
    targetClass: "isolated_nonproduction",
    database: {
      observed: databaseFingerprint,
      approved: databaseFingerprint,
      forbidden: [sha256Digest("canonical-database"), sha256Digest("frozen-database")],
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
  const target = assertRehearsalTarget(policy, rehearsalTargetPolicyDigest(policy));
  const rows = SK90_APPROVED_RESET_INVENTORY.flatMap((inventory) =>
    Array.from({ length: inventory.count }, (_, index) => ({
      category: inventory.category,
      table: inventory.table,
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      payload: { index },
    })),
  );
  const identityTokens = Array.from({ length: 4 }, (_, index) =>
    protectValue(STORAGE_HMAC_KEY, `noop-identity-${String(index)}`),
  );
  const monetaryTokens = Array.from({ length: 3 }, (_, index) =>
    protectValue(STORAGE_HMAC_KEY, `noop-money-${String(index)}`),
  );
  const providerTokens = Array.from({ length: 7 }, (_, index) =>
    protectValue(STORAGE_HMAC_KEY, `noop-provider-${String(index)}`),
  );
  const mockEvidence: MockEvidence = {
    identities: identityTokens.map((token) => ({
      token,
      classification: "approved_test",
      attested: true,
    })),
    monetaryRows: monetaryTokens.map((token) => ({
      token,
      classification: "approved_mock_test",
      attested: true,
    })),
    providerReferences: providerTokens.map((token) => ({
      token,
      provider: "stripe",
      mode: "test",
      attested: true,
      chargeEnabled: false,
      externalCharge: false,
      liveSchedule: false,
    })),
  };
  const storageReferences = [
    ...Array.from({ length: 7 }, (_, index) => ({
      bucketRole: "audio" as const,
      key: `noop/reset-${String(index)}.wav`,
      referencedBy: "reset" as const,
      exists: true,
      ownershipVerified: true,
      contentFingerprint: sha256Digest(`noop-content-${String(index)}`),
    })),
    {
      bucketRole: "docs" as const,
      key: "noop/preserved.pdf",
      referencedBy: "preserved" as const,
      exists: true,
      ownershipVerified: true,
      contentFingerprint: sha256Digest("noop-preserved-content"),
    },
  ];
  const protectedReferences = storageReferences.map((reference) => ({
    ...reference,
    protectedKey: protectValue(
      STORAGE_HMAC_KEY,
      `storage-key\0${reference.bucketRole}\0${reference.key}`,
    ),
  }));
  const manifest = buildSanitizedManifest(
    {
      artifactVersion: "sk90-reset-v1",
      targetPolicyDigest: target.policyDigest,
      preSchemaFingerprint: sha256Digest("noop-pre-schema"),
      reviewedTargetSchemaFingerprint: sha256Digest("noop-post-schema"),
      preservedRowCountsFingerprint: sha256Digest("noop-preserved-counts"),
      preservedBusinessFingerprint: sha256Digest("noop-preserved-business"),
      mockEvidenceCoverage: buildMockEvidenceCoverage({
        identityTokens,
        monetaryRowTokens: monetaryTokens,
        providerReferenceTokens: providerTokens,
      }),
      storageReferenceCoverage: buildStorageReferenceCoverage(protectedReferences),
      rows,
      storageReferences,
    },
    STORAGE_HMAC_KEY,
  );
  const reviewedBaseline = {
    manifestDigest: manifest.digest,
    schemaFingerprint: manifest.preSchemaFingerprint,
    resetRowsFingerprint: manifest.resetRowsFingerprint,
    preservedRowCountsFingerprint: manifest.preservedRowCountsFingerprint,
    preservedBusinessFingerprint: manifest.preservedBusinessFingerprint,
    storageReferencesFingerprint: manifest.storageReferencesFingerprint,
  };
  const prepared = prepareResetRun({
    artifactVersion: "sk90-reset-v1",
    target,
    manifest,
    mockEvidence,
    reviewedBaseline,
    discoveryEvidence: bindDiscoveryEvidence({
      challengeToken: protectValue(STORAGE_HMAC_KEY, "noop-discovery"),
      targetObservationDigest: targetObservationDigest(target),
      resetRowsObservationDigest: manifest.resetRowsFingerprint,
      mockEvidenceObservationDigest: mockEvidenceObservationDigest(mockEvidence),
      storageReferencesObservationDigest: manifest.storageReferencesFingerprint,
      storageEnumerationDigest: sha256Digest("noop-storage-enumeration"),
    }),
  });
  const challengeToken = protectValue(STORAGE_HMAC_KEY, "noop-action-challenge");
  const freshAuthorization = authorizeFreshTargetAction({
    action: "noop",
    artifactDigest: prepared.artifact.digest,
    approvedTarget: prepared.artifact.target,
    freshPolicy: policy,
    challengeToken,
    issuedAt: AUTH_ISSUED_AT,
    expiresAt: AUTH_EXPIRES_AT,
  });
  return {
    artifact: prepared.artifact,
    expectedRows: rows.map(({ table, id }) => ({ table, id })),
    challengeToken,
    freshAuthorization,
  };
}

function source(): string {
  return readFileSync(new URL("./database-adapter.ts", import.meta.url), "utf8");
}

function blockingProbePool(blocked = true): Readonly<{ pool: NeonPoolLike; statements: string[] }> {
  const statements: string[] = [];
  const pool: NeonPoolLike = {
    connect: () => {
      const client: NeonPoolClientLike = {
        query: (statement) => {
          statements.push(statement);
          if (blocked && (statement.startsWith("INSERT INTO") || statement.startsWith("UPDATE "))) {
            throw Object.assign(new Error("private database detail"), { code: "55P03" });
          }
          return Promise.resolve({ rows: [] });
        },
        release: () => undefined,
      };
      return Promise.resolve(client);
    },
  };
  return { pool, statements };
}

describe("SK-90 executable database rehearsal adapter", () => {
  it("locks the exact source boundary and keeps reset plus migration atomic", () => {
    const adapter = source();
    const executeSource = adapter.slice(adapter.indexOf("async execute"));

    expect(SK90_REQUIRED_LOCK_TABLES).toHaveLength(20);
    expect(new Set(SK90_REQUIRED_LOCK_TABLES).size).toBe(20);
    expect(SK90_RESET_SOURCE_TABLES).toHaveLength(12);
    expect(SK90_POST_RESET_EMPTY_TABLES).toHaveLength(20);
    expect(SK90_POST_RESET_LOCK_TABLES).toHaveLength(28);
    expect(new Set(SK90_POST_RESET_LOCK_TABLES).size).toBe(28);
    expect(adapter).toMatch(/BEGIN ISOLATION LEVEL SERIALIZABLE/);
    expect(adapter).toMatch(/pg_advisory_xact_lock/);
    expect(adapter).toMatch(/SHARE ROW EXCLUSIVE MODE/);
    expect(executeSource).toMatch(
      /SK90_MIGRATION_ADVISORY_LOCK_KEY[\s\S]*SK90_DATABASE_ADVISORY_LOCK_KEY[\s\S]*LOCK TABLE/,
    );
    expect(adapter).toMatch(/assertArtifactLockedSnapshot/);
    expect(adapter).toMatch(/await breakResetCycles\(client, expected\)/);
    expect(adapter).toMatch(/UPDATE[\s\S]*"id" = ANY\(\$1::uuid\[\]\)/);
    expect(adapter).toMatch(/DELETE FROM[\s\S]*RETURNING/);
    expect(adapter).toMatch(/await input\.applyCutoverInTransaction\(client, cutoverBinding\)/);
    expect(adapter).toMatch(/assertPostDatabaseEvidence/);
    expect(executeSource).toMatch(
      /assertConcurrentWriteStop[\s\S]*assertFreshDatabaseMutationAuthorization[\s\S]*stageProviderResetEvidence/,
    );
    expect(adapter).toMatch(/await client\.query\("COMMIT"\)/);
    expect(adapter).not.toMatch(/collectPostEvidence\?|runConcurrentProbe\?/);
    expect(adapter).not.toMatch(/collectStorageReferencesFingerprint:/);
    expect(executeSource).toMatch(/approvedStorageReferences/);
  });

  it("rechecks restored and ordinary post-reset states without a database mutation path", () => {
    const adapter = source();
    const restoredVerifier = adapter.slice(
      adapter.indexOf("async verifyRestoredBaseline"),
      adapter.indexOf("async verifySecondRunNoOp"),
    );
    const secondRunVerifier = adapter.slice(adapter.indexOf("async verifySecondRunNoOp"));

    expect(restoredVerifier).toMatch(/collectBaselineSnapshot[\s\S]*collectBaselineSnapshot/);
    expect(restoredVerifier).toMatch(/RESTORE_PROOF_MISMATCH/);
    expect(secondRunVerifier).toMatch(/skitza_migrations[\s\S]*0027_purchase_foundation\.sql/);
    expect(secondRunVerifier).toMatch(
      /collectPostResetDatabaseEvidence[\s\S]*collectPostResetDatabaseEvidence/,
    );
    expect(secondRunVerifier).toMatch(/IDEMPOTENCY_PROOF_MISMATCH/);
    expect(secondRunVerifier).toMatch(/databaseStateFingerprint: sha256Digest/);
    expect(secondRunVerifier).toMatch(/databaseMutationCount: 0/);
    expect(secondRunVerifier).not.toMatch(/DELETE FROM|UPDATE "public"|INSERT INTO/);
  });

  it("keeps the exact reviewed baseline locked while pg_dump consumes an exported snapshot", () => {
    const adapter = source();
    const snapshotBoundary = adapter.slice(
      adapter.indexOf("async withVerifiedBaselineSnapshot"),
      adapter.indexOf("async verifyRestoredBaseline"),
    );

    expect(snapshotBoundary).toMatch(
      /SK90_MIGRATION_ADVISORY_LOCK_KEY[\s\S]*SK90_DATABASE_ADVISORY_LOCK_KEY[\s\S]*SK90_REQUIRED_LOCK_TABLES/,
    );
    expect(snapshotBoundary).toMatch(
      /collectBaselineSnapshot[\s\S]*pg_export_snapshot[\s\S]*input\.useSnapshot\(snapshotId\)[\s\S]*collectBaselineSnapshot/,
    );
    expect(snapshotBoundary).toMatch(/canonicalJson\(before\) !== canonicalJson\(after\)/);
    expect(snapshotBoundary).toMatch(/input\.useSnapshot[\s\S]*await client\.query\("COMMIT"\)/);
  });

  it("executes the exact empty reset and cutover verifier on the real second run", () => {
    const adapter = source();
    const secondRun = adapter.slice(
      adapter.indexOf("async executeSecondRunNoOp"),
      adapter.indexOf("async verifySecondRunNoOp"),
    );

    expect(secondRun).toMatch(/expectedRowsByTable\(input\.expectedRows\)/);
    expect(secondRun).toMatch(
      /SK90_MIGRATION_ADVISORY_LOCK_KEY[\s\S]*SK90_DATABASE_ADVISORY_LOCK_KEY[\s\S]*SK90_POST_RESET_LOCK_TABLES/,
    );
    expect(secondRun).toMatch(
      /assertAppliedCutoverDigest[\s\S]*collectPostResetDatabaseEvidence[\s\S]*assertConcurrentWriteStop[\s\S]*attemptEmptyPostResetDeletionPath[\s\S]*input\.applyCutoverInTransaction\(client, cutoverBinding\)[\s\S]*assertAppliedCutoverDigest[\s\S]*collectPostResetDatabaseEvidence/,
    );
    expect(secondRun).toMatch(/assertFreshTargetAuthorization[\s\S]*executionApprovalDigest/);
    expect(adapter).toMatch(
      /attemptEmptyPostResetDeletionPath[\s\S]*SELECT count\(\*\)[\s\S]*DELETE FROM[\s\S]*ANY\(\$1::uuid\[\]\)[\s\S]*RETURNING[\s\S]*rowCount !== 0/,
    );
    expect(secondRun).toMatch(/canonicalJson\(before\) !== canonicalJson\(after\)/);
    expect(secondRun).toMatch(/deletedRowCount[\s\S]*await client\.query\("COMMIT"\)/);
  });

  it("accepts the runner's fresh noop authorization before opening the second-run transaction", async () => {
    const fixture = secondRunAuthorizationFixture();
    let connectCount = 0;
    const unavailablePool: NeonPoolLike = {
      connect: () => {
        connectCount += 1;
        return Promise.reject(new Error("private unavailable target detail"));
      },
    };
    const adapter = new Sk90DatabaseRehearsalAdapter(
      unavailablePool,
      unavailablePool,
      () => new Date(AUTH_CURRENT_TIME),
    );

    await expect(
      adapter.executeSecondRunNoOp({
        artifact: fixture.artifact,
        hmacKey: STORAGE_HMAC_KEY,
        expectedRows: fixture.expectedRows,
        migrationDigest: "a".repeat(64),
        freshAuthorization: fixture.freshAuthorization,
        actionChallengeToken: fixture.challengeToken,
        currentTime: AUTH_CURRENT_TIME,
        executionApprovalDigest: sha256Digest("noop-execution-approval"),
        applyCutoverInTransaction: () => Promise.resolve(),
      }),
    ).rejects.toMatchObject({ code: "UNEXPECTED_FAILURE" });
    expect(connectCount).toBe(1);
  });

  it("stops before mutation when a delayed lock crosses the authorization expiry", () => {
    const fixture = secondRunAuthorizationFixture();
    let mutationCalled = false;

    expect(() => {
      assertFreshDatabaseMutationAuthorization(
        {
          freshAuthorization: fixture.freshAuthorization,
          action: "noop",
          artifactDigest: fixture.artifact.digest,
          actionChallengeToken: fixture.challengeToken,
          targetObservationDigest: targetObservationDigest(fixture.artifact.target),
        },
        new Date("2026-07-17T10:05:00.000Z"),
      );
      mutationCalled = true;
    }).toThrow(/stale/i);
    expect(mutationCalled).toBe(false);
  });

  it("proves a second session cannot insert or update during the final lock window", async () => {
    const probe = blockingProbePool();

    await expect(assertConcurrentWriteStop(probe.pool)).resolves.toBeUndefined();

    expect(probe.statements.filter((statement) => statement === "BEGIN")).toHaveLength(2);
    expect(probe.statements.filter((statement) => statement === "ROLLBACK")).toHaveLength(2);
    expect(probe.statements.some((statement) => statement.startsWith("INSERT INTO"))).toBe(true);
    expect(probe.statements.some((statement) => statement.startsWith("UPDATE "))).toBe(true);
  });

  it("fails closed if either concurrent write is not blocked", async () => {
    const probe = blockingProbePool(false);

    await expect(assertConcurrentWriteStop(probe.pool)).rejects.toMatchObject({
      code: "LOCK_CONTRACT_INVALID",
    });
  });

  it("fingerprints catalog evidence without leaking it", async () => {
    const client: NeonPoolClientLike = {
      query: ((statement: string) => {
        expect(statement).toContain("pg_constraint");
        expect(statement).toContain("pg_get_triggerdef");
        expect(statement).toContain("pg_get_function_identity_arguments");
        return Promise.resolve({
          rows: [{ kind: "column", identity: "public.projects.id", definition: "uuid|true|none" }],
        });
      }) as NeonPoolClientLike["query"],
      release: () => undefined,
    };

    await expect(collectCatalogFingerprint(client)).resolves.toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("accepts the pre-0027 absence or an empty complete pending-upload journal", async () => {
    const preCutover: NeonPoolClientLike = {
      query: () => Promise.resolve({ rows: [] }),
      release: () => undefined,
    };
    await expect(assertNoUnresolvedPendingAudioUploads(preCutover)).resolves.toBeUndefined();

    let call = 0;
    const completed: NeonPoolClientLike = {
      query: (() => {
        call += 1;
        return Promise.resolve(
          call === 1
            ? {
                rows: [
                  { column_name: "pending_audio_cleanup_etag" },
                  { column_name: "pending_audio_completion_token" },
                  { column_name: "pending_audio_r2_key" },
                  { column_name: "pending_audio_size_bytes" },
                  { column_name: "pending_audio_started_at" },
                ],
              }
            : { rows: [{ count: "0" }] },
        );
      }) as NeonPoolClientLike["query"],
      release: () => undefined,
    };
    await expect(assertNoUnresolvedPendingAudioUploads(completed)).resolves.toBeUndefined();
  });

  it("hard-stops partial journal schemas and unresolved pending object references", async () => {
    const partial: NeonPoolClientLike = {
      query: (() =>
        Promise.resolve({
          rows: [{ column_name: "pending_audio_r2_key" }],
        })) as NeonPoolClientLike["query"],
      release: () => undefined,
    };
    await expect(assertNoUnresolvedPendingAudioUploads(partial)).rejects.toMatchObject({
      code: "STORAGE_ENUMERATION_MISMATCH",
    });

    let call = 0;
    const unresolved: NeonPoolClientLike = {
      query: (() => {
        call += 1;
        return Promise.resolve(
          call === 1
            ? {
                rows: [
                  { column_name: "pending_audio_cleanup_etag" },
                  { column_name: "pending_audio_completion_token" },
                  { column_name: "pending_audio_r2_key" },
                  { column_name: "pending_audio_size_bytes" },
                  { column_name: "pending_audio_started_at" },
                ],
              }
            : { rows: [{ count: "1" }] },
        );
      }) as NeonPoolClientLike["query"],
      release: () => undefined,
    };
    await expect(assertNoUnresolvedPendingAudioUploads(unresolved)).rejects.toMatchObject({
      code: "STORAGE_ENUMERATION_MISMATCH",
    });
  });

  it("collects exact reset and preserved DB storage references on the locked client", async () => {
    const raw = [
      { bucketRole: "audio" as const, key: "reset-audio", referencedBy: "reset" as const },
      { bucketRole: "docs" as const, key: "reset-proof", referencedBy: "reset" as const },
      {
        bucketRole: "audio" as const,
        key: "preserved-peak",
        referencedBy: "preserved" as const,
      },
    ];
    const approved: StorageReference[] = raw.map((reference) => ({
      bucketRole: reference.bucketRole,
      protectedKey: protectValue(
        STORAGE_HMAC_KEY,
        `storage-key\0${reference.bucketRole}\0${reference.key}`,
      ),
      referencedBy: reference.referencedBy,
      exists: true,
      ownershipVerified: true,
      contentFingerprint: sha256Digest(reference.key),
    }));
    const client: NeonPoolClientLike = {
      query: ((statement: string) => {
        expect(statement).toContain('FROM "public"."track_versions"');
        expect(statement).toContain('FROM "public"."payment_proofs"');
        expect(statement).toContain('FROM "public"."portfolio_tracks"');
        expect(statement).toContain('"audio_r2_key"');
        expect(statement).toContain('"peaks_r2_key"');
        expect(statement).toContain('"storage_key"');
        return Promise.resolve({
          rows: raw.map((reference) => ({
            bucket_role: reference.bucketRole,
            object_key: reference.key,
            referenced_by: reference.referencedBy,
          })),
        });
      }) as NeonPoolClientLike["query"],
      release: () => undefined,
    };

    await expect(
      collectDatabaseStorageReferencesFingerprint(client, STORAGE_HMAC_KEY, approved),
    ).resolves.toBe(fingerprintStorageReferences(approved));
  });

  it("rejects missing, extra, duplicate, or substituted DB storage references", async () => {
    const approved: StorageReference[] = [
      {
        bucketRole: "audio",
        protectedKey: protectValue(STORAGE_HMAC_KEY, "storage-key\0audio\0approved-key"),
        referencedBy: "reset",
        exists: true,
        ownershipVerified: true,
        contentFingerprint: sha256Digest("approved-content"),
      },
    ];
    const clientFor = (rows: readonly Record<string, unknown>[]): NeonPoolClientLike => ({
      query: (() => Promise.resolve({ rows })) as NeonPoolClientLike["query"],
      release: () => undefined,
    });

    for (const rows of [
      [],
      [
        { bucket_role: "audio", object_key: "approved-key", referenced_by: "reset" },
        { bucket_role: "audio", object_key: "extra-key", referenced_by: "reset" },
      ],
      [
        { bucket_role: "audio", object_key: "approved-key", referenced_by: "reset" },
        { bucket_role: "audio", object_key: "approved-key", referenced_by: "reset" },
      ],
      [{ bucket_role: "audio", object_key: "substituted-key", referenced_by: "reset" }],
    ]) {
      await expect(
        collectDatabaseStorageReferencesFingerprint(clientFor(rows), STORAGE_HMAC_KEY, approved),
      ).rejects.toMatchObject({ code: "STORAGE_ENUMERATION_MISMATCH" });
    }
  });

  it("binds the exact seven provider attestations to the transaction", () => {
    const adapter = source();

    expect(adapter).toMatch(/evidence\.length !== 7/);
    expect(adapter).toMatch(/producer_stripe_account/);
    expect(adapter).toMatch(/booking_tranzila_confirmation/);
    expect(adapter).toMatch(/FROM "public"\."producers"[\s\S]*"stripe_account_id" IS NOT NULL/);
    expect(adapter).toMatch(
      /FROM "public"\."bookings"[\s\S]*"tranzila_confirmation_code" IS NOT NULL/,
    );
    expect(adapter).toMatch(/exactSortedStrings\(observedReferences, expectedReferences\)/);
    expect(adapter).toMatch(/provider-reference\\0\$\{row\.sourceKind\}/);
    expect(adapter).toMatch(/artifact\.mockEvidenceCoverage\.providerReferenceTokensFingerprint/);
    expect(adapter).toMatch(/assertFreshTargetAuthorization/);
    expect(adapter).toMatch(/skitza\.sk90_artifact_digest/);
    expect(adapter).toMatch(/skitza_0027_approved_provider_values/);
    expect(adapter).toMatch(/charge_enabled/);
    expect(adapter).toMatch(/external_charge/);
    expect(adapter).toMatch(/live_schedule/);
  });
});
