import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { approvalLedgerDirectoryFingerprint } from "./approval-consumption";
import { bindDiscoveryEvidence, prepareResetRun } from "./artifact";
import { canonicalJson, protectValue, sha256Digest, type Sha256Digest } from "./canonical";
import { bindExecutableResetApproval } from "./execution";
import {
  SK90_APPROVED_RESET_INVENTORY,
  buildSanitizedManifest,
  buildStorageReferenceCoverage,
} from "./manifest";
import {
  bindPrivateExecutionEnvelope,
  privateExecutionEnvelopeDigest,
  privateStorageNamespaceFingerprint,
} from "./private-envelope";
import {
  assertRehearsalTarget,
  buildMockEvidenceCoverage,
  mockEvidenceObservationDigest,
  rehearsalTargetPolicyDigest,
  targetObservationDigest,
  type MockEvidence,
  type RehearsalTargetPolicy,
} from "./policy";
import {
  adapterBackedPostStorageNamespaceFingerprint,
  adapterBackedResetPlanDigest,
  adapterBackedStorageRestorePointFingerprint,
  createAdapterBackedRehearsalPorts,
  type AdapterBackedRehearsalInput,
} from "./runner";
import type { Sk90R2RehearsalConfig } from "./storage-port";

const HMAC_KEY = "runner-composition-test-hmac-key-longer-than-32-bytes";
const NOW = new Date("2026-07-17T12:00:00.000Z");
const directories: string[] = [];

const STORAGE_CONFIG: Sk90R2RehearsalConfig = {
  endpoint: `https://${"a".repeat(32)}.r2.cloudflarestorage.com`,
  accessKeyId: "isolated-access-key",
  secretAccessKey: "isolated-secret-key-that-is-longer-than-32-bytes",
  buckets: { audio: "sk90-audio-fixture", docs: "sk90-docs-fixture" },
  namespace: "sk90-rehearsal/composition-fixture",
};

function policy(): RehearsalTargetPolicy {
  const database = sha256Digest("composition-database-target");
  const storage = sha256Digest("composition-storage-target");
  return {
    targetClass: "isolated_nonproduction",
    database: {
      observed: database,
      approved: database,
      forbidden: [sha256Digest("canonical-database"), sha256Digest("frozen-database")],
    },
    storage: {
      observed: storage,
      approved: storage,
      forbidden: [sha256Digest("live-storage")],
    },
    isolation: {
      databaseRestorePointReady: true,
      storageRestorePointReady: true,
      exclusiveStorageNamespace: true,
      exclusiveStorageWriter: true,
    },
  };
}

function providerReferences() {
  return Array.from({ length: 7 }, (_, index) => {
    const stripe = index < 3;
    return {
      sourceKind: stripe
        ? ("producer_stripe_account" as const)
        : ("booking_tranzila_confirmation" as const),
      ownerId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      providerValue: `test-provider-${String(index)}`,
      provider: stripe ? ("stripe" as const) : ("tranzila" as const),
      mode: "test" as const,
      attested: true as const,
      chargeEnabled: false as const,
      externalCharge: false as const,
      liveSchedule: false as const,
    };
  });
}

