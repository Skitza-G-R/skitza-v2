import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { protectValue, sha256Digest, type Sha256Digest } from "../sk90-reset/canonical";
import {
  bindPrivateExecutionEnvelope,
  type PrivateExecutionEnvelope,
} from "../sk90-reset/private-envelope";
import type { Sk104DatabaseBackupReceipt, Sk104DatabaseRestoreReceipt } from "./backup";
import { sk104ProductionTargetPolicyDigest } from "./contract";
import {
  SK104_APPROVED_MIGRATION_FILES,
  type Sk104PrivateProductionDatabaseManifest,
  type Sk104ProductionDatabaseReceipt,
  type Sk104ProductionMigrationTransactionPort,
  type Sk104RestoredBaselineReceipt,
} from "./database";
import type { Sk104CutoverEnvironment } from "./environment";
import {
  Sk104ProductionCutoverRunner,
  type Sk104DatabaseRuntime,
  type Sk104RunLeaseProof,
  type Sk104StorageRuntime,
} from "./runner";
import type {
  Sk104PrivateStorageDiscovery,
  Sk104ProductionStorageReceipt,
  Sk104StorageRestorePointReceipt,
  Sk104StorageRestoreReceipt,
  Sk104StorageVerificationReceipt,
} from "./storage";
import {
  SK104_CANONICAL_DATABASE_FINGERPRINT,
  SK104_FROZEN_DATABASE_FINGERPRINT,
} from "./target-observer";

const HMAC_KEY = "sk104-runner-test-hmac-key-longer-than-thirty-two";
const STORAGE_TARGET = sha256Digest("sk104-runner-storage-target");
const FROZEN_STORAGE_TARGET = sha256Digest("sk104-runner-frozen-storage-target");
const MIGRATION_BUNDLE = sha256Digest("sk104-runner-migration-bundle");
const DATABASE_RESTORE_POINT = sha256Digest("sk104-runner-database-restore-point");
const STORAGE_RESTORE_POINT = sha256Digest("sk104-runner-storage-restore-point");
const RELEASE_COMMIT = "a".repeat(40);
const BASE_TIME = new Date("2026-07-22T10:00:00.000Z");
const roots: string[] = [];

type EnvironmentOverrides = Partial<
  Pick<
    Sk104CutoverEnvironment,
    | "approvedExecutionDigest"
    | "userApprovedPlanDigest"
    | "noWriterConfirmed"
    | "privateApprovalLedgerDirectory"
    | "releaseCommit"
  >
>;

function privateDatabaseManifest(): Sk104PrivateProductionDatabaseManifest {
  return {
    contract: "sk104-private-production-database-manifest-v1",
    sourceSchemaFingerprint: sha256Digest("sk104-runner-source-schema"),
    resetRowsFingerprint: sha256Digest("sk104-runner-reset-rows"),
    preservedRowCountsFingerprint: sha256Digest("sk104-runner-preserved-counts"),
    preservedBusinessFingerprint: sha256Digest("sk104-runner-preserved-business"),
    storageReferencesFingerprint: sha256Digest("sk104-runner-storage-references"),
    mockEvidenceFingerprint: sha256Digest("sk104-runner-mock-evidence"),
    rows: [],
    storageReferences: [],
    mockEvidence: { identities: [], monetaryRows: [], providerReferences: [] },
    bindingToken: protectValue(HMAC_KEY, "sk104-runner-private-database"),
  };
}

function backupReceipt(manifestDigest: Sha256Digest): Sk104DatabaseBackupReceipt {
  return {
    contract: "sk104-production-database-backup-v2",
    manifestDigest,
    targetDatabaseFingerprint: SK104_CANONICAL_DATABASE_FINGERPRINT,
    protectedSnapshot: protectValue(HMAC_KEY, "sk104-runner-snapshot"),
    archiveFingerprint: sha256Digest("sk104-runner-backup-archive"),
    archiveSizeBytes: 128,
    restoreListVerified: true,
    archiveCreatesPublicSchema: true,
    preparedAt: BASE_TIME.toISOString(),
    bindingToken: protectValue(HMAC_KEY, "sk104-runner-backup-binding"),
    restorePointFingerprint: DATABASE_RESTORE_POINT,
  };
}

