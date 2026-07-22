import { randomBytes } from "node:crypto";
import { lstat } from "node:fs/promises";
import { join } from "node:path";

import {
  assertProtectedToken,
  assertSha256Digest,
  canonicalJson,
  protectValue,
  sameDigest,
  sha256Digest,
  type Sha256Digest,
} from "../sk90-reset/canonical";
import {
  readOwnerOnlyUtf8,
  publishOwnerOnlyUtf8Exclusive,
  writeOwnerOnlyUtf8Atomic,
} from "../sk90-reset/private-envelope";
import { consumeSk104CutoverApproval, readConsumedSk104CutoverApproval } from "./approval-ledger";
import type { Sk104DatabaseBackupReceipt, Sk104DatabaseRestoreReceipt } from "./backup";
import {
  assertSk104ExecutionContextPaths,
  assertSk104ExecutionPlan,
  assertSk104PrivateStagedBundle,
  bindSk104PrivateStagedBundle,
  buildSk104ExecutionContext,
  buildSk104ExecutionPlan,
  type Sk104ExecutionPlan,
  type Sk104PrivateStagedBundle,
} from "./bundle";
import {
  assertSk104CutoverApproval,
  bindSk104CutoverApproval,
  bindSk104ProductionTarget,
  buildSk104ProductionManifest,
  SK104_RESET_ROW_COUNT,
  SK104_RESET_STORAGE_REFERENCE_COUNT,
  sk104ProductionTargetPolicyDigest,
  type Sk104CutoverApproval,
  type Sk104ProductionManifest,
} from "./contract";
import {
  SK104_CHILD_RESTORE_ADVISORY_LOCK_KEY,
  SK104_DATABASE_ADVISORY_LOCK_KEY,
  SK104_RUN_LEASE_ADVISORY_LOCK_KEY,
  type Sk104PrivateProductionDatabaseManifest,
  type Sk104ProductionDatabaseReceipt,
  type Sk104ProductionDatabaseStateObservation,
  type Sk104ProductionMigrationTransactionPort,
  type Sk104RestoredBaselineReceipt,
} from "./database";
import {
  initializeSk104DurableState,
  loadSk104DurableState,
  reauthorizeSk104DurableState,
  transitionSk104DurableState,
  type Sk104DurableState,
} from "./durable-state";
import {
  Sk104CutoverSafetyError,
  stopSk104,
  type Sk104CutoverEnvironment,
  type Sk104CutoverMode,
} from "./environment";
import type {
  NoWriterMaintenanceAuthorizationCheck,
  Sk104NoWriterMaintenanceAuthorizationBinding,
  Sk104PrivateStorageDiscovery,
  Sk104ProductionStorageReceipt,
  Sk104StorageRestorePointReceipt,
  Sk104StorageRestoreReceipt,
  Sk104StorageVerificationReceipt,
} from "./storage";

export type Sk104SafeRunnerResult = Readonly<{
  mode: Sk104CutoverMode;
  phase: string;
  manifestDigest: Sha256Digest;
  stateDigest: Sha256Digest;
  executionPlanDigest: Sha256Digest | null;
  restorePlanDigest: Sha256Digest | null;
  approvalDigest: Sha256Digest | null;
  approvalExpiresAt: string | null;
  planSummary: Readonly<{
    releaseCommit: string;
    targetDatabaseFingerprint: Sha256Digest;
    targetStorageFingerprint: Sha256Digest;
    databaseRestorePointFingerprint: Sha256Digest | null;
    storageRestorePointFingerprint: Sha256Digest;
    migrationBundleDigest: Sha256Digest;
    resetRowCount: typeof SK104_RESET_ROW_COUNT;
    resetStorageObjectCount: typeof SK104_RESET_STORAGE_REFERENCE_COUNT;
  }>;
  databaseCommitted: boolean;
  storageDeleted: boolean;
  restored: boolean;
}>;

export interface Sk104DatabaseRuntime {
  withExclusiveRunLease<Result>(
    input: Readonly<{
      approvedDatabaseFingerprint: Sha256Digest;
      forbiddenDatabaseFingerprint: Sha256Digest;
      parentProofAdvisoryLockKey: string;
    }>,
    operation: (lease: Sk104RunLeaseProof) => Promise<Result>,
  ): Promise<Result>;
  inspectAttestedBaseline(
    input: Readonly<{
      approvedDatabaseFingerprint: Sha256Digest;
      forbiddenDatabaseFingerprint: Sha256Digest;
      hmacKey: string;
      operatorAttestedAllMockTest: true;
    }>,
  ): Promise<Sk104PrivateProductionDatabaseManifest>;
  prepareBackup(
    input: Readonly<{
      manifest: Sk104ProductionManifest;
      privateManifest: Sk104PrivateProductionDatabaseManifest;
      privateBackupDirectory: string;
      preparedAt: string;
    }>,
  ): Promise<Sk104DatabaseBackupReceipt>;
  verifyBackup(
    input: Readonly<{
      manifest: Sk104ProductionManifest;
      privateBackupDirectory: string;
    }>,
  ): Promise<Sk104DatabaseBackupReceipt>;
  observeState(
    input: Readonly<{
      manifest: Sk104ProductionManifest;
      privateManifest: Sk104PrivateProductionDatabaseManifest;
      hmacKey: string;
      expectedMigrationBundleDigest: Sha256Digest;
    }>,
  ): Promise<Sk104ProductionDatabaseStateObservation>;
  execute(
    input: Readonly<{
      manifest: Sk104ProductionManifest;
      approval: Sk104CutoverApproval;
      privateManifest: Sk104PrivateProductionDatabaseManifest;
      hmacKey: string;
      migration: Sk104ProductionMigrationTransactionPort;
    }>,
  ): Promise<Sk104ProductionDatabaseReceipt>;
  reconcileCommitted(
    input: Readonly<{
      manifest: Sk104ProductionManifest;
      approval: Sk104CutoverApproval;
      privateManifest: Sk104PrivateProductionDatabaseManifest;
      hmacKey: string;
    }>,
  ): Promise<Sk104ProductionDatabaseReceipt>;
  restoreBackup(
    input: Readonly<{
      manifest: Sk104ProductionManifest;
      privateBackupDirectory: string;
      restoredAt: string;
      parentProofAdvisoryLockKey: string;
      assertAuthorizationFresh(): void | Promise<void>;
    }>,
  ): Promise<Sk104DatabaseRestoreReceipt>;
  verifyRestoredBaseline(
    input: Readonly<{
      manifest: Sk104ProductionManifest;
      approval: Sk104CutoverApproval;
      privateManifest: Sk104PrivateProductionDatabaseManifest;
      hmacKey: string;
    }>,
  ): Promise<Sk104RestoredBaselineReceipt>;
  close(): Promise<void>;
}