function fixtureMaterial(ledgerFingerprint: Sha256Digest) {
  const approvedPolicy = policy();
  const target = assertRehearsalTarget(approvedPolicy, rehearsalTargetPolicyDigest(approvedPolicy));
  const rawRows = SK90_APPROVED_RESET_INVENTORY.flatMap((inventory) =>
    Array.from({ length: inventory.count }, (_, index) => ({
      category: inventory.category,
      table: inventory.table,
      id: `fixture-${inventory.table}-${String(index)}`,
      payload: { index, table: inventory.table },
    })),
  );
  const rawStorageReferences = [
    ...Array.from({ length: 7 }, (_, index) => ({
      bucketRole: "audio" as const,
      key: `reset/object-${String(index)}.wav`,
      referencedBy: "reset" as const,
      exists: true,
      ownershipVerified: true,
      contentFingerprint: sha256Digest(`reset-object-${String(index)}`),
    })),
    {
      bucketRole: "docs" as const,
      key: "preserved/object.pdf",
      referencedBy: "preserved" as const,
      exists: true,
      ownershipVerified: true,
      contentFingerprint: sha256Digest("preserved-object"),
    },
  ];
  const protectedStorageReferences = rawStorageReferences.map((reference) => ({
    ...reference,
    protectedKey: protectValue(HMAC_KEY, `storage-key\0${reference.bucketRole}\0${reference.key}`),
  }));
  const providers = providerReferences();
  const identityTokens = Array.from({ length: 4 }, (_, index) =>
    protectValue(HMAC_KEY, `identity-${String(index)}`),
  );
  const monetaryTokens = Array.from({ length: 3 }, (_, index) =>
    protectValue(HMAC_KEY, `money-${String(index)}`),
  );
  const providerTokens = providers.map((reference) =>
    protectValue(
      HMAC_KEY,
      `provider-reference\0${reference.sourceKind}\0${reference.ownerId}\0${reference.providerValue}`,
    ),
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
    providerReferences: providerTokens.map((token, index) => ({
      token,
      provider: index < 3 ? ("stripe" as const) : ("tranzila" as const),
      mode: "test",
      attested: true,
      chargeEnabled: false,
      externalCharge: false,
      liveSchedule: false,
    })),
  };
  const manifest = buildSanitizedManifest(
    {
      artifactVersion: "sk90-reset-v1",
      targetPolicyDigest: target.policyDigest,
      preSchemaFingerprint: sha256Digest("pre-schema"),
      reviewedTargetSchemaFingerprint: sha256Digest("post-schema"),
      preservedRowCountsFingerprint: sha256Digest("preserved-row-counts"),
      preservedBusinessFingerprint: sha256Digest("preserved-business"),
      mockEvidenceCoverage: buildMockEvidenceCoverage({
        identityTokens,
        monetaryRowTokens: monetaryTokens,
        providerReferenceTokens: providerTokens,
      }),
      storageReferenceCoverage: buildStorageReferenceCoverage(protectedStorageReferences),
      rows: rawRows,
      storageReferences: rawStorageReferences,
    },
    HMAC_KEY,
  );
  const rawStorageObjects = rawStorageReferences.map((reference) => ({
    bucketRole: reference.bucketRole,
    key: reference.key,
    ownership:
      reference.referencedBy === "reset"
        ? ("reset_exclusive" as const)
        : ("preserved_only" as const),
    sizeBytes: 100,
    contentFingerprint: reference.contentFingerprint,
    metadataFingerprint: sha256Digest(`metadata-${reference.key}`),
  }));
  const provisionalEnvelope = bindPrivateExecutionEnvelope(
    {
      artifactDigest: sha256Digest("provisional-artifact"),
      manifestDigest: manifest.digest,
      targetPolicyDigest: target.policyDigest,
      rows: rawRows,
      storageReferences: rawStorageReferences.map(({ bucketRole, key, referencedBy }) => ({
        bucketRole,
        key,
        referencedBy,
      })),
      storageObjects: rawStorageObjects,
      providerReferences: providers,
    },
    HMAC_KEY,
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
      challengeToken: protectValue(HMAC_KEY, "discovery-challenge"),
      targetObservationDigest: targetObservationDigest(target),
      resetRowsObservationDigest: manifest.resetRowsFingerprint,
      mockEvidenceObservationDigest: mockEvidenceObservationDigest(mockEvidence),
      storageReferencesObservationDigest: manifest.storageReferencesFingerprint,
      storageEnumerationDigest: privateStorageNamespaceFingerprint(provisionalEnvelope, HMAC_KEY),
    }),
  });
  const privateEnvelope = bindPrivateExecutionEnvelope(
    {
      ...provisionalEnvelope,
      artifactDigest: prepared.artifact.digest,
    },
    HMAC_KEY,
  );
  const migration = {
    filename: "0027_purchase_foundation.sql" as const,
    content: "-- exact composition fixture migration\nSELECT 1",
    digest: sha256Digest("-- exact composition fixture migration\nSELECT 1"),
    createApproval: vi.fn(() => ({})),
    applyMigrationInTransaction: vi.fn(() => Promise.resolve()),
  };
  const privateEnvelopeDigest = privateExecutionEnvelopeDigest(privateEnvelope);
  const executionApproval = bindExecutableResetApproval({
    contract: "sk90-executable-reset-approval-v1",
    artifactDigest: prepared.artifact.digest,
    manifestDigest: manifest.digest,
    policyDigest: target.policyDigest,
    targetDatabaseFingerprint: target.databaseFingerprint,
    targetStorageFingerprint: target.storageFingerprint,
    resetPlanDigest: adapterBackedResetPlanDigest({
      artifactDigest: prepared.artifact.digest,
      manifestDigest: manifest.digest,
      migrationDigest: migration.digest,
      privateEnvelopeDigest,
    }),
    migrationDigest: migration.digest,
    privateEnvelopeDigest,
    approvalLedgerDirectoryFingerprint: ledgerFingerprint,
    evidenceObservationDigest: prepared.artifact.discoveryEvidence.bindingDigest,
    preStorageNamespaceFingerprint: privateStorageNamespaceFingerprint(privateEnvelope, HMAC_KEY),
    postStorageNamespaceFingerprint: adapterBackedPostStorageNamespaceFingerprint(
      privateEnvelope,
      HMAC_KEY,
    ),
    databaseRestorePointFingerprint: sha256Digest("approved-backup"),
    storageRestorePointFingerprint: adapterBackedStorageRestorePointFingerprint({
      artifactDigest: prepared.artifact.digest,
      privateEnvelope,
      hmacKey: HMAC_KEY,
      storageConfig: STORAGE_CONFIG,
    }),
    approvalChallengeToken: protectValue(HMAC_KEY, "approval-challenge"),
    approvedAt: "2026-07-17T11:59:00.000Z",
    expiresAt: "2026-07-17T12:04:00.000Z",
  });
  return {
    approvedPolicy,
    artifact: prepared.artifact,
    manifest,
    privateEnvelope,
    migration,
    executionApproval,
  };
}