class FakeDatabase implements Sk104DatabaseRuntime {
  readonly operations: string[];
  state: "baseline" | "post" | "mixed" = "baseline";
  throwAfterCommitOnce = false;
  executeCalls = 0;
  reconcileCalls = 0;
  prepareBackupCalls = 0;
  tamperVerifiedBackup = false;

  constructor(operations: string[]) {
    this.operations = operations;
  }

  withExclusiveRunLease<Result>(
    input: Parameters<Sk104DatabaseRuntime["withExclusiveRunLease"]>[0],
    operation: (lease: Sk104RunLeaseProof) => Promise<Result>,
  ): Promise<Result> {
    this.operations.push("database:lease-acquired");
    return operation({
      parentProofAdvisoryLockKey: input.parentProofAdvisoryLockKey,
    }).finally(() => {
      this.operations.push("database:lease-released");
    });
  }

  inspectAttestedBaseline(): Promise<Sk104PrivateProductionDatabaseManifest> {
    this.operations.push("database:inspect");
    return Promise.resolve(privateDatabaseManifest());
  }

  prepareBackup(
    input: Parameters<Sk104DatabaseRuntime["prepareBackup"]>[0],
  ): Promise<Sk104DatabaseBackupReceipt> {
    this.operations.push("database:prepare-backup");
    this.prepareBackupCalls += 1;
    return Promise.resolve(backupReceipt(input.manifest.digest));
  }

  verifyBackup(
    input: Parameters<Sk104DatabaseRuntime["verifyBackup"]>[0],
  ): Promise<Sk104DatabaseBackupReceipt> {
    this.operations.push("database:verify-backup");
    const receipt = backupReceipt(input.manifest.digest);
    return Promise.resolve(
      this.tamperVerifiedBackup
        ? { ...receipt, archiveFingerprint: sha256Digest("tampered-backup") }
        : receipt,
    );
  }

  observeState(
    input: Parameters<Sk104DatabaseRuntime["observeState"]>[0],
  ): Promise<Awaited<ReturnType<Sk104DatabaseRuntime["observeState"]>>> {
    this.operations.push(`database:observe-${this.state}`);
    if (this.state === "mixed") return Promise.resolve({ state: "mixed" });
    if (this.state === "baseline") {
      return Promise.resolve({
        state: "baseline",
        databaseStateFingerprint: sha256Digest("sk104-runner-baseline-state"),
      });
    }
    return Promise.resolve({
      state: "post",
      migrationBundleDigest: input.expectedMigrationBundleDigest,
      databaseStateFingerprint: sha256Digest("sk104-runner-post-state"),
    });
  }