export type Sk104RunLeaseProof = Readonly<{
  parentProofAdvisoryLockKey: string;
}>;

export interface Sk104StorageRuntime {
  discoverExactApprovedStorage(
    input: Readonly<{
      privateDatabaseManifest: Sk104PrivateProductionDatabaseManifest;
      expectedTargetFingerprint: Sha256Digest;
      hmacKey: string;
    }>,
  ): Promise<Sk104PrivateStorageDiscovery>;
  buildPrivateStorageEnvelope(
    input: Parameters<
      import("./storage").Sk104ProductionStorageAdapter["buildPrivateStorageEnvelope"]
    >[0],
  ): ReturnType<import("./storage").Sk104ProductionStorageAdapter["buildPrivateStorageEnvelope"]>;
  planResetObjectRecovery(
    input: Parameters<
      import("./storage").Sk104ProductionStorageAdapter["planResetObjectRecovery"]
    >[0],
  ): Sk104StorageRestorePointReceipt;
  prepareResetObjectRecovery(
    input: Parameters<
      import("./storage").Sk104ProductionStorageAdapter["prepareResetObjectRecovery"]
    >[0],
  ): Promise<Sk104StorageRestorePointReceipt>;
  deletePreparedResetObjects(
    input: Parameters<
      import("./storage").Sk104ProductionStorageAdapter["deletePreparedResetObjects"]
    >[0],
  ): Promise<Sk104ProductionStorageReceipt>;
  verifyResetSourcesAbsent(
    input: Parameters<
      import("./storage").Sk104ProductionStorageAdapter["verifyResetSourcesAbsent"]
    >[0],
  ): Promise<Sk104StorageVerificationReceipt>;
  restoreResetObjectsFromRecovery(
    input: Parameters<
      import("./storage").Sk104ProductionStorageAdapter["restoreResetObjectsFromRecovery"]
    >[0],
  ): Promise<Sk104StorageRestoreReceipt>;
  verifyResetSourcesRestored(
    input: Parameters<
      import("./storage").Sk104ProductionStorageAdapter["verifyResetSourcesRestored"]
    >[0],
  ): Promise<Sk104StorageVerificationReceipt>;
  close(): Promise<void>;
}

export type Sk104RunnerDependencies = Readonly<{
  environment: Sk104CutoverEnvironment;
  database: Sk104DatabaseRuntime;
  storage: Sk104StorageRuntime;
  migration: Sk104ProductionMigrationTransactionPort;
  now(): Date;
  randomNonce(): string;
}>;

const MAX_SIGNED_ADVISORY_LOCK_KEY = 0x7fff_ffff_ffff_ffffn;

function freshRunLeaseProofKey(randomNonce: string): string {
  if (typeof randomNonce !== "string" || randomNonce.length < 32 || randomNonce.includes("\0")) {
    stopSk104("SK104_CONTRACT_INVALID");
  }
  const digest = sha256Digest(`sk104-run-lease-proof\0${randomNonce}`);
  let candidate = BigInt(`0x${digest.slice("sha256:".length, "sha256:".length + 16)}`);
  candidate &= MAX_SIGNED_ADVISORY_LOCK_KEY;
  const reserved = new Set<string>([
    SK104_DATABASE_ADVISORY_LOCK_KEY,
    SK104_RUN_LEASE_ADVISORY_LOCK_KEY,
    SK104_CHILD_RESTORE_ADVISORY_LOCK_KEY,
  ]);
  while (candidate === 0n || reserved.has(candidate.toString())) {
    candidate = (candidate + 1n) & MAX_SIGNED_ADVISORY_LOCK_KEY;
  }
  return candidate.toString();
}

function exactIso(date: Date): string {
  if (!Number.isFinite(date.getTime())) stopSk104("SK104_CONTRACT_INVALID");
  return date.toISOString();
}