async function input(): Promise<
  AdapterBackedRehearsalInput & {
    poolFactory: ReturnType<typeof vi.fn>;
    storageFactory: ReturnType<typeof vi.fn>;
    recoveryFactory: ReturnType<typeof vi.fn>;
  }
> {
  const directory = await mkdtemp(join(tmpdir(), "sk90-composition-"));
  directories.push(directory);
  const approvalFilePath = join(directory, "approval.json");
  const approvalLedgerDirectory = join(directory, "approval-ledger");
  const stateDirectory = join(directory, "state");
  await writeFile(approvalFilePath, canonicalJson({ private: true }), { mode: 0o600 });
  await mkdir(approvalLedgerDirectory, { mode: 0o700 });
  await mkdir(stateDirectory, { mode: 0o700 });
  const material = fixtureMaterial(
    approvalLedgerDirectoryFingerprint(await realpath(approvalLedgerDirectory)),
  );
  const neverConnect = () => Promise.reject(new Error("must not connect during composition"));
  const poolFactory = vi.fn(() => ({
    transactionPool: { connect: neverConnect },
    concurrentProbePool: { connect: neverConnect },
  }));
  const storageFactory = vi.fn(() => ({
    send: () => Promise.reject(new Error("must not call storage during composition")),
  }));
  const recoveryFactory = vi.fn(() => ({
    prepareBackup: () => Promise.reject(new Error("must not prepare during composition")),
    requireApprovedBackup: () =>
      Promise.reject(new Error("must not load a backup during composition")),
    revalidateApprovedBackup: () =>
      Promise.reject(new Error("must not validate a backup during composition")),
    requirePreparedRestore: () =>
      Promise.reject(new Error("must not validate a prepared restore during composition")),
    requireExecutedRestore: () =>
      Promise.reject(new Error("must not validate a restore during composition")),
    restore: () => Promise.reject(new Error("must not restore during composition")),
  }));
  return {
    ...material,
    approvedExecutionDigest: material.executionApproval.digest,
    approvalFilePath,
    approvalLedgerDirectory,
    stateDirectory,
    hmacKey: HMAC_KEY,
    storageConfig: STORAGE_CONFIG,
    createTargetObserver: () => ({
      observe: () => Promise.reject(new Error("must not observe during composition")),
      freshChallenge: () => Promise.resolve(protectValue(HMAC_KEY, "fresh")),
    }),
    createDatabasePools: poolFactory,
    createStorageClient: storageFactory,
    createDatabaseRecovery: recoveryFactory,
    now: () => NOW,
    poolFactory,
    storageFactory,
    recoveryFactory,
  };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("SK-90 concrete adapter composition", () => {
  it("builds rollback proof from approved baseline evidence and durable executed restores", () => {
    const runner = readFileSync(new URL("./runner.ts", import.meta.url), "utf8");
    const verifier = runner.slice(
      runner.indexOf("async verifyRestored("),
      runner.indexOf("async runSecondTime("),
    );

    expect(verifier).toMatch(
      /restoreReceipt\.mutations\.storageCopies[\s\S]*requireExecutedRestore[\s\S]*#approvedBaselineIntegritySnapshot\(\)[\s\S]*before,[\s\S]*databaseRestore\.restoreDisposition === "executed"/,
    );
    expect(verifier).not.toContain("before: restored");
  });

  it("checks database state and freshness before force-replaying storage restore", () => {
    const runner = readFileSync(new URL("./runner.ts", import.meta.url), "utf8");
    const restore = runner.slice(
      runner.indexOf("async restore("),
      runner.indexOf("#integritySnapshot("),
    );

    expect(restore).toMatch(
      /#observeDatabaseState\(\)[\s\S]*DATABASE_VERIFICATION_MISMATCH[\s\S]*forceReplay: true[\s\S]*assertDatabaseRecoveryReady\(context\)[\s\S]*restoreResetObjects\([\s\S]*forceReplay: true/,
    );
    expect(restore).toMatch(
      /observedDatabase === "mixed"[\s\S]*requirePreparedRestore\(restoreSelector\)[\s\S]*resumePrepared = true/,
    );
  });

  it("binds a committed rollback crash gap to an exact fresh reconciliation receipt", () => {
    const runner = readFileSync(new URL("./runner.ts", import.meta.url), "utf8");
    const start = runner.indexOf("async reconcileRollbackInterruption(");
    const reconciliation = runner.slice(start, runner.indexOf("\n  #assertFreshAtBoundary", start));

    expect(reconciliation).toMatch(
      /#authorization\(context\)[\s\S]*#observeDatabaseState\(\)[\s\S]*point === "before_database_commit"[\s\S]*adapterReceipt\([\s\S]*resetRowCount/,
    );
  });

  it("passes a fresh wall-clock authorization check into every storage mutation loop", () => {
    const runner = readFileSync(new URL("./runner.ts", import.meta.url), "utf8");
    const quarantine = runner.slice(
      runner.indexOf("async quarantine("),
      runner.indexOf("async assertDatabaseRecoveryReady"),
    );
    const reconcile = runner.slice(
      runner.indexOf('if (phase === "quarantine_started")'),
      runner.indexOf('if (phase === "database_reset_started")'),
    );

    expect(quarantine).toMatch(
      /requireApprovedBackup[\s\S]*quarantineResetObjects\([\s\S]*assertAuthorizationFresh:\s*\(\) =>\s*\{[\s\S]*this\.#assertFreshAtBoundary\(context\);[\s\S]*\}/,
    );
    expect(reconcile).toMatch(
      /requireApprovedBackup[\s\S]*quarantineResetObjects\([\s\S]*assertAuthorizationFresh:\s*\(\) =>\s*\{[\s\S]*this\.#assertFreshAtBoundary\(context\);[\s\S]*\}/,
    );

    for (const method of ["deleteResetObjects", "restoreResetObjects"]) {
      expect(runner).toMatch(
        new RegExp(
          `${method}\\([\\s\\S]*?assertAuthorizationFresh:\\s*\\(\\) =>\\s*\\{[\\s\\S]*?this\\.#assertFreshAtBoundary\\(context\\);[\\s\\S]*?\\}`,
        ),
      );
    }
  });

  it("consumes the exact approval before constructing real adapter dependencies", async () => {
    const exact = await input();
    exact.poolFactory.mockImplementation(() => {
      const sidecar = join(
        exact.approvalLedgerDirectory,
        `.sk90-execution-${exact.executionApproval.digest.slice("sha256:".length)}.consumed.json`,
      );
      expect(existsSync(sidecar)).toBe(true);
      return {
        transactionPool: { connect: () => Promise.reject(new Error("unused")) },
        concurrentProbePool: { connect: () => Promise.reject(new Error("unused")) },
      };
    });

    await expect(createAdapterBackedRehearsalPorts(exact)).resolves.toBeDefined();
    expect(exact.poolFactory).toHaveBeenCalledOnce();
    expect(exact.storageFactory).toHaveBeenCalledOnce();
    expect(exact.recoveryFactory).toHaveBeenCalledOnce();
  });

  it("rejects a substituted full storage enumeration before any client construction", async () => {
    const exact = await input();
    const first = exact.privateEnvelope.storageObjects[0];
    if (!first) throw new Error("fixture requires storage");
    const privateEnvelope = bindPrivateExecutionEnvelope(
      {
        ...exact.privateEnvelope,
        storageObjects: [
          { ...first, metadataFingerprint: sha256Digest("substituted-metadata") },
          ...exact.privateEnvelope.storageObjects.slice(1),
        ],
      },
      HMAC_KEY,
    );

    await expect(
      createAdapterBackedRehearsalPorts({ ...exact, privateEnvelope }),
    ).rejects.toMatchObject({ code: "EXECUTION_APPROVAL_MISMATCH" });
    expect(exact.poolFactory).not.toHaveBeenCalled();
    expect(exact.storageFactory).not.toHaveBeenCalled();
    expect(exact.recoveryFactory).not.toHaveBeenCalled();
  });

  it("rejects a changed approval ledger before constructing any external client", async () => {
    const exact = await input();
    const substitutedLedger = join(exact.stateDirectory, "substituted-ledger");
    await mkdir(substitutedLedger, { mode: 0o700 });

    await expect(
      createAdapterBackedRehearsalPorts({
        ...exact,
        approvalLedgerDirectory: substitutedLedger,
      }),
    ).rejects.toMatchObject({ code: "EXECUTION_APPROVAL_MISMATCH" });
    expect(exact.poolFactory).not.toHaveBeenCalled();
    expect(exact.storageFactory).not.toHaveBeenCalled();
    expect(exact.recoveryFactory).not.toHaveBeenCalled();
  });
});