  execute(
    input: Parameters<Sk104DatabaseRuntime["execute"]>[0],
  ): Promise<Sk104ProductionDatabaseReceipt> {
    this.operations.push("database:execute");
    this.executeCalls += 1;
    this.state = "post";
    if (this.throwAfterCommitOnce) {
      this.throwAfterCommitOnce = false;
      return Promise.reject(new Error("simulated lost database completion"));
    }
    return Promise.resolve(this.#databaseReceipt(input));
  }

  reconcileCommitted(
    input: Parameters<Sk104DatabaseRuntime["reconcileCommitted"]>[0],
  ): Promise<Sk104ProductionDatabaseReceipt> {
    this.operations.push("database:reconcile-committed");
    this.reconcileCalls += 1;
    return Promise.resolve(this.#databaseReceipt(input));
  }

  #databaseReceipt(
    input:
      | Parameters<Sk104DatabaseRuntime["execute"]>[0]
      | Parameters<Sk104DatabaseRuntime["reconcileCommitted"]>[0],
  ): Sk104ProductionDatabaseReceipt {
    return {
      contract: "sk104-production-database-receipt-v1",
      manifestDigest: input.manifest.digest,
      approvalDigest: input.approval.digest,
      migrationBundleDigest: MIGRATION_BUNDLE,
      deletedRowCount: 114,
      sourceSchemaFingerprint: input.manifest.sourceSchemaFingerprint,
      targetSchemaFingerprint: input.manifest.targetSchemaFingerprint,
      preservedRowCountsFingerprint: input.manifest.preservedRowCountsFingerprint,
      preservedBusinessFingerprint: input.manifest.preservedBusinessFingerprint,
      databaseStateFingerprint: sha256Digest("sk104-runner-post-state"),
      committed: true,
    };
  }

  async restoreBackup(
    input: Parameters<Sk104DatabaseRuntime["restoreBackup"]>[0],
  ): Promise<Sk104DatabaseRestoreReceipt> {
    await input.assertAuthorizationFresh();
    this.operations.push("database:restore");
    this.state = "baseline";
    return {
      contract: "sk104-production-database-restore-v1",
      manifestDigest: input.manifest.digest,
      targetDatabaseFingerprint: input.manifest.target.approvedDatabaseFingerprint,
      backupRestorePointFingerprint: DATABASE_RESTORE_POINT,
      restoredAt: input.restoredAt,
      receiptDigest: sha256Digest("sk104-runner-database-restore-receipt"),
    };
  }

  verifyRestoredBaseline(
    input: Parameters<Sk104DatabaseRuntime["verifyRestoredBaseline"]>[0],
  ): Promise<Sk104RestoredBaselineReceipt> {
    this.operations.push("database:verify-restored");
    return Promise.resolve({
      contract: "sk104-restored-baseline-receipt-v1",
      manifestDigest: input.manifest.digest,
      approvalDigest: input.approval.digest,
      sourceSchemaFingerprint: input.manifest.sourceSchemaFingerprint,
      resetRowsFingerprint: input.manifest.resetRowsFingerprint,
      preservedRowCountsFingerprint: input.manifest.preservedRowCountsFingerprint,
      preservedBusinessFingerprint: input.manifest.preservedBusinessFingerprint,
      storageReferencesFingerprint: input.manifest.storageReferencesFingerprint,
      databaseStateFingerprint: sha256Digest("sk104-runner-baseline-state"),
      verified: true,
    });
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

class FakeStorage implements Sk104StorageRuntime {
  readonly operations: string[];

  constructor(operations: string[]) {
    this.operations = operations;
  }

  discoverExactApprovedStorage(): Promise<Sk104PrivateStorageDiscovery> {
    this.operations.push("storage:inspect");
    return Promise.resolve({
      references: [],
      objects: [],
      targetStorageFingerprint: STORAGE_TARGET,
      enumerationFingerprint: sha256Digest("sk104-runner-storage-enumeration"),
    });
  }

  buildPrivateStorageEnvelope(
    input: Parameters<Sk104StorageRuntime["buildPrivateStorageEnvelope"]>[0],
  ): PrivateExecutionEnvelope {
    const providerReferences = Array.from({ length: 7 }, (_, index) => {
      const stripe = index < 3;
      return {
        sourceKind: stripe
          ? ("producer_stripe_account" as const)
          : ("booking_tranzila_confirmation" as const),
        ownerId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        providerValue: `approved-test-provider-${String(index + 1)}`,
        provider: stripe ? ("stripe" as const) : ("tranzila" as const),
        mode: "test" as const,
        attested: true as const,
        chargeEnabled: false as const,
        externalCharge: false as const,
        liveSchedule: false as const,
      };
    });
    return bindPrivateExecutionEnvelope(
      {
        artifactDigest: input.manifest.digest,
        manifestDigest: input.manifest.digest,
        targetPolicyDigest: input.manifest.target.policyDigest,
        rows: [],
        storageReferences: [],
        storageObjects: [],
        providerReferences,
      },
      input.hmacKey,
    );
  }

  planResetObjectRecovery(
    input: Parameters<Sk104StorageRuntime["planResetObjectRecovery"]>[0],
  ): Sk104StorageRestorePointReceipt {
    return {
      contract: "sk104-production-storage-restore-point-v1",
      artifactDigest: input.envelope.artifactDigest,
      targetStorageFingerprint: input.expectedTargetFingerprint,
      objectCount: 9,
      objects: [],
      restorePointFingerprint: STORAGE_RESTORE_POINT,
    };
  }

  async prepareResetObjectRecovery(
    input: Parameters<Sk104StorageRuntime["prepareResetObjectRecovery"]>[0],
  ): Promise<Sk104StorageRestorePointReceipt> {
    await input.assertAuthorizationFresh();
    this.operations.push("storage:prepare-recovery");
    return this.planResetObjectRecovery(input);
  }

  async deletePreparedResetObjects(
    input: Parameters<Sk104StorageRuntime["deletePreparedResetObjects"]>[0],
  ): Promise<Sk104ProductionStorageReceipt> {
    await input.assertAuthorizationFresh();
    await input.assertNoWriterMaintenanceAuthorization({
      contract: "sk104-storage-no-writer-mutation-v1",
      action: "delete_source",
      maintenanceMode: "writers_blocked",
      targetStorageFingerprint: STORAGE_TARGET,
      artifactDigest: input.envelope.artifactDigest,
      restorePointFingerprint: input.expectedRestorePointFingerprint,
      protectedSourceKey: protectValue(HMAC_KEY, "sk104-runner-source-key"),
      protectedRecoveryKey: protectValue(HMAC_KEY, "sk104-runner-recovery-key"),
      expectedSourceVersionFingerprint: sha256Digest("sk104-runner-source-version"),
    });
    this.operations.push("storage:delete");
    return {
      contract: "sk104-production-storage-receipt-v1",
      artifactDigest: input.envelope.artifactDigest,
      targetStorageFingerprint: input.expectedTargetFingerprint,
      objectCount: 9,
      copiedCount: 9,
      copyReconciledCount: 0,
      deletedCount: 9,
      deleteReconciledCount: 0,
      objects: [],
      receiptDigest: sha256Digest("sk104-runner-storage-delete-receipt"),
    };
  }

  verifyResetSourcesAbsent(
    input: Parameters<Sk104StorageRuntime["verifyResetSourcesAbsent"]>[0],
  ): Promise<Sk104StorageVerificationReceipt> {
    this.operations.push("storage:verify-absent");
    return Promise.resolve(this.#verification(input, "absent"));
  }

  async restoreResetObjectsFromRecovery(
    input: Parameters<Sk104StorageRuntime["restoreResetObjectsFromRecovery"]>[0],
  ): Promise<Sk104StorageRestoreReceipt> {
    await input.assertAuthorizationFresh();
    this.operations.push("storage:restore");
    return {
      contract: "sk104-production-storage-restore-receipt-v1",
      artifactDigest: input.envelope.artifactDigest,
      targetStorageFingerprint: input.expectedTargetFingerprint,
      restorePointFingerprint: input.expectedRestorePointFingerprint,
      objectCount: 9,
      restoredCount: 9,
      recoveryRetainedCount: 9,
      objects: [],
      receiptDigest: sha256Digest("sk104-runner-storage-restore-receipt"),
    };
  }

  verifyResetSourcesRestored(
    input: Parameters<Sk104StorageRuntime["verifyResetSourcesRestored"]>[0],
  ): Promise<Sk104StorageVerificationReceipt> {
    this.operations.push("storage:verify-restored");
    return Promise.resolve(this.#verification(input, "restored"));
  }

  #verification(
    input:
      | Parameters<Sk104StorageRuntime["verifyResetSourcesAbsent"]>[0]
      | Parameters<Sk104StorageRuntime["verifyResetSourcesRestored"]>[0],
    expectedSourceState: "absent" | "restored",
  ): Sk104StorageVerificationReceipt {
    return {
      contract: "sk104-production-storage-verification-v1",
      artifactDigest: input.envelope.artifactDigest,
      targetStorageFingerprint: input.expectedTargetFingerprint,
      restorePointFingerprint: input.expectedRestorePointFingerprint,
      expectedSourceState,
      objectCount: 9,
      recoveryVerifiedCount: 9,
      sourceVerifiedCount: 9,
      receiptDigest: sha256Digest(`sk104-runner-storage-${expectedSourceState}`),
    };
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

type Harness = Readonly<{
  environment: Sk104CutoverEnvironment;
  database: FakeDatabase;
  storage: FakeStorage;
  migration: Sk104ProductionMigrationTransactionPort;
  operations: string[];
  clock: { now: Date };
}>;

async function harness(): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), "sk104-runner-"));
  roots.push(root);
  const boundary = {
    targetClass: "canonical_production" as const,
    approvedDatabaseFingerprint: SK104_CANONICAL_DATABASE_FINGERPRINT,
    forbiddenDatabaseFingerprint: SK104_FROZEN_DATABASE_FINGERPRINT,
    approvedStorageFingerprint: STORAGE_TARGET,
    forbiddenStorageFingerprint: FROZEN_STORAGE_TARGET,
  };
  const operations: string[] = [];
  return {
    environment: {
      ...boundary,
      targetDatabaseUrl: "postgresql://private.invalid/production",
      targetSchemaFingerprint: sha256Digest("sk104-runner-target-schema"),
      manifestHmacKey: HMAC_KEY,
      approvalPolicyDigest: sk104ProductionTargetPolicyDigest(boundary),
      storage: {
        endpoint: `https://${"a".repeat(32)}.r2.cloudflarestorage.com`,
        accessKeyId: "test-access-key-id",
        secretAccessKey: "test-secret-access-key-longer-than-thirty-two",
        audioBucket: "skitza-audio-production",
        docsBucket: "skitza-docs-production",
        recoveryPrefix: "sk104-cutover/runner-test/recovery/",
      },
      privateApprovalFile: join(root, "bundle.json"),
      privateApprovalLedgerDirectory: join(root, "approval-ledger"),
      privateStateDirectory: join(root, "state"),
      pgDumpBinary: "/private/test/pg_dump",
      pgRestoreBinary: "/private/test/pg_restore",
      psqlBinary: "/private/test/psql",
      releaseCommit: RELEASE_COMMIT,
      noWriterConfirmed: false,
      approvedExecutionDigest: null,
      userApprovedPlanDigest: null,
    },
    database: new FakeDatabase(operations),
    storage: new FakeStorage(operations),
    migration: {
      filenames: SK104_APPROVED_MIGRATION_FILES,
      bundleDigest: MIGRATION_BUNDLE,
      applyApprovedBundleInTransaction: vi.fn(() => Promise.resolve()),
    },
    operations,
    clock: { now: new Date(BASE_TIME) },
  };
}

function runner(
  active: Harness,
  overrides: EnvironmentOverrides = {},
  now: () => Date = () => new Date(active.clock.now),
): Sk104ProductionCutoverRunner {
  return new Sk104ProductionCutoverRunner({
    environment: { ...active.environment, ...overrides },
    database: active.database,
    storage: active.storage,
    migration: active.migration,
    now,
    randomNonce: () => "r".repeat(64),
  });
}

async function stagePlan(active: Harness): Promise<
  Readonly<{
    executePlanDigest: Sha256Digest;
    restorePlanDigest: Sha256Digest;
  }>
> {
  await runner(active).run("inspect");
  await runner(active).run("prepare-backup");
  const planned = await runner(active).run("plan");
  expect(planned.executionPlanDigest).not.toBeNull();
  expect(planned.restorePlanDigest).not.toBeNull();
  return {
    executePlanDigest: planned.executionPlanDigest as Sha256Digest,
    restorePlanDigest: planned.restorePlanDigest as Sha256Digest,
  };
}

async function authorize(
  active: Harness,
  action: "execute" | "restore",
  planDigest: Sha256Digest,
): Promise<Sha256Digest> {
  const result = await runner(active, { userApprovedPlanDigest: planDigest }).run(
    action === "execute" ? "authorize-execute" : "authorize-restore",
  );
  expect(result.approvalDigest).not.toBeNull();
  return result.approvalDigest as Sha256Digest;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("SK-104 production cutover runner", () => {
  it("runs the approved flow in exact recovery/database/storage order", async () => {
    const active = await harness();
    const plans = await stagePlan(active);
    const approvalDigest = await authorize(active, "execute", plans.executePlanDigest);

    const result = await runner(active, {
      approvedExecutionDigest: approvalDigest,
      noWriterConfirmed: true,
    }).run("execute");

    expect(result.phase).toBe("verified");
    expect(result.databaseCommitted).toBe(true);
    expect(result.storageDeleted).toBe(true);
    expect(active.operations).toEqual([
      "database:inspect",
      "storage:inspect",
      "database:lease-acquired",
      "database:prepare-backup",
      "database:verify-backup",
      "database:lease-released",
      "database:verify-backup",
      "database:verify-backup",
      "database:lease-acquired",
      "storage:prepare-recovery",
      "database:observe-baseline",
      "database:execute",
      "storage:delete",
      "database:observe-post",
      "storage:verify-absent",
      "database:lease-released",
    ]);
  });

  it("reconciles a lost COMMIT response without executing the database twice", async () => {
    const active = await harness();
    const plans = await stagePlan(active);
    const approvalDigest = await authorize(active, "execute", plans.executePlanDigest);
    const executionEnvironment = {
      approvedExecutionDigest: approvalDigest,
      noWriterConfirmed: true,
    } as const;
    active.database.throwAfterCommitOnce = true;

    await expect(runner(active, executionEnvironment).run("execute")).rejects.toThrow(
      "simulated lost database completion",
    );
    const resumed = await runner(active, executionEnvironment).run("resume");

    expect(resumed.phase).toBe("verified");
    expect(active.database.executeCalls).toBe(1);
    expect(active.database.reconcileCalls).toBe(1);
    expect(active.operations).toContain("database:reconcile-committed");
  });

  it("recovers when the backup receipt is published before its durable transition", async () => {
    const active = await harness();
    await runner(active).run("inspect");
    let nowCalls = 0;

    await expect(
      runner(active, {}, () => {
        nowCalls += 1;
        return nowCalls === 1 ? new Date(BASE_TIME) : new Date(Number.NaN);
      }).run("prepare-backup"),
    ).rejects.toThrow(expect.objectContaining({ code: "SK104_CONTRACT_INVALID" }));

    const recovered = await runner(active).run("prepare-backup");
    expect(recovered.phase).toBe("backup_prepared");
    expect(active.database.prepareBackupCalls).toBe(1);
  });

  it("recovers when the plan bundle is published before its durable transition", async () => {
    const active = await harness();
    await runner(active).run("inspect");
    await runner(active).run("prepare-backup");

    await expect(runner(active, {}, () => new Date(Number.NaN)).run("plan")).rejects.toThrow(
      expect.objectContaining({ code: "SK104_CONTRACT_INVALID" }),
    );

    const recovered = await runner(active).run("plan");
    expect(recovered.phase).toBe("planned");
    expect(recovered.executionPlanDigest).toBeTruthy();
  });

  it("rejects approval replay from a different ledger root and rejects expiry", async () => {
    const active = await harness();
    const plans = await stagePlan(active);
    const approvalDigest = await authorize(active, "execute", plans.executePlanDigest);
    const mutationCount = () =>
      active.operations.filter((operation) =>
        ["storage:prepare-recovery", "database:execute", "storage:delete"].includes(operation),
      ).length;
    const otherLedger = join(roots[0] ?? "", "other-ledger");

    await expect(
      runner(active, {
        approvedExecutionDigest: approvalDigest,
        noWriterConfirmed: true,
        privateApprovalLedgerDirectory: otherLedger,
      }).run("execute"),
    ).rejects.toThrow(expect.objectContaining({ code: "SK104_APPROVAL_INVALID" }));
    expect(mutationCount()).toBe(0);

    active.clock.now = new Date(BASE_TIME.getTime() + 6 * 60 * 1000);
    await expect(
      runner(active, {
        approvedExecutionDigest: approvalDigest,
        noWriterConfirmed: true,
      }).run("execute"),
    ).rejects.toThrow(expect.objectContaining({ code: "SK104_APPROVAL_EXPIRED" }));
    expect(mutationCount()).toBe(0);
  });

  it("allows an approved restore after verification and restores storage first", async () => {
    const active = await harness();
    const plans = await stagePlan(active);
    const executionApproval = await authorize(active, "execute", plans.executePlanDigest);
    const executed = await runner(active, {
      approvedExecutionDigest: executionApproval,
      noWriterConfirmed: true,
    }).run("execute");
    expect(executed.phase).toBe("verified");

    const restoreApproval = await authorize(active, "restore", plans.restorePlanDigest);
    const restored = await runner(active, {
      approvedExecutionDigest: restoreApproval,
      noWriterConfirmed: true,
    }).run("restore");

    expect(restored.phase).toBe("restore_verified");
    expect(restored.restored).toBe(true);
    expect(active.operations.indexOf("storage:restore")).toBeLessThan(
      active.operations.indexOf("database:restore"),
    );
    expect(active.operations.indexOf("database:restore")).toBeLessThan(
      active.operations.indexOf("database:verify-restored"),
    );
  });

  it("verifies the exact database backup before restoring storage", async () => {
    const active = await harness();
    const plans = await stagePlan(active);
    const executionApproval = await authorize(active, "execute", plans.executePlanDigest);
    await runner(active, {
      approvedExecutionDigest: executionApproval,
      noWriterConfirmed: true,
    }).run("execute");
    const restoreApproval = await authorize(active, "restore", plans.restorePlanDigest);
    active.database.tamperVerifiedBackup = true;

    await expect(
      runner(active, {
        approvedExecutionDigest: restoreApproval,
        noWriterConfirmed: true,
      }).run("restore"),
    ).rejects.toThrow(expect.objectContaining({ code: "SK104_DIGEST_MISMATCH" }));
    expect(active.operations).not.toContain("storage:restore");
  });
});