function isMissingPath(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function receiptDigest(receipt: unknown): Sha256Digest {
  return sha256Digest(canonicalJson(receipt as never));
}

function safeResult(
  mode: Sk104CutoverMode,
  state: Sk104DurableState,
  bundle: Sk104PrivateStagedBundle,
  releaseCommit: string,
  migrationBundleDigest: Sha256Digest,
): Sk104SafeRunnerResult {
  const activeApproval =
    bundle.activeApprovalDigest === null
      ? null
      : (bundle.approvals.find((approval) =>
          sameDigest(approval.digest, bundle.activeApprovalDigest ?? ""),
        ) ?? null);
  return {
    mode,
    phase: state.phase,
    manifestDigest: state.manifestDigest,
    stateDigest: state.stateDigest,
    executionPlanDigest: state.planDigest,
    restorePlanDigest: state.restorePlanDigest,
    approvalDigest: state.activeApprovalDigest,
    approvalExpiresAt: activeApproval?.expiresAt ?? null,
    planSummary: {
      releaseCommit,
      targetDatabaseFingerprint: bundle.manifest.target.approvedDatabaseFingerprint,
      targetStorageFingerprint: bundle.manifest.target.approvedStorageFingerprint,
      databaseRestorePointFingerprint: bundle.databaseBackup?.restorePointFingerprint ?? null,
      storageRestorePointFingerprint: bundle.storageRestorePoint.restorePointFingerprint,
      migrationBundleDigest,
      resetRowCount: SK104_RESET_ROW_COUNT,
      resetStorageObjectCount: SK104_RESET_STORAGE_REFERENCE_COUNT,
    },
    databaseCommitted: [
      "database_committed",
      "storage_delete_started",
      "storage_deleted",
      "verified",
    ].includes(state.phase),
    storageDeleted: ["storage_deleted", "verified"].includes(state.phase),
    restored: state.phase === "restore_verified",
  };
}

function backupDirectory(environment: Sk104CutoverEnvironment): string {
  return join(environment.privateStateDirectory, "database-backup");
}

function activePlan(
  bundle: Sk104PrivateStagedBundle,
  action: "execute" | "restore",
): Sk104ExecutionPlan {
  const plan = action === "execute" ? bundle.executionPlan : bundle.restorePlan;
  if (plan === null || plan.action !== action) stopSk104("SK104_APPROVAL_INVALID");
  return assertSk104ExecutionPlan(plan, bundle.manifest, bundle.context);
}

function activeApproval(
  bundle: Sk104PrivateStagedBundle,
  action: "execute" | "restore",
  digest: Sha256Digest,
  currentTime: string,
): Sk104CutoverApproval {
  const plan = activePlan(bundle, action);
  const approval = bundle.approvals.find((candidate) => sameDigest(candidate.digest, digest));
  if (
    approval === undefined ||
    approval.action !== action ||
    !sameDigest(approval.executionPlanDigest, plan.digest)
  ) {
    stopSk104("SK104_APPROVAL_INVALID");
  }
  return assertSk104CutoverApproval(approval, bundle.manifest, currentTime);
}

export class Sk104ProductionCutoverRunner {
  readonly #environment: Sk104CutoverEnvironment;
  readonly #database: Sk104DatabaseRuntime;
  readonly #storage: Sk104StorageRuntime;
  readonly #migration: Sk104ProductionMigrationTransactionPort;
  readonly #now: () => Date;
  readonly #randomNonce: () => string;

  constructor(dependencies: Sk104RunnerDependencies) {
    this.#environment = dependencies.environment;
    this.#database = dependencies.database;
    this.#storage = dependencies.storage;
    this.#migration = dependencies.migration;
    this.#now = dependencies.now;
    this.#randomNonce = dependencies.randomNonce;
  }

  #safeResult(
    mode: Sk104CutoverMode,
    state: Sk104DurableState,
    bundle: Sk104PrivateStagedBundle,
  ): Sk104SafeRunnerResult {
    return safeResult(
      mode,
      state,
      bundle,
      this.#environment.releaseCommit,
      this.#migration.bundleDigest,
    );
  }

  async #readBundle(): Promise<Sk104PrivateStagedBundle> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(
        await readOwnerOnlyUtf8(this.#environment.privateApprovalFile),
      ) as unknown;
    } catch {
      stopSk104("SK104_CONTRACT_INVALID");
    }
    return assertSk104PrivateStagedBundle(
      parsed as Sk104PrivateStagedBundle,
      this.#environment.manifestHmacKey,
    );
  }

  async #writeBundle(bundle: Sk104PrivateStagedBundle): Promise<void> {
    await writeOwnerOnlyUtf8Atomic(this.#environment.privateApprovalFile, canonicalJson(bundle));
  }

  async #existingBundle(): Promise<Sk104PrivateStagedBundle | null> {
    try {
      await lstat(this.#environment.privateApprovalFile);
    } catch (error) {
      if (isMissingPath(error)) return null;
      stopSk104("SK104_CONTRACT_INVALID");
    }
    return this.#readBundle();
  }

  #assertContext(bundle: Sk104PrivateStagedBundle): void {
    assertSk104ExecutionContextPaths({
      context: bundle.context,
      stateDirectory: this.#environment.privateStateDirectory,
      approvalLedgerDirectory: this.#environment.privateApprovalLedgerDirectory,
      approvalFile: this.#environment.privateApprovalFile,
      releaseCommit: this.#environment.releaseCommit,
      hmacKey: this.#environment.manifestHmacKey,
    });
  }

  async #state(bundle: Sk104PrivateStagedBundle): Promise<Sk104DurableState> {
    this.#assertContext(bundle);
    const state = await loadSk104DurableState({
      directory: this.#environment.privateStateDirectory,
      context: bundle.context,
      hmacKey: this.#environment.manifestHmacKey,
    });
    if (!sameDigest(state.manifestDigest, bundle.manifest.digest)) {
      stopSk104("SK104_DIGEST_MISMATCH");
    }
    return state;
  }

  async #initializeOrLoadState(bundle: Sk104PrivateStagedBundle): Promise<Sk104DurableState> {
    this.#assertContext(bundle);
    const state = await initializeSk104DurableState({
      directory: this.#environment.privateStateDirectory,
      context: bundle.context,
      manifestDigest: bundle.manifest.digest,
      hmacKey: this.#environment.manifestHmacKey,
      currentTime: exactIso(this.#now()),
    });
    if (!sameDigest(state.manifestDigest, bundle.manifest.digest)) {
      stopSk104("SK104_DIGEST_MISMATCH");
    }
    return state;
  }

  async run(mode: Sk104CutoverMode): Promise<Sk104SafeRunnerResult> {
    try {
      switch (mode) {
        case "inspect":
          return await this.#inspect();
        case "prepare-backup":
          return await this.#withExclusiveRunLease(() => this.#prepareBackup());
        case "plan":
          return await this.#plan();
        case "authorize-execute":
          return await this.#authorize("execute", mode);
        case "authorize-restore":
          return await this.#authorize("restore", mode);
        case "execute":
        case "resume":
          return await this.#execute(mode);
        case "restore":
          return await this.#restore(mode);
      }
    } finally {
      await Promise.allSettled([this.#database.close(), this.#storage.close()]);
    }
  }

  #withExclusiveRunLease<Result>(
    operation: (lease: Sk104RunLeaseProof) => Promise<Result>,
  ): Promise<Result> {
    return this.#database.withExclusiveRunLease(
      {
        approvedDatabaseFingerprint: this.#environment.approvedDatabaseFingerprint,
        forbiddenDatabaseFingerprint: this.#environment.forbiddenDatabaseFingerprint,
        parentProofAdvisoryLockKey: freshRunLeaseProofKey(this.#randomNonce()),
      },
      operation,
    );
  }

  async #inspect(): Promise<Sk104SafeRunnerResult> {
    if (
      this.#environment.approvedExecutionDigest !== null ||
      this.#environment.userApprovedPlanDigest !== null
    ) {
      stopSk104("SK104_APPROVAL_INVALID");
    }
    const existing = await this.#existingBundle();
    if (existing !== null) {
      return this.#safeResult("inspect", await this.#initializeOrLoadState(existing), existing);
    }
    const privateDatabaseManifest = await this.#database.inspectAttestedBaseline({
      approvedDatabaseFingerprint: this.#environment.approvedDatabaseFingerprint,
      forbiddenDatabaseFingerprint: this.#environment.forbiddenDatabaseFingerprint,
      hmacKey: this.#environment.manifestHmacKey,
      operatorAttestedAllMockTest: true,
    });
    const storageDiscovery = await this.#storage.discoverExactApprovedStorage({
      privateDatabaseManifest,
      expectedTargetFingerprint: this.#environment.approvedStorageFingerprint,
      hmacKey: this.#environment.manifestHmacKey,
    });
    const boundary = {
      targetClass: "canonical_production" as const,
      approvedDatabaseFingerprint: this.#environment.approvedDatabaseFingerprint,
      forbiddenDatabaseFingerprint: this.#environment.forbiddenDatabaseFingerprint,
      approvedStorageFingerprint: this.#environment.approvedStorageFingerprint,
      forbiddenStorageFingerprint: this.#environment.forbiddenStorageFingerprint,
    };
    const target = bindSk104ProductionTarget(boundary, this.#environment.approvalPolicyDigest);
    if (!sameDigest(sk104ProductionTargetPolicyDigest(boundary), target.policyDigest)) {
      stopSk104("SK104_TARGET_INVALID");
    }
    const manifest = buildSk104ProductionManifest({
      target,
      sourceSchemaFingerprint: privateDatabaseManifest.sourceSchemaFingerprint,
      targetSchemaFingerprint: this.#environment.targetSchemaFingerprint,
      resetRowsFingerprint: privateDatabaseManifest.resetRowsFingerprint,
      preservedRowCountsFingerprint: privateDatabaseManifest.preservedRowCountsFingerprint,
      preservedBusinessFingerprint: privateDatabaseManifest.preservedBusinessFingerprint,
      storageReferencesFingerprint: privateDatabaseManifest.storageReferencesFingerprint,
      storageEnumerationFingerprint: storageDiscovery.enumerationFingerprint,
      mockEvidenceFingerprint: privateDatabaseManifest.mockEvidenceFingerprint,
    });
    const privateStorageEnvelope = this.#storage.buildPrivateStorageEnvelope({
      manifest,
      privateDatabaseManifest,
      discovery: storageDiscovery,
      hmacKey: this.#environment.manifestHmacKey,
    });
    const storageRestorePoint = this.#storage.planResetObjectRecovery({
      envelope: privateStorageEnvelope,
      expectedTargetFingerprint: manifest.target.approvedStorageFingerprint,
      hmacKey: this.#environment.manifestHmacKey,
    });
    const context = buildSk104ExecutionContext({
      runNonce: this.#randomNonce(),
      stateDirectory: this.#environment.privateStateDirectory,
      approvalLedgerDirectory: this.#environment.privateApprovalLedgerDirectory,
      approvalFile: this.#environment.privateApprovalFile,
      releaseCommit: this.#environment.releaseCommit,
      hmacKey: this.#environment.manifestHmacKey,
    });
    const bundle = bindSk104PrivateStagedBundle(
      {
        context,
        manifest,
        privateDatabaseManifest,
        privateStorageEnvelope,
        databaseBackup: null,
        storageRestorePoint,
        executionPlan: null,
        restorePlan: null,
        approvals: [],
        activeApprovalDigest: null,
      },
      this.#environment.manifestHmacKey,
    );
    try {
      await publishOwnerOnlyUtf8Exclusive(
        this.#environment.privateApprovalFile,
        canonicalJson(bundle),
      );
    } catch {
      // A concurrent exact inspect may have claimed this run file. Continue
      // only with the authenticated bundle that actually won the claim.
      const claimed = await this.#readBundle();
      return this.#safeResult("inspect", await this.#initializeOrLoadState(claimed), claimed);
    }
    const state = await this.#initializeOrLoadState(bundle);
    return this.#safeResult("inspect", state, bundle);
  }

  async #prepareBackup(): Promise<Sk104SafeRunnerResult> {
    const bundle = await this.#readBundle();
    let state = await this.#state(bundle);
    if (state.phase !== "inspected" && state.phase !== "backup_prepared") {
      stopSk104("SK104_APPROVAL_INVALID");
    }
    let updated = bundle;
    if (bundle.databaseBackup === null) {
      if (state.phase !== "inspected") stopSk104("SK104_CONTRACT_INVALID");
      const databaseBackup = await this.#database.prepareBackup({
        manifest: bundle.manifest,
        privateManifest: bundle.privateDatabaseManifest,
        privateBackupDirectory: backupDirectory(this.#environment),
        preparedAt: exactIso(this.#now()),
      });
      updated = bindSk104PrivateStagedBundle(
        { ...bundle, databaseBackup },
        this.#environment.manifestHmacKey,
      );
      await this.#writeBundle(updated);
    }
    const verified = await this.#database.verifyBackup({
      manifest: updated.manifest,
      privateBackupDirectory: backupDirectory(this.#environment),
    });
    if (
      updated.databaseBackup === null ||
      canonicalJson(verified) !== canonicalJson(updated.databaseBackup)
    ) {
      stopSk104("SK104_DIGEST_MISMATCH");
    }
    if (state.phase === "backup_prepared") {
      return this.#safeResult("prepare-backup", state, updated);
    }
    state = await transitionSk104DurableState({
      directory: this.#environment.privateStateDirectory,
      context: updated.context,
      hmacKey: this.#environment.manifestHmacKey,
      expectedStateDigest: state.stateDigest,
      nextPhase: "backup_prepared",
      currentTime: exactIso(this.#now()),
    });
    return this.#safeResult("prepare-backup", state, updated);
  }

  async #plan(): Promise<Sk104SafeRunnerResult> {
    const bundle = await this.#readBundle();
    let state = await this.#state(bundle);
    if (state.phase !== "backup_prepared" && state.phase !== "planned") {
      stopSk104("SK104_APPROVAL_INVALID");
    }
    if (bundle.databaseBackup === null) stopSk104("SK104_CONTRACT_INVALID");
    const verifiedBackup = await this.#database.verifyBackup({
      manifest: bundle.manifest,
      privateBackupDirectory: backupDirectory(this.#environment),
    });
    if (canonicalJson(verifiedBackup) !== canonicalJson(bundle.databaseBackup)) {
      stopSk104("SK104_DIGEST_MISMATCH");
    }
    const shared = {
      manifest: bundle.manifest,
      context: bundle.context,
      databaseRestorePointFingerprint: bundle.databaseBackup.restorePointFingerprint,
      storageRestorePointFingerprint: bundle.storageRestorePoint.restorePointFingerprint,
      migrationBundleDigest: this.#migration.bundleDigest,
    };
    const expectedExecutionPlan = buildSk104ExecutionPlan({ action: "execute", ...shared });
    const expectedRestorePlan = buildSk104ExecutionPlan({ action: "restore", ...shared });
    let updated = bundle;
    if (bundle.executionPlan === null && bundle.restorePlan === null) {
      if (state.phase !== "backup_prepared") stopSk104("SK104_CONTRACT_INVALID");
      updated = bindSk104PrivateStagedBundle(
        {
          ...bundle,
          executionPlan: expectedExecutionPlan,
          restorePlan: expectedRestorePlan,
        },
        this.#environment.manifestHmacKey,
      );
      await this.#writeBundle(updated);
    } else if (
      bundle.executionPlan === null ||
      bundle.restorePlan === null ||
      canonicalJson(bundle.executionPlan) !== canonicalJson(expectedExecutionPlan) ||
      canonicalJson(bundle.restorePlan) !== canonicalJson(expectedRestorePlan)
    ) {
      stopSk104("SK104_DIGEST_MISMATCH");
    }
    if (state.phase === "planned") {
      if (
        !sameDigest(state.planDigest ?? "", expectedExecutionPlan.digest) ||
        !sameDigest(state.restorePlanDigest ?? "", expectedRestorePlan.digest)
      ) {
        stopSk104("SK104_DIGEST_MISMATCH");
      }
      return this.#safeResult("plan", state, updated);
    }
    state = await transitionSk104DurableState({
      directory: this.#environment.privateStateDirectory,
      context: updated.context,
      hmacKey: this.#environment.manifestHmacKey,
      expectedStateDigest: state.stateDigest,
      nextPhase: "planned",
      planDigest: expectedExecutionPlan.digest,
      restorePlanDigest: expectedRestorePlan.digest,
      currentTime: exactIso(this.#now()),
    });
    return this.#safeResult("plan", state, updated);
  }

  async #authorize(
    action: "execute" | "restore",
    mode: "authorize-execute" | "authorize-restore",
  ): Promise<Sk104SafeRunnerResult> {
    const bundle = await this.#readBundle();
    const state = await this.#state(bundle);
    const plan = activePlan(bundle, action);
    const approvedPlanDigest = this.#environment.userApprovedPlanDigest;
    if (
      approvedPlanDigest === null ||
      !sameDigest(approvedPlanDigest, plan.digest) ||
      state.planDigest === null ||
      state.restorePlanDigest === null ||
      ![state.planDigest, state.restorePlanDigest].some((digest) => sameDigest(digest, plan.digest))
    ) {
      stopSk104("SK104_APPROVAL_INVALID");
    }
    const approvedAt = this.#now();
    const expiresAt = new Date(approvedAt.getTime() + 5 * 60 * 1000);
    const approval = bindSk104CutoverApproval({
      manifest: bundle.manifest,
      action,
      manifestDigest: bundle.manifest.digest,
      targetDatabaseFingerprint: bundle.manifest.target.approvedDatabaseFingerprint,
      targetStorageFingerprint: bundle.manifest.target.approvedStorageFingerprint,
      targetPolicyDigest: bundle.manifest.target.policyDigest,
      databaseRestorePointFingerprint: plan.databaseRestorePointFingerprint,
      storageRestorePointFingerprint: plan.storageRestorePointFingerprint,
      migrationBundleDigest: plan.migrationBundleDigest,
      executionPlanDigest: plan.digest,
      approvalChallengeToken: protectValue(
        this.#environment.manifestHmacKey,
        `sk104-user-approved-plan\0${action}\0${plan.digest}\0${this.#randomNonce()}`,
      ),
      approvedAt: exactIso(approvedAt),
      expiresAt: exactIso(expiresAt),
    });
    const updated = bindSk104PrivateStagedBundle(
      {
        ...bundle,
        approvals: [...bundle.approvals, approval],
        activeApprovalDigest: approval.digest,
      },
      this.#environment.manifestHmacKey,
    );
    await this.#writeBundle(updated);
    return {
      ...this.#safeResult(mode, state, updated),
      approvalDigest: approval.digest,
    };
  }

  async #ensureApprovalConsumed(
    bundle: Sk104PrivateStagedBundle,
    approval: Sk104CutoverApproval,
    plan: Sk104ExecutionPlan,
    currentTime: string,
  ): Promise<void> {
    const common = {
      approval,
      manifest: bundle.manifest,
      executionPlan: plan,
      executionContext: bundle.context,
      approvedExecutionDigest: approval.digest,
      expectedAction: approval.action,
      ledgerDirectory: this.#environment.privateApprovalLedgerDirectory,
      stateDirectory: this.#environment.privateStateDirectory,
      approvalFile: this.#environment.privateApprovalFile,
      releaseCommit: this.#environment.releaseCommit,
      hmacKey: this.#environment.manifestHmacKey,
    } as const;
    try {
      await readConsumedSk104CutoverApproval(common);
      return;
    } catch (error) {
      if (!(error instanceof Sk104CutoverSafetyError)) throw error;
    }
    await consumeSk104CutoverApproval({ ...common, currentTime });
  }

  async #activateApproval(
    bundle: Sk104PrivateStagedBundle,
    state: Sk104DurableState,
    action: "execute" | "restore",
  ): Promise<
    Readonly<{
      bundle: Sk104PrivateStagedBundle;
      state: Sk104DurableState;
      plan: Sk104ExecutionPlan;
      approval: Sk104CutoverApproval;
    }>
  > {
    const approvedDigest = this.#environment.approvedExecutionDigest;
    if (approvedDigest === null) stopSk104("SK104_APPROVAL_INVALID");
    const currentTime = exactIso(this.#now());
    const plan = activePlan(bundle, action);
    const approval = activeApproval(bundle, action, approvedDigest, currentTime);
    await this.#ensureApprovalConsumed(bundle, approval, plan, currentTime);
    const updatedBundle = bindSk104PrivateStagedBundle(
      { ...bundle, activeApprovalDigest: approval.digest },
      this.#environment.manifestHmacKey,
    );
    await this.#writeBundle(updatedBundle);
    let updatedState = state;
    if (!sameDigest(updatedState.activeApprovalDigest ?? "", approval.digest)) {
      updatedState = await reauthorizeSk104DurableState({
        directory: this.#environment.privateStateDirectory,
        context: updatedBundle.context,
        hmacKey: this.#environment.manifestHmacKey,
        expectedStateDigest: updatedState.stateDigest,
        approvalDigest: approval.digest,
        planDigest: plan.digest,
        currentTime,
      });
    }
    return { bundle: updatedBundle, state: updatedState, plan, approval };
  }

  #freshApproval(approval: Sk104CutoverApproval, manifest: Sk104ProductionManifest): () => void {
    return () => {
      assertSk104CutoverApproval(approval, manifest, exactIso(this.#now()));
    };
  }

  #noWriterAuthorization(
    approval: Sk104CutoverApproval,
    plan: Sk104ExecutionPlan,
    manifest: Sk104ProductionManifest,
  ): NoWriterMaintenanceAuthorizationCheck {
    return (binding: Sk104NoWriterMaintenanceAuthorizationBinding) => {
      this.#freshApproval(approval, manifest)();
      const untrustedContract: unknown = binding.contract;
      const untrustedMaintenanceMode: unknown = binding.maintenanceMode;
      if (
        !this.#environment.noWriterConfirmed ||
        untrustedContract !== "sk104-storage-no-writer-mutation-v1" ||
        untrustedMaintenanceMode !== "writers_blocked" ||
        !sameDigest(binding.targetStorageFingerprint, plan.targetStorageFingerprint) ||
        !sameDigest(binding.artifactDigest, manifest.digest) ||
        !sameDigest(binding.restorePointFingerprint, plan.storageRestorePointFingerprint)
      ) {
        stopSk104("SK104_APPROVAL_INVALID");
      }
      assertProtectedToken(binding.protectedSourceKey);
      assertProtectedToken(binding.protectedRecoveryKey);
      assertSha256Digest(binding.expectedSourceVersionFingerprint);
    };
  }

  async #execute(mode: "execute" | "resume"): Promise<Sk104SafeRunnerResult> {
    let bundle = await this.#readBundle();
    let state = await this.#state(bundle);
    if (state.phase === "verified") return this.#safeResult(mode, state, bundle);
    if (state.phase.startsWith("restore_")) stopSk104("SK104_APPROVAL_INVALID");
    ({ bundle, state } = await this.#activateApproval(bundle, state, "execute"));
    const plan = activePlan(bundle, "execute");
    const approval = activeApproval(
      bundle,
      "execute",
      state.activeApprovalDigest ?? stopSk104("SK104_APPROVAL_INVALID"),
      exactIso(this.#now()),
    );
    if (bundle.databaseBackup === null) stopSk104("SK104_CONTRACT_INVALID");
    const backup = await this.#database.verifyBackup({
      manifest: bundle.manifest,
      privateBackupDirectory: backupDirectory(this.#environment),
    });
    if (!sameDigest(backup.restorePointFingerprint, plan.databaseRestorePointFingerprint)) {
      stopSk104("SK104_DIGEST_MISMATCH");
    }
    return this.#withExclusiveRunLease(() =>
      this.#executeUnderLease({ mode, bundle, state, plan, approval }),
    );
  }

  async #executeUnderLease(
    input: Readonly<{
      mode: "execute" | "resume";
      bundle: Sk104PrivateStagedBundle;
      state: Sk104DurableState;
      plan: Sk104ExecutionPlan;
      approval: Sk104CutoverApproval;
    }>,
  ): Promise<Sk104SafeRunnerResult> {
    const { mode, bundle, plan, approval } = input;
    let { state } = input;
    const fresh = this.#freshApproval(approval, bundle.manifest);

    for (;;) {
      switch (state.phase) {
        case "planned":
          state = await transitionSk104DurableState({
            directory: this.#environment.privateStateDirectory,
            context: bundle.context,
            hmacKey: this.#environment.manifestHmacKey,
            expectedStateDigest: state.stateDigest,
            nextPhase: "recovery_copies_started",
            currentTime: exactIso(this.#now()),
          });
          break;
        case "recovery_copies_started": {
          const recovery = await this.#storage.prepareResetObjectRecovery({
            envelope: bundle.privateStorageEnvelope,
            expectedTargetFingerprint: plan.targetStorageFingerprint,
            expectedRestorePointFingerprint: plan.storageRestorePointFingerprint,
            hmacKey: this.#environment.manifestHmacKey,
            assertAuthorizationFresh: fresh,
          });
          if (!sameDigest(recovery.restorePointFingerprint, plan.storageRestorePointFingerprint)) {
            stopSk104("SK104_DIGEST_MISMATCH");
          }
          state = await transitionSk104DurableState({
            directory: this.#environment.privateStateDirectory,
            context: bundle.context,
            hmacKey: this.#environment.manifestHmacKey,
            expectedStateDigest: state.stateDigest,
            nextPhase: "recovery_copies_prepared",
            currentTime: exactIso(this.#now()),
          });
          break;
        }
        case "recovery_copies_prepared":
          state = await transitionSk104DurableState({
            directory: this.#environment.privateStateDirectory,
            context: bundle.context,
            hmacKey: this.#environment.manifestHmacKey,
            expectedStateDigest: state.stateDigest,
            nextPhase: "database_started",
            currentTime: exactIso(this.#now()),
          });
          break;
        case "database_started": {
          const observed = await this.#database.observeState({
            manifest: bundle.manifest,
            privateManifest: bundle.privateDatabaseManifest,
            hmacKey: this.#environment.manifestHmacKey,
            expectedMigrationBundleDigest: plan.migrationBundleDigest,
          });
          let receipt: Sk104ProductionDatabaseReceipt;
          if (observed.state === "baseline") {
            receipt = await this.#database.execute({
              manifest: bundle.manifest,
              approval,
              privateManifest: bundle.privateDatabaseManifest,
              hmacKey: this.#environment.manifestHmacKey,
              migration: this.#migration,
            });
          } else if (observed.state === "post") {
            receipt = await this.#database.reconcileCommitted({
              manifest: bundle.manifest,
              approval,
              privateManifest: bundle.privateDatabaseManifest,
              hmacKey: this.#environment.manifestHmacKey,
            });
          } else {
            stopSk104("SK104_DIGEST_MISMATCH");
          }
          state = await transitionSk104DurableState({
            directory: this.#environment.privateStateDirectory,
            context: bundle.context,
            hmacKey: this.#environment.manifestHmacKey,
            expectedStateDigest: state.stateDigest,
            nextPhase: "database_committed",
            databaseReceiptDigest: receiptDigest(receipt),
            currentTime: exactIso(this.#now()),
          });
          break;
        }
        case "database_committed":
          state = await transitionSk104DurableState({
            directory: this.#environment.privateStateDirectory,
            context: bundle.context,
            hmacKey: this.#environment.manifestHmacKey,
            expectedStateDigest: state.stateDigest,
            nextPhase: "storage_delete_started",
            currentTime: exactIso(this.#now()),
          });
          break;
        case "storage_delete_started": {
          const receipt = await this.#storage.deletePreparedResetObjects({
            envelope: bundle.privateStorageEnvelope,
            expectedTargetFingerprint: plan.targetStorageFingerprint,
            hmacKey: this.#environment.manifestHmacKey,
            expectedRestorePointFingerprint: plan.storageRestorePointFingerprint,
            mutationStarted: true,
            assertAuthorizationFresh: fresh,
            assertNoWriterMaintenanceAuthorization: this.#noWriterAuthorization(
              approval,
              plan,
              bundle.manifest,
            ),
          });
          state = await transitionSk104DurableState({
            directory: this.#environment.privateStateDirectory,
            context: bundle.context,
            hmacKey: this.#environment.manifestHmacKey,
            expectedStateDigest: state.stateDigest,
            nextPhase: "storage_deleted",
            storageReceiptDigest: receipt.receiptDigest,
            currentTime: exactIso(this.#now()),
          });
          break;
        }
        case "storage_deleted": {
          const observed = await this.#database.observeState({
            manifest: bundle.manifest,
            privateManifest: bundle.privateDatabaseManifest,
            hmacKey: this.#environment.manifestHmacKey,
            expectedMigrationBundleDigest: plan.migrationBundleDigest,
          });
          if (observed.state !== "post") stopSk104("SK104_DIGEST_MISMATCH");
          await this.#storage.verifyResetSourcesAbsent({
            envelope: bundle.privateStorageEnvelope,
            expectedTargetFingerprint: plan.targetStorageFingerprint,
            hmacKey: this.#environment.manifestHmacKey,
            expectedRestorePointFingerprint: plan.storageRestorePointFingerprint,
          });
          state = await transitionSk104DurableState({
            directory: this.#environment.privateStateDirectory,
            context: bundle.context,
            hmacKey: this.#environment.manifestHmacKey,
            expectedStateDigest: state.stateDigest,
            nextPhase: "verified",
            currentTime: exactIso(this.#now()),
          });
          break;
        }
        case "verified":
          return this.#safeResult(mode, state, bundle);
        default:
          stopSk104("SK104_APPROVAL_INVALID");
      }
    }
  }

  async #restore(mode: "restore"): Promise<Sk104SafeRunnerResult> {
    let bundle = await this.#readBundle();
    let state = await this.#state(bundle);
    if (state.phase === "restore_verified") return this.#safeResult(mode, state, bundle);
    ({ bundle, state } = await this.#activateApproval(bundle, state, "restore"));
    const plan = activePlan(bundle, "restore");
    const approval = activeApproval(
      bundle,
      "restore",
      state.activeApprovalDigest ?? stopSk104("SK104_APPROVAL_INVALID"),
      exactIso(this.#now()),
    );
    if (bundle.databaseBackup === null) stopSk104("SK104_CONTRACT_INVALID");
    const verifiedBackup = await this.#database.verifyBackup({
      manifest: bundle.manifest,
      privateBackupDirectory: backupDirectory(this.#environment),
    });
    if (
      canonicalJson(verifiedBackup) !== canonicalJson(bundle.databaseBackup) ||
      !sameDigest(verifiedBackup.restorePointFingerprint, plan.databaseRestorePointFingerprint)
    ) {
      stopSk104("SK104_DIGEST_MISMATCH");
    }
    return this.#withExclusiveRunLease((lease) =>
      this.#restoreUnderLease({ mode, bundle, state, plan, approval, lease }),
    );
  }

  async #restoreUnderLease(
    input: Readonly<{
      mode: "restore";
      bundle: Sk104PrivateStagedBundle;
      state: Sk104DurableState;
      plan: Sk104ExecutionPlan;
      approval: Sk104CutoverApproval;
      lease: Sk104RunLeaseProof;
    }>,
  ): Promise<Sk104SafeRunnerResult> {
    const { mode, bundle, plan, approval, lease } = input;
    let { state } = input;
    const fresh = this.#freshApproval(approval, bundle.manifest);

    for (;;) {
      switch (state.phase) {
        case "recovery_copies_prepared":
        case "database_started":
        case "database_committed":
        case "storage_delete_started":
        case "storage_deleted":
        case "verified":
          state = await transitionSk104DurableState({
            directory: this.#environment.privateStateDirectory,
            context: bundle.context,
            hmacKey: this.#environment.manifestHmacKey,
            expectedStateDigest: state.stateDigest,
            nextPhase: "restore_storage_started",
            currentTime: exactIso(this.#now()),
          });
          break;
        case "restore_storage_started": {
          const receipt = await this.#storage.restoreResetObjectsFromRecovery({
            envelope: bundle.privateStorageEnvelope,
            expectedTargetFingerprint: plan.targetStorageFingerprint,
            hmacKey: this.#environment.manifestHmacKey,
            expectedRestorePointFingerprint: plan.storageRestorePointFingerprint,
            assertAuthorizationFresh: fresh,
          });
          state = await transitionSk104DurableState({
            directory: this.#environment.privateStateDirectory,
            context: bundle.context,
            hmacKey: this.#environment.manifestHmacKey,
            expectedStateDigest: state.stateDigest,
            nextPhase: "restore_storage_completed",
            restoreReceiptDigest: receipt.receiptDigest,
            currentTime: exactIso(this.#now()),
          });
          break;
        }
        case "restore_storage_completed":
          state = await transitionSk104DurableState({
            directory: this.#environment.privateStateDirectory,
            context: bundle.context,
            hmacKey: this.#environment.manifestHmacKey,
            expectedStateDigest: state.stateDigest,
            nextPhase: "restore_database_started",
            currentTime: exactIso(this.#now()),
          });
          break;
        case "restore_database_started": {
          const observed = await this.#database.observeState({
            manifest: bundle.manifest,
            privateManifest: bundle.privateDatabaseManifest,
            hmacKey: this.#environment.manifestHmacKey,
            expectedMigrationBundleDigest: plan.migrationBundleDigest,
          });
          if (observed.state !== "baseline") {
            await this.#database.restoreBackup({
              manifest: bundle.manifest,
              privateBackupDirectory: backupDirectory(this.#environment),
              restoredAt: exactIso(this.#now()),
              parentProofAdvisoryLockKey: lease.parentProofAdvisoryLockKey,
              assertAuthorizationFresh: fresh,
            });
          }
          state = await transitionSk104DurableState({
            directory: this.#environment.privateStateDirectory,
            context: bundle.context,
            hmacKey: this.#environment.manifestHmacKey,
            expectedStateDigest: state.stateDigest,
            nextPhase: "restore_database_completed",
            currentTime: exactIso(this.#now()),
          });
          break;
        }
        case "restore_database_completed": {
          const databaseReceipt = await this.#database.verifyRestoredBaseline({
            manifest: bundle.manifest,
            approval,
            privateManifest: bundle.privateDatabaseManifest,
            hmacKey: this.#environment.manifestHmacKey,
          });
          const storageReceipt = await this.#storage.verifyResetSourcesRestored({
            envelope: bundle.privateStorageEnvelope,
            expectedTargetFingerprint: plan.targetStorageFingerprint,
            hmacKey: this.#environment.manifestHmacKey,
            expectedRestorePointFingerprint: plan.storageRestorePointFingerprint,
          });
          state = await transitionSk104DurableState({
            directory: this.#environment.privateStateDirectory,
            context: bundle.context,
            hmacKey: this.#environment.manifestHmacKey,
            expectedStateDigest: state.stateDigest,
            nextPhase: "restore_verified",
            restoreReceiptDigest: receiptDigest({ databaseReceipt, storageReceipt }),
            currentTime: exactIso(this.#now()),
          });
          break;
        }
        case "restore_verified":
          return this.#safeResult(mode, state, bundle);
        default:
          stopSk104("SK104_APPROVAL_INVALID");
      }
    }
  }
}

export function defaultSk104RandomNonce(): string {
  return randomBytes(32).toString("hex");
}
