import {
  MAX_DURABLE_NONCE_TTL_MS,
  REQUIRED_ROLLBACK_POINTS,
  addMutationCounters,
  consumeDurableNonce,
  consumedDurableNonceDigest,
  hasZeroMutations,
  issueDurableNonce,
  quarantineAction,
  receiptForAction,
  recoveryDecision,
  type DurableAction,
  type DurableOperationReceipt,
  type DurableRunBindings,
  type DurableRunPhase,
  type DurableRunState,
  type DurableRunStateStore,
  type MutationCounters,
  type RecoveryObservation,
  type RequiredRollbackPoint,
  type RunPurpose,
} from "./durable-state";
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
} from "./canonical";
import { assertApprovedResetArtifact, type ApprovedResetArtifact } from "./artifact";
import {
  consumeExecutableResetApproval,
  recordExecutableResetRunState,
  type ApprovalConsumptionReceipt,
} from "./approval-consumption";
import {
  SK90_RESET_SOURCE_TABLES,
  Sk90DatabaseRehearsalAdapter,
  type DatabaseResetReceipt,
  type DatabaseVerificationReceipt,
  type NeonPoolClientLike,
  type NeonPoolLike,
  type ProviderResetEvidence,
  type ResetRowIdentity,
  type Sk90CutoverApprovalBinding,
} from "./database-adapter";
import type { DatabaseRecoveryPort, DatabaseRestoreReceipt } from "./database-recovery";
import { Sk90ResetSafetyError, stop } from "./errors";
import {
  assertExecutableRollbackProof,
  assertSecondRunIdempotencyProof,
  bindExecutableRollbackProof,
  bindExecutableResetApproval,
  bindSecondRunIdempotencyProof,
  type ExecutableResetApproval,
  type ExecutedIntegritySnapshot,
} from "./execution";
import { assertManifestDigest, type SanitizedResetManifest } from "./manifest";
import {
  assertPrivateEnvelopeMatchesManifest,
  assertPrivateExecutionEnvelope,
  privateExecutionEnvelopeDigest,
  privateStorageNamespaceFingerprint,
  recomputePrivateEnvelopeTokens,
  type PrivateExecutionEnvelope,
} from "./private-envelope";
import {
  assertFreshProofObservation,
  assertFreshTargetAuthorization,
  assertRehearsalTarget,
  authorizeFreshTargetAction,
  targetObservationDigest,
  type FreshTargetAuthorization,
  type RehearsalTargetPolicy,
  type TargetGatedResetAction,
} from "./policy";
import { assertSk90R2RehearsalConfig, createSk90R2Rehearsal } from "./r2-rehearsal";
import type {
  RawStorageEnvelope,
  Sk90R2RehearsalAdapter,
  Sk90R2RehearsalConfig,
  Sk90S3Client,
  StorageMutationCounters,
  StorageNamespaceSnapshot,
} from "./storage-port";

export type RunnerMode = "plan" | "execute" | "resume" | "restore";

export type AuthorizedActionContext = Readonly<{
  action: DurableAction;
  artifactDigest: Sha256Digest;
  manifestDigest: Sha256Digest;
  targetPolicyDigest: Sha256Digest;
  targetDatabaseFingerprint: Sha256Digest;
  targetStorageFingerprint: Sha256Digest;
  executionApprovalDigest: Sha256Digest;
  migrationDigest: Sha256Digest;
  privateEnvelopeDigest: Sha256Digest;
  resetPlanDigest: Sha256Digest;
  evidenceObservationDigest: Sha256Digest;
  databaseRestorePointFingerprint: Sha256Digest;
  storageRestorePointFingerprint: Sha256Digest;
  preStorageNamespaceFingerprint: Sha256Digest;
  postStorageNamespaceFingerprint: Sha256Digest;
  targetObservationDigest: Sha256Digest;
  challengeToken: ProtectedToken;
  issuedAt: string;
  expiresAt: string;
  currentTime: string;
  durableNonceConsumptionDigest: Sha256Digest;
}>;

export type PreparedRunnerMaterial = Readonly<{
  bindings: DurableRunBindings;
  receipt: DurableOperationReceipt & Readonly<{ action: "prepare" }>;
}>;

export type ReconciliationResult = Readonly<{
  observation: RecoveryObservation;
  receipt: DurableOperationReceipt | null;
}>;

export type TargetObservationRequest = Readonly<{
  action: DurableAction;
  challengeToken: ProtectedToken;
  issuedAt: string;
  expiresAt: string;
}>;

export type ChallengeBoundTargetObservation = TargetObservationRequest &
  Readonly<{
    policy: RehearsalTargetPolicy;
    bindingDigest: Sha256Digest;
  }>;

export interface RehearsalRunnerPorts {
  prepare(): Promise<PreparedRunnerMaterial>;
  recordState(state: DurableRunState): Promise<void>;
  observeTarget(input: TargetObservationRequest): Promise<Sha256Digest>;
  freshChallenge(action: DurableAction): Promise<ProtectedToken>;
  assertAuthorizedTarget(context: AuthorizedActionContext): Promise<void>;
  quarantine(
    context: AuthorizedActionContext,
    purpose: RunPurpose,
  ): Promise<DurableOperationReceipt>;
  assertDatabaseRecoveryReady(context: AuthorizedActionContext): Promise<void>;
  reconcileRollbackInterruption(
    context: AuthorizedActionContext,
    point: RequiredRollbackPoint,
  ): Promise<
    Readonly<{
      observation: "baseline" | "post_reset" | "mixed";
      receipt: DurableOperationReceipt | null;
    }>
  >;
  interruptForRollback(
    context: AuthorizedActionContext,
    point: RequiredRollbackPoint,
  ): Promise<DurableOperationReceipt>;
  resetDatabase(context: AuthorizedActionContext): Promise<DurableOperationReceipt>;
  deleteStorage(context: AuthorizedActionContext): Promise<DurableOperationReceipt>;
  verifyPostReset(context: AuthorizedActionContext): Promise<DurableOperationReceipt>;
  restore(
    context: AuthorizedActionContext,
    point: RequiredRollbackPoint,
  ): Promise<DurableOperationReceipt>;
  verifyRestored(
    context: AuthorizedActionContext,
    point: RequiredRollbackPoint,
    restoreReceipt: DurableOperationReceipt,
  ): Promise<DurableOperationReceipt>;
  runSecondTime(
    context: AuthorizedActionContext,
    firstPostResetReceipt: DurableOperationReceipt,
  ): Promise<DurableOperationReceipt>;
  reconcile(
    context: AuthorizedActionContext,
    phase: DurableRunPhase,
    restore?: Readonly<{
      point: RequiredRollbackPoint;
      durableAction: "manual_restore" | `rollback_restore:${RequiredRollbackPoint}`;
    }>,
  ): Promise<ReconciliationResult>;
}

export type Sk90MigrationApprovalBinding = Sk90CutoverApprovalBinding &
  Readonly<{
    targetClass: "isolated_nonproduction";
    filename: "0027_purchase_foundation.sql";
    migrationDigest: string;
  }>;

export interface Sk90MigrationTransactionPort {
  readonly filename: "0027_purchase_foundation.sql";
  readonly content: string;
  readonly digest: Sha256Digest;
  createApproval(binding: Sk90MigrationApprovalBinding): unknown;
  applyMigrationInTransaction(
    client: NeonPoolClientLike,
    filename: "0027_purchase_foundation.sql",
    content: string,
    approval: unknown,
    binding: Sk90CutoverApprovalBinding,
  ): Promise<void>;
}

export interface Sk90IndependentTargetObserver {
  observe(input: TargetObservationRequest): Promise<ChallengeBoundTargetObservation>;
  freshChallenge(action: DurableAction): Promise<ProtectedToken>;
}

export type AdapterBackedRehearsalInput = Readonly<{
  artifact: ApprovedResetArtifact;
  manifest: SanitizedResetManifest;
  privateEnvelope: PrivateExecutionEnvelope;
  executionApproval: ExecutableResetApproval;
  approvedExecutionDigest: Sha256Digest;
  approvalFilePath: string;
  approvalLedgerDirectory: string;
  stateDirectory: string;
  hmacKey: string;
  migration: Sk90MigrationTransactionPort;
  storageConfig: Sk90R2RehearsalConfig;
  createTargetObserver(
    input: Readonly<{
      databasePool: NeonPoolLike;
      storageClient: Sk90S3Client;
      storageConfig: Sk90R2RehearsalConfig;
    }>,
  ): Sk90IndependentTargetObserver;
  createDatabasePools(): Readonly<{
    transactionPool: NeonPoolLike;
    concurrentProbePool: NeonPoolLike;
  }>;
  createStorageClient(): Sk90S3Client;
  createDatabaseRecovery(
    input: Readonly<{
      verifyRestoredBaseline(): Promise<DatabaseVerificationReceipt>;
    }>,
  ): DatabaseRecoveryPort;
  now(): Date;
}>;

type ResolvedAdapterBackedRehearsalInput = AdapterBackedRehearsalInput &
  Readonly<{
    targetObserver: Sk90IndependentTargetObserver;
    approvalConsumption: ApprovalConsumptionReceipt;
  }>;

type SecondRunDatabaseAdapter = Sk90DatabaseRehearsalAdapter &
  Readonly<{
    executeSecondRunNoOp(
      input: Readonly<{
        artifact: ApprovedResetArtifact;
        hmacKey: string;
        expectedRows: readonly ResetRowIdentity[];
        migrationDigest: string;
        freshAuthorization: FreshTargetAuthorization;
        actionChallengeToken: ProtectedToken;
        currentTime: string;
        executionApprovalDigest: Sha256Digest;
        applyCutoverInTransaction(
          client: NeonPoolClientLike,
          binding: Sk90CutoverApprovalBinding,
        ): Promise<void>;
      }>,
    ): Promise<DatabaseResetReceipt>;
  }>;

const RESET_SOURCE_TABLES = new Set<string>(SK90_RESET_SOURCE_TABLES);

function migrationRawDigest(digest: Sha256Digest): string {
  assertSha256Digest(digest);
  return digest.slice("sha256:".length);
}

export function targetActionFor(action: DurableAction): TargetGatedResetAction {
  if (action === "prepare") return "prepare";
  if (action.startsWith("quarantine:") || action === "reconcile_quarantine") {
    return "quarantine_objects";
  }
  if (
    action.startsWith("rollback_restore:") ||
    action === "manual_restore" ||
    action === "reconcile_restore"
  ) {
    return "restore";
  }
  if (action.startsWith("rollback_verify:") || action === "manual_restore_verify") {
    return "verify";
  }
  if (
    action.startsWith("rollback_interrupt:") ||
    action === "rollback_interrupt_database:after_partial_storage_delete"
  ) {
    return "reset_database";
  }
  if (action === "rollback_interrupt_storage:after_partial_storage_delete") {
    return "delete_storage";
  }
  if (action === "database_reset" || action === "reconcile_database_commit") {
    return "reset_database";
  }
  if (action === "storage_delete" || action === "reconcile_storage_delete") {
    return "delete_storage";
  }
  if (action === "second_run" || action === "reconcile_second_run") return "noop";
  return "verify";
}

function counterDelta(before: StorageMutationCounters, after: StorageMutationCounters) {
  const delta = {
    databaseRows: 0,
    storageCopies: after.copiesSucceeded - before.copiesSucceeded,
    storageDeletes: after.deletesSucceeded - before.deletesSucceeded,
  };
  if (Object.values(delta).some((value) => !Number.isSafeInteger(value) || value < 0)) {
    stop("POST_RESET_INTEGRITY_MISMATCH");
  }
  return delta;
}

function adapterReceipt(
  context: AuthorizedActionContext,
  evidence: unknown,
  mutations: MutationCounters,
  postStateFingerprint: Sha256Digest | null = null,
): DurableOperationReceipt {
  const receiptDigest = sha256Digest(
    canonicalJson({
      action: context.action,
      artifactDigest: context.artifactDigest,
      executionApprovalDigest: context.executionApprovalDigest,
      targetObservationDigest: context.targetObservationDigest,
      challengeToken: context.challengeToken,
      issuedAt: context.issuedAt,
      expiresAt: context.expiresAt,
      durableNonceConsumptionDigest: context.durableNonceConsumptionDigest,
      evidence,
      mutations,
      postStateFingerprint,
    }),
  );
  return {
    action: context.action,
    artifactDigest: context.artifactDigest,
    targetObservationDigest: context.targetObservationDigest,
    challengeToken: context.challengeToken,
    issuedAt: context.issuedAt,
    expiresAt: context.expiresAt,
    receiptDigest,
    mutations,
    postStateFingerprint,
  };
}

function databaseRows(envelope: PrivateExecutionEnvelope): ResetRowIdentity[] {
  return envelope.rows.map((row) => {
    if (!RESET_SOURCE_TABLES.has(row.table)) stop("ARTIFACT_BINDING_MISMATCH");
    return { table: row.table as ResetRowIdentity["table"], id: row.id };
  });
}

export function bindProviderResetEvidenceToAction(
  envelope: PrivateExecutionEnvelope,
  artifact: ApprovedResetArtifact,
  actionChallengeToken: ProtectedToken,
): ProviderResetEvidence[] {
  assertProtectedToken(actionChallengeToken);
  return envelope.providerReferences.map((reference) => ({
    ...reference,
    artifactDigest: artifact.digest,
    manifestDigest: artifact.manifestDigest,
    policyDigest: artifact.target.policyDigest,
    challengeToken: actionChallengeToken,
  }));
}

function rawStorageEnvelope(
  envelope: PrivateExecutionEnvelope,
  hmacKey: string,
): RawStorageEnvelope {
  const protectedByIdentity = new Map(
    recomputePrivateEnvelopeTokens(envelope, hmacKey).storageObjects.map((object) => [
      `${object.bucketRole}\0${object.protectedKey}`,
      object,
    ]),
  );
  return {
    entries: envelope.storageObjects.map((object) => {
      const protectedKey = protectValue(
        hmacKey,
        `storage-key\0${object.bucketRole}\0${object.key}`,
      );
      const protectedObject = protectedByIdentity.get(`${object.bucketRole}\0${protectedKey}`);
      if (!protectedObject) stop("ARTIFACT_BINDING_MISMATCH");
      return {
        bucketRole: object.bucketRole,
        logicalKey: object.key,
        protectedKey,
        ownership: object.ownership,
        sizeBytes: object.sizeBytes,
        contentFingerprint: object.contentFingerprint,
        metadataFingerprint: object.metadataFingerprint,
      };
    }),
  };
}

function combinedStateFingerprint(
  databaseStateFingerprint: Sha256Digest,
  storageStateFingerprint: Sha256Digest,
): Sha256Digest {
  return sha256Digest(canonicalJson({ databaseStateFingerprint, storageStateFingerprint }));
}

const RECONCILABLE_STATE_ERRORS = new Set([
  "ARTIFACT_BINDING_MISMATCH",
  "FINAL_DRIFT_DETECTED",
  "POST_RESET_INTEGRITY_MISMATCH",
  "RESTORE_PROOF_MISMATCH",
  "MIGRATION_DIGEST_MISMATCH",
  "STORAGE_ENUMERATION_MISMATCH",
  "DATABASE_VERIFICATION_MISMATCH",
  "STORAGE_OBJECT_MISSING",
  "STORAGE_OBJECT_DRIFT",
]);

function isStateMismatch(error: unknown): boolean {
  return error instanceof Sk90ResetSafetyError && RECONCILABLE_STATE_ERRORS.has(error.code);
}

class AdapterBackedRehearsalPorts implements RehearsalRunnerPorts {
  readonly #input: ResolvedAdapterBackedRehearsalInput;
  readonly #database: SecondRunDatabaseAdapter;
  readonly #storage: Sk90R2RehearsalAdapter;
  readonly #recovery: DatabaseRecoveryPort;
  readonly #storageEnvelope: RawStorageEnvelope;
  readonly #rows: readonly ResetRowIdentity[];
  readonly #freshPolicies = new Map<DurableAction, RehearsalTargetPolicy>();
  readonly #freshAuthorizations = new Map<DurableAction, FreshTargetAuthorization>();

  constructor(
    input: ResolvedAdapterBackedRehearsalInput,
    database: SecondRunDatabaseAdapter,
    storage: Sk90R2RehearsalAdapter,
    recovery: DatabaseRecoveryPort,
    storageEnvelope: RawStorageEnvelope,
  ) {
    this.#input = input;
    this.#database = database;
    this.#storage = storage;
    this.#recovery = recovery;
    this.#storageEnvelope = storageEnvelope;
    this.#rows = databaseRows(input.privateEnvelope);
  }

  prepare(): Promise<PreparedRunnerMaterial> {
    const bindings = this.#bindings();
    return Promise.resolve({
      bindings,
      receipt: {
        action: "prepare",
        artifactDigest: bindings.artifactDigest,
        targetObservationDigest: bindings.approvedTargetObservationDigest,
        challengeToken: null,
        issuedAt: null,
        expiresAt: null,
        receiptDigest: sha256Digest(
          canonicalJson({
            action: "prepare",
            bindings,
          }),
        ),
        mutations: { databaseRows: 0, storageCopies: 0, storageDeletes: 0 },
        postStateFingerprint: null,
      },
    });
  }

  recordState(state: DurableRunState): Promise<void> {
    return recordExecutableResetRunState({
      approval: this.#input.executionApproval,
      consumption: this.#input.approvalConsumption,
      approvalLedgerDirectory: this.#input.approvalLedgerDirectory,
      stateDirectory: this.#input.stateDirectory,
      hmacKey: this.#input.hmacKey,
      state,
    });
  }

  async observeTarget(input: TargetObservationRequest): Promise<Sha256Digest> {
    const observation = await this.#input.targetObserver.observe(input);
    if (
      observation.action !== input.action ||
      !sameDigest(observation.challengeToken, input.challengeToken) ||
      observation.issuedAt !== input.issuedAt ||
      observation.expiresAt !== input.expiresAt ||
      !sameDigest(
        observation.bindingDigest,
        sha256Digest(
          canonicalJson({
            contract: "sk90-challenge-bound-target-observation-v1",
            action: observation.action,
            challengeToken: observation.challengeToken,
            issuedAt: observation.issuedAt,
            expiresAt: observation.expiresAt,
            policy: observation.policy,
          }),
        ),
      )
    ) {
      stop("FRESH_TARGET_AUTHORIZATION_INVALID");
    }
    const policy = observation.policy;
    const observed = assertRehearsalTarget(policy, this.#input.artifact.target.policyDigest);
    if (
      !sameDigest(observed.databaseFingerprint, this.#input.artifact.target.databaseFingerprint) ||
      !sameDigest(observed.storageFingerprint, this.#input.artifact.target.storageFingerprint)
    ) {
      stop("FRESH_TARGET_AUTHORIZATION_INVALID");
    }
    this.#freshPolicies.set(input.action, policy);
    return targetObservationDigest(observed);
  }

  freshChallenge(action: DurableAction): Promise<ProtectedToken> {
    return this.#input.targetObserver.freshChallenge(action);
  }

  assertAuthorizedTarget(context: AuthorizedActionContext): Promise<void> {
    this.#assertContext(context);
    const freshPolicy = this.#freshPolicies.get(context.action);
    if (!freshPolicy) stop("FRESH_TARGET_AUTHORIZATION_INVALID");
    this.#freshPolicies.delete(context.action);
    const authorization = authorizeFreshTargetAction({
      action: targetActionFor(context.action),
      artifactDigest: context.artifactDigest,
      approvedTarget: this.#input.artifact.target,
      freshPolicy,
      challengeToken: context.challengeToken,
      issuedAt: context.issuedAt,
      expiresAt: context.expiresAt,
    });
    assertFreshTargetAuthorization(authorization, {
      action: targetActionFor(context.action),
      artifactDigest: context.artifactDigest,
      challengeToken: context.challengeToken,
      targetObservationDigest: context.targetObservationDigest,
      currentTime: context.currentTime,
    });
    this.#freshAuthorizations.set(context.action, authorization);
    return Promise.resolve();
  }

  async quarantine(
    context: AuthorizedActionContext,
    purpose: RunPurpose,
  ): Promise<DurableOperationReceipt> {
    this.#assertContext(context);
    const backup = await this.#recovery.requireApprovedBackup({
      executionApproval: this.#input.executionApproval,
      approvedExecutionDigest: context.executionApprovalDigest,
      freshAuthorization: this.#authorization(context),
      actionChallengeToken: context.challengeToken,
      currentTime: context.currentTime,
    });
    if (
      !sameDigest(
        backup.receipt.backupFingerprint,
        this.#input.executionApproval.databaseRestorePointFingerprint,
      )
    ) {
      stop("RESTORE_PROOF_MISMATCH");
    }
    this.#assertFreshAtBoundary(context);
    await this.#storage.assertNamespaceState({
      artifactDigest: context.artifactDigest,
      envelope: this.#storageEnvelope,
      dataState: "pre",
      recoveryState: "approved_subset",
    });
    const preStorage = await this.#storage.captureStableSnapshot(this.#storageEnvelope, "pre");
    if (
      !sameDigest(
        preStorage.fingerprint,
        this.#input.executionApproval.preStorageNamespaceFingerprint,
      )
    ) {
      stop("STORAGE_OBJECT_DRIFT");
    }
    this.#assertFreshAtBoundary(context);
    const before = this.#storage.getMutationCounters();
    const result = await this.#storage.quarantineResetObjects({
      artifactDigest: context.artifactDigest,
      envelope: this.#storageEnvelope,
      assertAuthorizationFresh: () => {
        this.#assertFreshAtBoundary(context);
      },
    });
    if (
      !sameDigest(
        result.sourceBeforeFingerprint,
        this.#input.executionApproval.preStorageNamespaceFingerprint,
      ) ||
      !sameDigest(result.sourceAfterFingerprint, result.sourceBeforeFingerprint)
    ) {
      stop("QUARANTINE_PROOF_MISMATCH");
    }
    const copies = [...result.copies].sort((left, right) =>
      compareUtf8Bytes(left.protectedSourceKey, right.protectedSourceKey),
    );
    const restorePointFingerprint = sha256Digest(canonicalJson(copies));
    if (
      !sameDigest(
        restorePointFingerprint,
        this.#input.executionApproval.storageRestorePointFingerprint,
      )
    ) {
      stop("QUARANTINE_PROOF_MISMATCH");
    }
    return adapterReceipt(
      context,
      {
        purpose,
        databaseRestorePointFingerprint: backup.receipt.backupFingerprint,
        storageRestorePointFingerprint: restorePointFingerprint,
        sourceFingerprint: result.sourceAfterFingerprint,
      },
      counterDelta(before, this.#storage.getMutationCounters()),
    );
  }

  async assertDatabaseRecoveryReady(context: AuthorizedActionContext): Promise<void> {
    this.#assertContext(context);
    await this.#recovery.revalidateApprovedBackup({
      executionApproval: this.#input.executionApproval,
      approvedExecutionDigest: context.executionApprovalDigest,
    });
    this.#assertFreshAtBoundary(context);
  }

  async reconcileRollbackInterruption(
    context: AuthorizedActionContext,
    point: RequiredRollbackPoint,
  ): Promise<
    Readonly<{
      observation: "baseline" | "post_reset" | "mixed";
      receipt: DurableOperationReceipt | null;
    }>
  > {
    this.#assertContext(context);
    this.#authorization(context);
    const observation = await this.#observeDatabaseState();
    if (observation !== "post_reset") return { observation, receipt: null };
    if (point === "before_database_commit") {
      return { observation: "mixed", receipt: null };
    }
    return {
      observation,
      receipt: adapterReceipt(
        context,
        {
          reconciled: true,
          point,
          expectedAction:
            point === "after_partial_storage_delete"
              ? "rollback_interrupt_database:after_partial_storage_delete"
              : `rollback_interrupt:${point}`,
        },
        {
          databaseRows: this.#input.artifact.postResetExpectations.resetRowCount,
          storageCopies: 0,
          storageDeletes: 0,
        },
      ),
    };
  }

  #assertFreshAtBoundary(context: AuthorizedActionContext): void {
    const boundaryTime = this.#input.now();
    if (!Number.isFinite(boundaryTime.getTime())) stop("FRESHNESS_PROOF_INVALID");
    assertFreshProofObservation(
      {
        challengeToken: context.challengeToken,
        targetObservationDigest: context.targetObservationDigest,
        issuedAt: context.issuedAt,
        expiresAt: context.expiresAt,
      },
      {
        challengeToken: context.challengeToken,
        targetObservationDigest: context.targetObservationDigest,
        issuedAt: context.issuedAt,
        expiresAt: context.expiresAt,
        currentTime: boundaryTime.toISOString(),
      },
    );
  }

  #authorization(context: AuthorizedActionContext): FreshTargetAuthorization {
    const authorization = this.#freshAuthorizations.get(context.action);
    if (!authorization) stop("FRESH_TARGET_AUTHORIZATION_INVALID");
    this.#freshAuthorizations.delete(context.action);
    return authorization;
  }

  async #applyCutover(
    client: NeonPoolClientLike,
    binding: Sk90CutoverApprovalBinding,
  ): Promise<void> {
    const approval = this.#input.migration.createApproval({
      targetClass: "isolated_nonproduction",
      filename: "0027_purchase_foundation.sql",
      ...binding,
      migrationDigest: migrationRawDigest(this.#input.migration.digest),
    });
    await this.#input.migration.applyMigrationInTransaction(
      client,
      "0027_purchase_foundation.sql",
      this.#input.migration.content,
      approval,
      binding,
    );
  }

  async #executeDatabaseReset(context: AuthorizedActionContext): Promise<DatabaseResetReceipt> {
    const freshAuthorization = this.#authorization(context);
    const receipt = await this.#database.execute({
      artifact: this.#input.artifact,
      hmacKey: this.#input.hmacKey,
      expectedRows: this.#rows,
      providerEvidence: bindProviderResetEvidenceToAction(
        this.#input.privateEnvelope,
        this.#input.artifact,
        context.challengeToken,
      ),
      freshAuthorization,
      actionChallengeToken: context.challengeToken,
      currentTime: context.currentTime,
      executionApprovalDigest: context.executionApprovalDigest,
      approvedStorageReferences: this.#input.manifest.storageReferences,
      applyCutoverInTransaction: (client, binding) => this.#applyCutover(client, binding),
    });
    if (receipt.deletedRowCount !== this.#input.artifact.postResetExpectations.resetRowCount) {
      stop("POST_RESET_INTEGRITY_MISMATCH");
    }
    return receipt;
  }

  async interruptForRollback(
    context: AuthorizedActionContext,
    point: RequiredRollbackPoint,
  ): Promise<DurableOperationReceipt> {
    this.#assertContext(context);
    if (point === "before_database_commit") {
      if (context.action !== `rollback_interrupt:${point}`) stop("PHASE_STATE_INVALID");
      return adapterReceipt(
        context,
        { point },
        { databaseRows: 0, storageCopies: 0, storageDeletes: 0 },
      );
    }
    if (point === "after_database_commit_before_storage_delete") {
      if (context.action !== `rollback_interrupt:${point}`) stop("PHASE_STATE_INVALID");
      const database = await this.#executeDatabaseReset(context);
      return adapterReceipt(
        context,
        { point, databaseStateFingerprint: database.databaseStateFingerprint },
        { databaseRows: database.deletedRowCount, storageCopies: 0, storageDeletes: 0 },
      );
    }

    if (context.action === "rollback_interrupt_database:after_partial_storage_delete") {
      const database = await this.#executeDatabaseReset(context);
      return adapterReceipt(
        context,
        { point, databaseStateFingerprint: database.databaseStateFingerprint },
        { databaseRows: database.deletedRowCount, storageCopies: 0, storageDeletes: 0 },
      );
    }
    if (context.action !== "rollback_interrupt_storage:after_partial_storage_delete") {
      stop("PHASE_STATE_INVALID");
    }
    // The storage mutation has its own observed authorization. Never reuse the
    // database-stage authorization across this destructive boundary.
    this.#authorization(context);
    const before = this.#storage.getMutationCounters();
    const expectedInterruption = new Sk90ResetSafetyError("PHASE_STATE_INVALID");
    try {
      await this.#storage.deleteResetObjects({
        artifactDigest: context.artifactDigest,
        envelope: this.#storageEnvelope,
        completedProtectedKeys: [],
        mutationStarted: true,
        assertAuthorizationFresh: () => {
          this.#assertFreshAtBoundary(context);
        },
        onProgress: (progress) => {
          if (progress.reconciled) stop("PHASE_STATE_INVALID");
          throw expectedInterruption;
        },
      });
      stop("PHASE_STATE_INVALID");
    } catch (error) {
      if (error !== expectedInterruption) throw error;
    }
    const mutations = counterDelta(before, this.#storage.getMutationCounters());
    if (mutations.storageDeletes !== 1) stop("PHASE_STATE_INVALID");
    return adapterReceipt(context, { point }, mutations);
  }

  async resetDatabase(context: AuthorizedActionContext): Promise<DurableOperationReceipt> {
    this.#assertContext(context);
    const result = await this.#executeDatabaseReset(context);
    return adapterReceipt(
      context,
      {
        databaseStateFingerprint: result.databaseStateFingerprint,
        schemaFingerprint: result.schemaFingerprint,
      },
      { databaseRows: result.deletedRowCount, storageCopies: 0, storageDeletes: 0 },
    );
  }

  async deleteStorage(context: AuthorizedActionContext): Promise<DurableOperationReceipt> {
    this.#assertContext(context);
    const before = this.#storage.getMutationCounters();
    const result = await this.#storage.deleteResetObjects({
      artifactDigest: context.artifactDigest,
      envelope: this.#storageEnvelope,
      completedProtectedKeys: [],
      mutationStarted: true,
      assertAuthorizationFresh: () => {
        this.#assertFreshAtBoundary(context);
      },
    });
    if (
      !sameDigest(
        result.postSnapshot.fingerprint,
        this.#input.executionApproval.postStorageNamespaceFingerprint,
      )
    ) {
      stop("POST_RESET_INTEGRITY_MISMATCH");
    }
    return adapterReceipt(
      context,
      {
        deletedObjectsFingerprint: result.deletedObjectsFingerprint,
        postStorageFingerprint: result.postSnapshot.fingerprint,
      },
      counterDelta(before, this.#storage.getMutationCounters()),
    );
  }

  async verifyPostReset(context: AuthorizedActionContext): Promise<DurableOperationReceipt> {
    this.#assertContext(context);
    const [database, storage] = await Promise.all([
      this.#database.verifySecondRunNoOp({
        artifact: this.#input.artifact,
        hmacKey: this.#input.hmacKey,
        migrationDigest: migrationRawDigest(this.#input.migration.digest),
      }),
      this.#storage.captureStableSnapshot(this.#storageEnvelope, "post"),
    ]);
    if (
      !sameDigest(
        storage.fingerprint,
        this.#input.executionApproval.postStorageNamespaceFingerprint,
      )
    ) {
      stop("POST_RESET_INTEGRITY_MISMATCH");
    }
    const fingerprint = combinedStateFingerprint(
      database.databaseStateFingerprint,
      storage.fingerprint,
    );
    return adapterReceipt(
      context,
      {
        databaseStateFingerprint: database.databaseStateFingerprint,
        storageStateFingerprint: storage.fingerprint,
      },
      { databaseRows: 0, storageCopies: 0, storageDeletes: 0 },
      fingerprint,
    );
  }

  async restore(
    context: AuthorizedActionContext,
    point: RequiredRollbackPoint,
  ): Promise<DurableOperationReceipt> {
    this.#assertContext(context);
    const observedDatabase = await this.#observeDatabaseState();
    const expectedDatabase = point === "before_database_commit" ? "baseline" : "post_reset";
    if (observedDatabase === "mixed") stop("DATABASE_VERIFICATION_MISMATCH");
    const before = this.#storage.getMutationCounters();
    const baselineObservationDigest = sha256Digest(
      canonicalJson(this.#input.artifact.reviewedBaseline),
    );
    const durableAction =
      context.action === "manual_restore"
        ? "manual_restore"
        : (`rollback_restore:${point}` as const);
    if (context.action !== durableAction) stop("PHASE_STATE_INVALID");
    let database: DatabaseRestoreReceipt;
    if (observedDatabase === "baseline") {
      try {
        database = await this.#recovery.requireExecutedRestore({
          approvalDigest: this.#input.executionApproval.digest,
          expectedRestorePointFingerprint:
            this.#input.executionApproval.databaseRestorePointFingerprint,
          expectedBaselineObservationDigest: baselineObservationDigest,
          rollbackPoint: point,
          durableAction,
        });
        // The database restore completed before the local phase was published.
        // Consume this fresh authorization before replaying storage below.
        this.#authorization(context);
      } catch (error) {
        if (!(error instanceof Sk90ResetSafetyError) || error.code !== "RESTORE_REQUIRED") {
          throw error;
        }
        database = await this.#recovery.restore({
          approvalDigest: this.#input.executionApproval.digest,
          freshAuthorization: this.#authorization(context),
          actionChallengeToken: context.challengeToken,
          currentTime: context.currentTime,
          expectedRestorePointFingerprint:
            this.#input.executionApproval.databaseRestorePointFingerprint,
          expectedBaselineObservationDigest: baselineObservationDigest,
          exercise: {
            rollbackPoint: point,
            durableAction,
            durableNonceConsumptionDigest: context.durableNonceConsumptionDigest,
          },
          forceReplay: true,
        });
      }
    } else {
      if (observedDatabase !== expectedDatabase) stop("DATABASE_VERIFICATION_MISMATCH");
      database = await this.#recovery.restore({
        approvalDigest: this.#input.executionApproval.digest,
        freshAuthorization: this.#authorization(context),
        actionChallengeToken: context.challengeToken,
        currentTime: context.currentTime,
        expectedRestorePointFingerprint:
          this.#input.executionApproval.databaseRestorePointFingerprint,
        expectedBaselineObservationDigest: baselineObservationDigest,
        exercise: {
          rollbackPoint: point,
          durableAction,
          durableNonceConsumptionDigest: context.durableNonceConsumptionDigest,
        },
        forceReplay: true,
      });
    }
    await this.assertDatabaseRecoveryReady(context);
    const storage = await this.#storage.restoreResetObjects({
      artifactDigest: context.artifactDigest,
      envelope: this.#storageEnvelope,
      forceReplay: true,
      assertAuthorizationFresh: () => {
        this.#assertFreshAtBoundary(context);
      },
    });
    if (
      !sameDigest(
        storage.snapshot.fingerprint,
        this.#input.executionApproval.preStorageNamespaceFingerprint,
      )
    ) {
      stop("RESTORE_PROOF_MISMATCH");
    }
    const storageMutations = counterDelta(before, this.#storage.getMutationCounters());
    const expectedStorageCopies =
      this.#input.artifact.postResetExpectations.resetStorageObjectCount;
    if (
      database.restoreDisposition !== "executed" ||
      storage.restoredCount !== expectedStorageCopies ||
      storage.alreadyPresentCount !== 0 ||
      storageMutations.storageCopies !== expectedStorageCopies
    ) {
      stop("RESTORE_PROOF_MISMATCH");
    }
    return adapterReceipt(
      context,
      {
        point,
        databaseStateFingerprint: database.databaseStateFingerprint,
        storageStateFingerprint: storage.snapshot.fingerprint,
      },
      { ...storageMutations, databaseRows: database.databaseMutationCount },
    );
  }

  #integritySnapshot(
    database: DatabaseVerificationReceipt,
    storage: StorageNamespaceSnapshot,
    restored: boolean,
  ): ExecutedIntegritySnapshot {
    const zero = sha256Digest(canonicalJson({ violationCount: 0 }));
    return {
      databaseStateFingerprint: database.databaseStateFingerprint,
      schemaFingerprint: database.schemaFingerprint,
      resetRowsFingerprint: restored
        ? this.#input.artifact.reviewedBaseline.resetRowsFingerprint
        : sha256Digest(canonicalJson([])),
      preservedRowCountsFingerprint:
        this.#input.artifact.postResetExpectations.preservedRowCountsFingerprint,
      preservedBusinessFingerprint:
        this.#input.artifact.postResetExpectations.preservedBusinessFingerprint,
      foreignKeyFingerprint: zero,
      orphanFingerprint: zero,
      ownershipFingerprint: zero,
      storageNamespaceFingerprint: storage.fingerprint,
    };
  }

  #approvedBaselineIntegritySnapshot(): ExecutedIntegritySnapshot {
    const baseline = this.#input.artifact.reviewedBaseline;
    const zero = sha256Digest(canonicalJson({ violationCount: 0 }));
    return {
      databaseStateFingerprint: sha256Digest(canonicalJson(baseline)),
      schemaFingerprint: baseline.schemaFingerprint,
      resetRowsFingerprint: baseline.resetRowsFingerprint,
      preservedRowCountsFingerprint: baseline.preservedRowCountsFingerprint,
      preservedBusinessFingerprint: baseline.preservedBusinessFingerprint,
      foreignKeyFingerprint: zero,
      orphanFingerprint: zero,
      ownershipFingerprint: zero,
      storageNamespaceFingerprint: this.#input.executionApproval.preStorageNamespaceFingerprint,
    };
  }

  #proofExpectation(context: AuthorizedActionContext) {
    return {
      artifactDigest: context.artifactDigest,
      challengeToken: context.challengeToken,
      targetObservationDigest: context.targetObservationDigest,
      issuedAt: context.issuedAt,
      expiresAt: context.expiresAt,
      currentTime: context.currentTime,
      durableNonceConsumptionDigest: context.durableNonceConsumptionDigest,
    };
  }

  async verifyRestored(
    context: AuthorizedActionContext,
    point: RequiredRollbackPoint,
    restoreReceipt: DurableOperationReceipt,
  ): Promise<DurableOperationReceipt> {
    this.#assertContext(context);
    const durableAction =
      context.action === "manual_restore_verify"
        ? "manual_restore"
        : (`rollback_restore:${point}` as const);
    if (
      (restoreReceipt.action !== durableAction && restoreReceipt.action !== "reconcile_restore") ||
      !sameDigest(restoreReceipt.artifactDigest, context.artifactDigest) ||
      restoreReceipt.mutations.storageCopies !==
        this.#input.artifact.postResetExpectations.resetStorageObjectCount ||
      restoreReceipt.mutations.storageDeletes !== 0
    ) {
      stop("RESTORE_PROOF_MISMATCH");
    }
    const baselineObservationDigest = sha256Digest(
      canonicalJson(this.#input.artifact.reviewedBaseline),
    );
    const [database, storage, databaseRestore] = await Promise.all([
      this.#database.verifyRestoredBaseline({
        artifact: this.#input.artifact,
        hmacKey: this.#input.hmacKey,
        approvedStorageReferences: this.#input.manifest.storageReferences,
      }),
      this.#storage.captureStableSnapshot(this.#storageEnvelope, "pre"),
      this.#recovery.requireExecutedRestore({
        approvalDigest: this.#input.executionApproval.digest,
        expectedRestorePointFingerprint:
          this.#input.executionApproval.databaseRestorePointFingerprint,
        expectedBaselineObservationDigest: baselineObservationDigest,
        rollbackPoint: point,
        durableAction,
      }),
    ]);
    if (
      !sameDigest(storage.fingerprint, this.#input.executionApproval.preStorageNamespaceFingerprint)
    ) {
      stop("RESTORE_PROOF_MISMATCH");
    }
    const restored = this.#integritySnapshot(database, storage, true);
    const before = this.#approvedBaselineIntegritySnapshot();
    const proof = bindExecutableRollbackProof({
      contract: "sk90-executable-rollback-proof-v1",
      approvalDigest: this.#input.executionApproval.digest,
      artifactDigest: context.artifactDigest,
      action: "restore",
      challengeToken: context.challengeToken,
      targetObservationDigest: context.targetObservationDigest,
      issuedAt: context.issuedAt,
      expiresAt: context.expiresAt,
      durableNonceConsumptionDigest: context.durableNonceConsumptionDigest,
      interruptionPoint: point,
      before,
      restored,
      databaseRestoreExecuted: databaseRestore.restoreDisposition === "executed",
      storageRestoreExecuted:
        restoreReceipt.mutations.storageCopies ===
        this.#input.artifact.postResetExpectations.resetStorageObjectCount,
    });
    assertExecutableRollbackProof(
      this.#input.executionApproval,
      proof,
      this.#proofExpectation(context),
    );
    return adapterReceipt(
      context,
      { point, proofDigest: proof.digest },
      { databaseRows: 0, storageCopies: 0, storageDeletes: 0 },
      combinedStateFingerprint(database.databaseStateFingerprint, storage.fingerprint),
    );
  }

  async runSecondTime(
    context: AuthorizedActionContext,
    firstPostResetReceipt: DurableOperationReceipt,
  ): Promise<DurableOperationReceipt> {
    this.#assertContext(context);
    if (
      firstPostResetReceipt.challengeToken === null ||
      firstPostResetReceipt.postStateFingerprint === null
    ) {
      stop("IDEMPOTENCY_PROOF_MISMATCH");
    }
    const beforeStorage = await this.#storage.captureStableSnapshot(this.#storageEnvelope, "post");
    const beforeCounters = this.#storage.getMutationCounters();
    const resetTokens = this.#storageEnvelope.entries
      .filter((entry) => entry.ownership === "reset_exclusive")
      .map((entry) => entry.protectedKey);
    const database = await this.#database.executeSecondRunNoOp({
      artifact: this.#input.artifact,
      hmacKey: this.#input.hmacKey,
      expectedRows: this.#rows,
      migrationDigest: migrationRawDigest(this.#input.migration.digest),
      freshAuthorization: this.#authorization(context),
      actionChallengeToken: context.challengeToken,
      currentTime: context.currentTime,
      executionApprovalDigest: context.executionApprovalDigest,
      applyCutoverInTransaction: (client, binding) => this.#applyCutover(client, binding),
    });
    if (database.deletedRowCount !== 0) stop("IDEMPOTENCY_PROOF_MISMATCH");
    await this.assertDatabaseRecoveryReady(context);
    await this.#storage.deleteResetObjects({
      artifactDigest: context.artifactDigest,
      envelope: this.#storageEnvelope,
      completedProtectedKeys: resetTokens,
      mutationStarted: true,
      assertAuthorizationFresh: () => {
        this.#assertFreshAtBoundary(context);
      },
    });
    const secondStorage = await this.#storage.captureSecondRunStorageSnapshot({
      envelope: this.#storageEnvelope,
      expected: "post",
      beforeSnapshot: beforeStorage,
      beforeCounters,
    });
    const afterStorage = await this.#storage.captureStableSnapshot(this.#storageEnvelope, "post");
    const fingerprint = combinedStateFingerprint(
      database.databaseStateFingerprint,
      afterStorage.fingerprint,
    );
    if (!sameDigest(fingerprint, firstPostResetReceipt.postStateFingerprint)) {
      stop("IDEMPOTENCY_PROOF_MISMATCH");
    }
    const verifiedDatabase: DatabaseVerificationReceipt = {
      artifactDigest: database.artifactDigest,
      manifestDigest: database.manifestDigest,
      purpose: "second_run_noop",
      schemaFingerprint: database.schemaFingerprint,
      databaseStateFingerprint: database.databaseStateFingerprint,
      databaseMutationCount: 0,
      committed: true,
    };
    const before = this.#integritySnapshot(verifiedDatabase, beforeStorage, false);
    const after = this.#integritySnapshot(verifiedDatabase, afterStorage, false);
    const proof = bindSecondRunIdempotencyProof({
      contract: "sk90-second-run-idempotency-proof-v1",
      approvalDigest: this.#input.executionApproval.digest,
      artifactDigest: context.artifactDigest,
      action: "noop",
      firstObservationChallengeToken: firstPostResetReceipt.challengeToken,
      secondObservationChallengeToken: context.challengeToken,
      targetObservationDigest: context.targetObservationDigest,
      issuedAt: context.issuedAt,
      expiresAt: context.expiresAt,
      durableNonceConsumptionDigest: context.durableNonceConsumptionDigest,
      before,
      after,
      databaseMutationCount: 0,
      storageCopyCount: secondStorage.copiesSucceeded,
      storageDeleteCount: secondStorage.deletesSucceeded,
      storageRestoreCount: 0,
    });
    assertSecondRunIdempotencyProof(
      this.#input.executionApproval,
      proof,
      this.#proofExpectation(context),
    );
    return adapterReceipt(
      context,
      { proofDigest: proof.digest },
      { databaseRows: 0, storageCopies: 0, storageDeletes: 0 },
      fingerprint,
    );
  }

  async #observeDatabaseState(): Promise<"baseline" | "post_reset" | "mixed"> {
    try {
      await this.#database.verifyRestoredBaseline({
        artifact: this.#input.artifact,
        hmacKey: this.#input.hmacKey,
        approvedStorageReferences: this.#input.manifest.storageReferences,
      });
      return "baseline";
    } catch (error) {
      if (!isStateMismatch(error)) throw error;
    }
    try {
      await this.#database.verifySecondRunNoOp({
        artifact: this.#input.artifact,
        hmacKey: this.#input.hmacKey,
        migrationDigest: migrationRawDigest(this.#input.migration.digest),
      });
      return "post_reset";
    } catch (error) {
      if (!isStateMismatch(error)) throw error;
      return "mixed";
    }
  }

  async #postResetReconciliationReceipt(
    context: AuthorizedActionContext,
  ): Promise<DurableOperationReceipt> {
    const [database, storage] = await Promise.all([
      this.#database.verifySecondRunNoOp({
        artifact: this.#input.artifact,
        hmacKey: this.#input.hmacKey,
        migrationDigest: migrationRawDigest(this.#input.migration.digest),
      }),
      this.#storage.captureStableSnapshot(this.#storageEnvelope, "post"),
    ]);
    if (
      !sameDigest(
        storage.fingerprint,
        this.#input.executionApproval.postStorageNamespaceFingerprint,
      )
    ) {
      stop("POST_RESET_INTEGRITY_MISMATCH");
    }
    const fingerprint = combinedStateFingerprint(
      database.databaseStateFingerprint,
      storage.fingerprint,
    );
    return adapterReceipt(
      context,
      {
        databaseStateFingerprint: database.databaseStateFingerprint,
        storageStateFingerprint: storage.fingerprint,
      },
      { databaseRows: 0, storageCopies: 0, storageDeletes: 0 },
      fingerprint,
    );
  }

  async reconcile(
    context: AuthorizedActionContext,
    phase: DurableRunPhase,
    restore?: Readonly<{
      point: RequiredRollbackPoint;
      durableAction: "manual_restore" | `rollback_restore:${RequiredRollbackPoint}`;
    }>,
  ): Promise<ReconciliationResult> {
    this.#assertContext(context);
    if (phase === "quarantine_started") {
      const backup = await this.#recovery.requireApprovedBackup({
        executionApproval: this.#input.executionApproval,
        approvedExecutionDigest: context.executionApprovalDigest,
        freshAuthorization: this.#authorization(context),
        actionChallengeToken: context.challengeToken,
        currentTime: context.currentTime,
      });
      if (
        !sameDigest(
          backup.receipt.backupFingerprint,
          this.#input.executionApproval.databaseRestorePointFingerprint,
        )
      ) {
        stop("RESTORE_PROOF_MISMATCH");
      }
      this.#assertFreshAtBoundary(context);
      const result = await this.#storage.quarantineResetObjects({
        artifactDigest: context.artifactDigest,
        envelope: this.#storageEnvelope,
        assertAuthorizationFresh: () => {
          this.#assertFreshAtBoundary(context);
        },
      });
      if (
        !sameDigest(
          result.sourceAfterFingerprint,
          this.#input.executionApproval.preStorageNamespaceFingerprint,
        ) ||
        !sameDigest(
          sha256Digest(
            canonicalJson(
              [...result.copies].sort((left, right) =>
                compareUtf8Bytes(left.protectedSourceKey, right.protectedSourceKey),
              ),
            ),
          ),
          this.#input.executionApproval.storageRestorePointFingerprint,
        )
      ) {
        stop("STORAGE_OBJECT_DRIFT");
      }
      return {
        observation: "quarantined",
        receipt: adapterReceipt(
          context,
          { reconciled: true },
          {
            databaseRows: 0,
            storageCopies: this.#input.artifact.postResetExpectations.resetStorageObjectCount,
            storageDeletes: 0,
          },
        ),
      };
    }

    if (phase === "database_reset_started") {
      const database = await this.#observeDatabaseState();
      if (database === "baseline") return { observation: "pre", receipt: null };
      if (database === "mixed") return { observation: "mixed", receipt: null };
      return {
        observation: "database_committed",
        receipt: adapterReceipt(
          context,
          { reconciled: true },
          {
            databaseRows: this.#input.artifact.postResetExpectations.resetRowCount,
            storageCopies: 0,
            storageDeletes: 0,
          },
        ),
      };
    }

    if (phase === "storage_delete_started") {
      if ((await this.#observeDatabaseState()) !== "post_reset") {
        return { observation: "mixed", receipt: null };
      }
      const storage = await this.#storage.assertNamespaceState({
        artifactDigest: context.artifactDigest,
        envelope: this.#storageEnvelope,
        dataState: "approved_subset",
        recoveryState: "complete",
      });
      if (storage.dataState === "pre") {
        return { observation: "database_committed", receipt: null };
      }
      if (storage.dataState !== "post") return { observation: "mixed", receipt: null };
      const snapshot = await this.#storage.captureStableSnapshot(this.#storageEnvelope, "post");
      if (
        !sameDigest(
          snapshot.fingerprint,
          this.#input.executionApproval.postStorageNamespaceFingerprint,
        )
      ) {
        stop("POST_RESET_INTEGRITY_MISMATCH");
      }
      return {
        observation: "storage_deleted",
        receipt: adapterReceipt(
          context,
          { reconciled: true },
          {
            databaseRows: 0,
            storageCopies: 0,
            storageDeletes: this.#input.artifact.postResetExpectations.resetStorageObjectCount,
          },
        ),
      };
    }

    if (phase === "verification_started") {
      try {
        return {
          observation: "post_verified",
          receipt: await this.#postResetReconciliationReceipt(context),
        };
      } catch (error) {
        if (!isStateMismatch(error)) throw error;
        return { observation: "storage_deleted", receipt: null };
      }
    }

    if (phase === "restore_started" || phase === "restore_verification_started") {
      if (
        !restore ||
        (restore.durableAction !== "manual_restore" &&
          restore.durableAction !== `rollback_restore:${restore.point}`)
      ) {
        stop("PHASE_STATE_INVALID");
      }
      const database = await this.#observeDatabaseState();
      if (database === "mixed") stop("DATABASE_VERIFICATION_MISMATCH");
      if (database !== "baseline") {
        if (phase === "restore_verification_started") {
          stop("DATABASE_VERIFICATION_MISMATCH");
        }
        this.#authorization(context);
        return { observation: "pre", receipt: null };
      }
      const baselineObservationDigest = sha256Digest(
        canonicalJson(this.#input.artifact.reviewedBaseline),
      );
      try {
        await this.#recovery.requireExecutedRestore({
          approvalDigest: this.#input.executionApproval.digest,
          expectedRestorePointFingerprint:
            this.#input.executionApproval.databaseRestorePointFingerprint,
          expectedBaselineObservationDigest: baselineObservationDigest,
          rollbackPoint: restore.point,
          durableAction: restore.durableAction,
        });
      } catch (error) {
        if (!(error instanceof Sk90ResetSafetyError) || error.code !== "RESTORE_REQUIRED") {
          throw error;
        }
        if (phase === "restore_verification_started") throw error;
        this.#authorization(context);
        return { observation: "pre", receipt: null };
      }

      if (phase === "restore_verification_started") {
        this.#authorization(context);
        const storage = await this.#storage.captureStableSnapshot(this.#storageEnvelope, "pre");
        if (
          !sameDigest(
            storage.fingerprint,
            this.#input.executionApproval.preStorageNamespaceFingerprint,
          )
        ) {
          stop("RESTORE_PROOF_MISMATCH");
        }
        return { observation: "restored", receipt: null };
      }

      this.#authorization(context);
      await this.assertDatabaseRecoveryReady(context);
      const before = this.#storage.getMutationCounters();
      const replay = await this.#storage.restoreResetObjects({
        artifactDigest: context.artifactDigest,
        envelope: this.#storageEnvelope,
        forceReplay: true,
        assertAuthorizationFresh: () => {
          this.#assertFreshAtBoundary(context);
        },
      });
      const mutations = counterDelta(before, this.#storage.getMutationCounters());
      const expectedCopies = this.#input.artifact.postResetExpectations.resetStorageObjectCount;
      if (
        replay.restoredCount !== expectedCopies ||
        replay.alreadyPresentCount !== 0 ||
        mutations.storageCopies !== expectedCopies ||
        !sameDigest(
          replay.snapshot.fingerprint,
          this.#input.executionApproval.preStorageNamespaceFingerprint,
        )
      ) {
        stop("RESTORE_PROOF_MISMATCH");
      }
      return {
        observation: "restored",
        receipt: adapterReceipt(context, { reconciled: true }, mutations),
      };
    }

    if (phase === "second_run_started") {
      try {
        await this.#postResetReconciliationReceipt(context);
        return { observation: "post_verified", receipt: null };
      } catch (error) {
        if (!isStateMismatch(error)) throw error;
        return { observation: "mixed", receipt: null };
      }
    }
    stop("PHASE_STATE_INVALID");
  }

  #bindings(): DurableRunBindings {
    const approval = this.#input.executionApproval;
    return {
      artifactDigest: this.#input.artifact.digest,
      manifestDigest: this.#input.manifest.digest,
      targetPolicyDigest: this.#input.artifact.target.policyDigest,
      targetDatabaseFingerprint: this.#input.artifact.target.databaseFingerprint,
      targetStorageFingerprint: this.#input.artifact.target.storageFingerprint,
      approvedTargetObservationDigest: targetObservationDigest(this.#input.artifact.target),
      executionApprovalDigest: approval.digest,
      migrationDigest: this.#input.migration.digest,
      privateEnvelopeDigest: privateExecutionEnvelopeDigest(this.#input.privateEnvelope),
      resetPlanDigest: approval.resetPlanDigest,
      evidenceObservationDigest: this.#input.artifact.discoveryEvidence.bindingDigest,
      databaseRestorePointFingerprint: approval.databaseRestorePointFingerprint,
      storageRestorePointFingerprint: approval.storageRestorePointFingerprint,
      preStorageNamespaceFingerprint: approval.preStorageNamespaceFingerprint,
      postStorageNamespaceFingerprint: approval.postStorageNamespaceFingerprint,
      runInstanceMarkerDigest: this.#input.approvalConsumption.runInstanceMarkerDigest,
    };
  }

  #assertContext(context: AuthorizedActionContext): void {
    const bindings = this.#bindings();
    const observed = {
      artifactDigest: context.artifactDigest,
      manifestDigest: context.manifestDigest,
      targetPolicyDigest: context.targetPolicyDigest,
      targetDatabaseFingerprint: context.targetDatabaseFingerprint,
      targetStorageFingerprint: context.targetStorageFingerprint,
      executionApprovalDigest: context.executionApprovalDigest,
      migrationDigest: context.migrationDigest,
      privateEnvelopeDigest: context.privateEnvelopeDigest,
      resetPlanDigest: context.resetPlanDigest,
      evidenceObservationDigest: context.evidenceObservationDigest,
      databaseRestorePointFingerprint: context.databaseRestorePointFingerprint,
      storageRestorePointFingerprint: context.storageRestorePointFingerprint,
      preStorageNamespaceFingerprint: context.preStorageNamespaceFingerprint,
      postStorageNamespaceFingerprint: context.postStorageNamespaceFingerprint,
    };
    const expected = {
      artifactDigest: bindings.artifactDigest,
      manifestDigest: bindings.manifestDigest,
      targetPolicyDigest: bindings.targetPolicyDigest,
      targetDatabaseFingerprint: bindings.targetDatabaseFingerprint,
      targetStorageFingerprint: bindings.targetStorageFingerprint,
      executionApprovalDigest: bindings.executionApprovalDigest,
      migrationDigest: bindings.migrationDigest,
      privateEnvelopeDigest: bindings.privateEnvelopeDigest,
      resetPlanDigest: bindings.resetPlanDigest,
      evidenceObservationDigest: bindings.evidenceObservationDigest,
      databaseRestorePointFingerprint: bindings.databaseRestorePointFingerprint,
      storageRestorePointFingerprint: bindings.storageRestorePointFingerprint,
      preStorageNamespaceFingerprint: bindings.preStorageNamespaceFingerprint,
      postStorageNamespaceFingerprint: bindings.postStorageNamespaceFingerprint,
    };
    if (
      canonicalJson(observed) !== canonicalJson(expected) ||
      !sameDigest(context.targetObservationDigest, bindings.approvedTargetObservationDigest)
    ) {
      stop("ARTIFACT_BINDING_MISMATCH");
    }
  }
}

export function adapterBackedResetPlanDigest(
  input: Readonly<{
    artifactDigest: Sha256Digest;
    manifestDigest: Sha256Digest;
    migrationDigest: Sha256Digest;
    privateEnvelopeDigest: Sha256Digest;
  }>,
): Sha256Digest {
  for (const digest of Object.values(input)) assertSha256Digest(digest);
  return sha256Digest(
    canonicalJson({
      contract: "sk90-adapter-backed-reset-plan-v1",
      ...input,
      rollbackPoints: REQUIRED_ROLLBACK_POINTS,
      phases: [
        "backup_and_quarantine",
        "rollback_rehearsals",
        "database_reset_and_0027_cutover",
        "storage_delete",
        "post_reset_verification",
        "second_run_exact_noop",
      ],
    }),
  );
}

function privateStorageFingerprint(
  envelope: PrivateExecutionEnvelope,
  hmacKey: string,
  ownership: "all" | "preserved_only",
): Sha256Digest {
  const objects = recomputePrivateEnvelopeTokens(envelope, hmacKey)
    .storageObjects.filter((object) => ownership === "all" || object.ownership === "preserved_only")
    .map((object) => ({
      bucketRole: object.bucketRole,
      protectedKey: object.protectedKey,
      ownership: object.ownership,
      sizeBytes: object.sizeBytes,
      contentFingerprint: object.contentFingerprint,
      metadataFingerprint: object.metadataFingerprint,
    }));
  return sha256Digest(canonicalJson(objects));
}

export function adapterBackedPostStorageNamespaceFingerprint(
  envelope: PrivateExecutionEnvelope,
  hmacKey: string,
): Sha256Digest {
  return privateStorageFingerprint(envelope, hmacKey, "preserved_only");
}

function recoveryProtectedKey(
  input: Readonly<{
    artifactDigest: Sha256Digest;
    storageConfig: Sk90R2RehearsalConfig;
    hmacKey: string;
  }>,
  bucketRole: "audio" | "docs",
  sourceProtectedKey: ProtectedToken,
): ProtectedToken {
  const key = `${input.storageConfig.namespace}/recovery/${input.artifactDigest.slice(
    "sha256:".length,
  )}/${bucketRole}/${sourceProtectedKey.slice("hmac-sha256:".length)}`;
  return protectValue(input.hmacKey, `storage-recovery-key\0${bucketRole}\0${key}`);
}

export function adapterBackedStorageRestorePointFingerprint(
  input: Readonly<{
    artifactDigest: Sha256Digest;
    privateEnvelope: PrivateExecutionEnvelope;
    hmacKey: string;
    storageConfig: Sk90R2RehearsalConfig;
  }>,
): Sha256Digest {
  const copies = recomputePrivateEnvelopeTokens(input.privateEnvelope, input.hmacKey)
    .storageObjects.filter((object) => object.ownership === "reset_exclusive")
    .map((object) => ({
      bucketRole: object.bucketRole,
      protectedSourceKey: object.protectedKey,
      sourceContentFingerprint: object.contentFingerprint,
      protectedCopyKey: recoveryProtectedKey(
        {
          artifactDigest: input.artifactDigest,
          storageConfig: input.storageConfig,
          hmacKey: input.hmacKey,
        },
        object.bucketRole,
        object.protectedKey,
      ),
      copyContentFingerprint: object.contentFingerprint,
      copyExists: true as const,
      restoreVerified: true as const,
    }))
    .sort((left, right) => compareUtf8Bytes(left.protectedSourceKey, right.protectedSourceKey));
  return sha256Digest(canonicalJson(copies));
}

function assertAdapterBackedInput(input: AdapterBackedRehearsalInput): void {
  if (input.hmacKey.length < 32) stop("REHEARSAL_ENV_INVALID");
  assertManifestDigest(input.manifest);
  assertApprovedResetArtifact(input.artifact);
  assertPrivateExecutionEnvelope(input.privateEnvelope, input.hmacKey, {
    artifactDigest: input.artifact.digest,
    manifestDigest: input.manifest.digest,
    targetPolicyDigest: input.artifact.target.policyDigest,
  });
  assertPrivateEnvelopeMatchesManifest(input.privateEnvelope, input.manifest, input.hmacKey);
  assertSk90R2RehearsalConfig(input.storageConfig);
  if (
    !sameDigest(input.artifact.manifestDigest, input.manifest.digest) ||
    !sameDigest(input.manifest.targetPolicyDigest, input.artifact.target.policyDigest) ||
    !sameDigest(sha256Digest(input.migration.content), input.migration.digest) ||
    input.privateEnvelope.rows.length !== input.artifact.postResetExpectations.resetRowCount ||
    input.privateEnvelope.storageObjects.filter((object) => object.ownership === "reset_exclusive")
      .length !== input.artifact.postResetExpectations.resetStorageObjectCount ||
    input.privateEnvelope.storageObjects.filter((object) => object.ownership === "preserved_only")
      .length !== input.artifact.postResetExpectations.preservedStorageObjectCount
  ) {
    stop("ARTIFACT_BINDING_MISMATCH");
  }
  const envelopeDigest = privateExecutionEnvelopeDigest(input.privateEnvelope);
  const preStorage = privateStorageNamespaceFingerprint(input.privateEnvelope, input.hmacKey);
  const postStorage = adapterBackedPostStorageNamespaceFingerprint(
    input.privateEnvelope,
    input.hmacKey,
  );
  const resetPlan = adapterBackedResetPlanDigest({
    artifactDigest: input.artifact.digest,
    manifestDigest: input.manifest.digest,
    migrationDigest: input.migration.digest,
    privateEnvelopeDigest: envelopeDigest,
  });
  const approval = input.executionApproval;
  if (
    !sameDigest(approval.artifactDigest, input.artifact.digest) ||
    !sameDigest(approval.manifestDigest, input.manifest.digest) ||
    !sameDigest(approval.policyDigest, input.artifact.target.policyDigest) ||
    !sameDigest(approval.targetDatabaseFingerprint, input.artifact.target.databaseFingerprint) ||
    !sameDigest(approval.targetStorageFingerprint, input.artifact.target.storageFingerprint) ||
    !sameDigest(approval.migrationDigest, input.migration.digest) ||
    !sameDigest(approval.privateEnvelopeDigest, envelopeDigest) ||
    !sameDigest(approval.resetPlanDigest, resetPlan) ||
    !sameDigest(
      approval.evidenceObservationDigest,
      input.artifact.discoveryEvidence.bindingDigest,
    ) ||
    !sameDigest(input.artifact.discoveryEvidence.storageEnumerationDigest, preStorage) ||
    !sameDigest(approval.preStorageNamespaceFingerprint, preStorage) ||
    !sameDigest(approval.postStorageNamespaceFingerprint, postStorage) ||
    !sameDigest(
      approval.storageRestorePointFingerprint,
      adapterBackedStorageRestorePointFingerprint({
        artifactDigest: input.artifact.digest,
        privateEnvelope: input.privateEnvelope,
        hmacKey: input.hmacKey,
        storageConfig: input.storageConfig,
      }),
    )
  ) {
    stop("EXECUTION_APPROVAL_MISMATCH");
  }
  const reboundApproval = bindExecutableResetApproval(approval);
  if (
    !sameDigest(reboundApproval.digest, approval.digest) ||
    !sameDigest(approval.digest, input.approvedExecutionDigest)
  ) {
    stop("EXECUTION_APPROVAL_MISMATCH");
  }
}

/**
 * Validate every private, artifact, approval, migration, target, and storage
 * binding before constructing a database pool, recovery process, or R2 client.
 */
export async function createAdapterBackedRehearsalPorts(
  input: AdapterBackedRehearsalInput,
): Promise<RehearsalRunnerPorts> {
  assertAdapterBackedInput(input);
  const approvalConsumption = await consumeExecutableResetApproval({
    approval: input.executionApproval,
    approvedDigest: input.approvedExecutionDigest,
    approvalFilePath: input.approvalFilePath,
    approvalLedgerDirectory: input.approvalLedgerDirectory,
    stateDirectory: input.stateDirectory,
    hmacKey: input.hmacKey,
    now: input.now(),
  });
  const pools = input.createDatabasePools();
  const database = new Sk90DatabaseRehearsalAdapter(
    pools.transactionPool,
    pools.concurrentProbePool,
    input.now,
  ) as SecondRunDatabaseAdapter;
  if (typeof database.executeSecondRunNoOp !== "function") {
    stop("EXTERNAL_ADAPTER_REQUIRED");
  }
  const storageClient = input.createStorageClient();
  const targetObserver = input.createTargetObserver({
    databasePool: pools.transactionPool,
    storageClient,
    storageConfig: input.storageConfig,
  });
  const storage = createSk90R2Rehearsal({
    client: storageClient,
    config: input.storageConfig,
    tokenForKey: ({ scope, bucketRole, key }) =>
      protectValue(
        input.hmacKey,
        scope === "data"
          ? `storage-key\0${bucketRole}\0${key}`
          : `storage-recovery-key\0${bucketRole}\0${key}`,
      ),
  });
  const recovery = input.createDatabaseRecovery({
    verifyRestoredBaseline: () =>
      database.verifyRestoredBaseline({
        artifact: input.artifact,
        hmacKey: input.hmacKey,
        approvedStorageReferences: input.manifest.storageReferences,
      }),
  });
  return new AdapterBackedRehearsalPorts(
    { ...input, targetObserver, approvalConsumption },
    database,
    storage,
    recovery,
    rawStorageEnvelope(input.privateEnvelope, input.hmacKey),
  );
}

export type SafeRunnerEvent =
  | Readonly<{
      kind: "phase";
      phase: DurableRunPhase;
      revision: number;
    }>
  | Readonly<{
      kind: "complete";
      artifactDigest: Sha256Digest;
      manifestDigest: Sha256Digest;
      stateDigest: Sha256Digest;
      mutationTotals: MutationCounters;
    }>;

export interface SafeRunnerReporter {
  emit(event: SafeRunnerEvent): void;
}

export type RunnerClock = Readonly<{
  now(): Date;
}>;

export type RunnerResult = Readonly<{
  phase: DurableRunPhase;
  revision: number;
  artifactDigest: Sha256Digest;
  manifestDigest: Sha256Digest;
  stateDigest: Sha256Digest;
  mutationTotals: MutationCounters;
}>;

const NOOP_REPORTER: SafeRunnerReporter = { emit: () => undefined };

function validDate(date: Date): Date {
  if (!Number.isFinite(date.getTime())) stop("FRESH_TARGET_AUTHORIZATION_INVALID");
  return date;
}

function assertReceiptForContext(
  receipt: DurableOperationReceipt,
  context: AuthorizedActionContext,
  requireFingerprint = false,
): void {
  assertSha256Digest(receipt.artifactDigest);
  assertSha256Digest(receipt.targetObservationDigest);
  assertSha256Digest(receipt.receiptDigest);
  if (
    receipt.action !== context.action ||
    !sameDigest(receipt.artifactDigest, context.artifactDigest) ||
    !sameDigest(receipt.targetObservationDigest, context.targetObservationDigest) ||
    receipt.challengeToken === null ||
    !sameDigest(receipt.challengeToken, context.challengeToken) ||
    receipt.issuedAt !== context.issuedAt ||
    receipt.expiresAt !== context.expiresAt ||
    (requireFingerprint && receipt.postStateFingerprint === null)
  ) {
    stop("ARTIFACT_BINDING_MISMATCH");
  }
  if (receipt.postStateFingerprint !== null) assertSha256Digest(receipt.postStateFingerprint);
  for (const count of [
    receipt.mutations.databaseRows,
    receipt.mutations.storageCopies,
    receipt.mutations.storageDeletes,
  ]) {
    if (!Number.isSafeInteger(count) || count < 0) stop("POST_RESET_INTEGRITY_MISMATCH");
  }
}

function isStartedPhase(phase: DurableRunPhase): boolean {
  return (
    phase === "quarantine_started" ||
    phase === "rollback_scenario_started" ||
    phase === "rollback_partial_storage_delete_started" ||
    phase === "database_reset_started" ||
    phase === "storage_delete_started" ||
    phase === "verification_started" ||
    phase === "restore_started" ||
    phase === "restore_verification_started" ||
    phase === "second_run_started"
  );
}

function reconciliationAction(phase: DurableRunPhase): DurableAction {
  switch (phase) {
    case "quarantine_started":
      return "reconcile_quarantine";
    case "database_reset_started":
      return "reconcile_database_commit";
    case "storage_delete_started":
      return "reconcile_storage_delete";
    case "verification_started":
      return "reconcile_post_reset";
    case "restore_started":
    case "restore_verification_started":
      return "reconcile_restore";
    case "second_run_started":
      return "reconcile_second_run";
    default:
      stop("PHASE_STATE_INVALID");
  }
}

function rollbackPointForPhase(state: DurableRunState): RequiredRollbackPoint {
  if (state.activePurpose?.kind === "rollback") return state.activePurpose.point;
  if (state.phase === "database_committed") {
    return "after_database_commit_before_storage_delete";
  }
  if (
    state.phase === "storage_deleted" ||
    state.phase === "storage_delete_started" ||
    state.phase === "verification_started" ||
    state.phase === "first_verified" ||
    state.phase === "second_run_started" ||
    state.phase === "verified"
  ) {
    return "after_partial_storage_delete";
  }
  return "before_database_commit";
}

function nextPurpose(state: DurableRunState): RunPurpose {
  const missing = REQUIRED_ROLLBACK_POINTS.find(
    (point) => !state.completedRollbackPoints.includes(point),
  );
  return missing ? { kind: "rollback", point: missing } : { kind: "final" };
}

function restoreWasACompletedExercise(state: DurableRunState): boolean {
  if (state.activePurpose?.kind !== "rollback") return false;
  if (state.activePurpose.point === "after_partial_storage_delete") {
    return (
      receiptForAction(state, "rollback_interrupt_storage:after_partial_storage_delete") !==
      undefined
    );
  }
  if (receiptForAction(state, `rollback_interrupt:${state.activePurpose.point}`) !== undefined) {
    return true;
  }
  const reconciliation = receiptForAction(state, "reconcile_rollback_interruption");
  return (
    state.activePurpose.point === "after_database_commit_before_storage_delete" &&
    reconciliation !== undefined &&
    reconciliation.mutations.databaseRows > 0
  );
}

function restoreWasManual(state: DurableRunState): boolean {
  const restoreNonce = [...state.nonceLedger]
    .reverse()
    .find(
      (entry) => entry.action === "manual_restore" || entry.action.startsWith("rollback_restore:"),
    );
  return restoreNonce?.action === "manual_restore";
}

function latestReceiptForActions(
  state: DurableRunState,
  actions: ReadonlySet<DurableAction>,
): DurableOperationReceipt | undefined {
  return [...state.receipts].reverse().find((receipt) => actions.has(receipt.action));
}

export class Sk90RehearsalRunner {
  readonly #store: DurableRunStateStore;
  readonly #ports: RehearsalRunnerPorts;
  readonly #clock: RunnerClock;
  readonly #reporter: SafeRunnerReporter;
  readonly #nonceTtlMs: number;

  constructor(
    input: Readonly<{
      store: DurableRunStateStore;
      ports: RehearsalRunnerPorts;
      clock?: RunnerClock;
      reporter?: SafeRunnerReporter;
      nonceTtlMs?: number;
    }>,
  ) {
    this.#store = input.store;
    this.#ports = input.ports;
    this.#clock = input.clock ?? { now: () => new Date() };
    this.#reporter = input.reporter ?? NOOP_REPORTER;
    this.#nonceTtlMs = input.nonceTtlMs ?? 60_000;
    if (
      !Number.isSafeInteger(this.#nonceTtlMs) ||
      this.#nonceTtlMs <= 0 ||
      this.#nonceTtlMs > MAX_DURABLE_NONCE_TTL_MS
    ) {
      stop("FRESH_TARGET_AUTHORIZATION_INVALID");
    }
  }

  async run(mode: RunnerMode): Promise<RunnerResult> {
    switch (mode) {
      case "plan":
        return this.#plan();
      case "execute":
      case "resume":
        return this.#execute();
      case "restore":
        return this.#forceRestore();
    }
  }

  async #plan(): Promise<RunnerResult> {
    if ((await this.#store.load()) !== null) stop("PHASE_STATE_INVALID");
    const prepared = await this.#ports.prepare();
    assertSha256Digest(prepared.bindings.artifactDigest);
    assertSha256Digest(prepared.bindings.manifestDigest);
    assertSha256Digest(prepared.bindings.targetPolicyDigest);
    if (
      !sameDigest(prepared.receipt.artifactDigest, prepared.bindings.artifactDigest) ||
      !sameDigest(
        prepared.receipt.targetObservationDigest,
        prepared.bindings.approvedTargetObservationDigest,
      ) ||
      prepared.receipt.challengeToken !== null ||
      !hasZeroMutations(prepared.receipt.mutations)
    ) {
      stop("ARTIFACT_BINDING_MISMATCH");
    }
    const state = await this.#store.initialize({
      bindings: prepared.bindings,
      prepareReceipt: prepared.receipt,
    });
    this.#emitPhase(state);
    return this.#result(state);
  }

  async #execute(): Promise<RunnerResult> {
    let state = await this.#requiredState();
    if (isStartedPhase(state.phase)) state = await this.#recover(state);

    for (let step = 0; step < 80; step += 1) {
      switch (state.phase) {
        case "prepared":
        case "restored":
          state = await this.#performQuarantine(state, nextPurpose(state));
          break;
        case "quarantine_started":
          if (!state.activePurpose) stop("PHASE_STATE_INVALID");
          state = await this.#completeQuarantine(state, state.activePurpose);
          break;
        case "objects_quarantined":
          if (state.activePurpose?.kind === "rollback") {
            state = await this.#performRollbackInterruption(state, state.activePurpose.point);
          } else if (state.activePurpose?.kind === "final") {
            state = await this.#performDatabaseReset(state);
          } else {
            stop("PHASE_STATE_INVALID");
          }
          break;
        case "rollback_scenario_started":
          state = await this.#performRestore(state, rollbackPointForPhase(state), false, false);
          break;
        case "rollback_partial_database_committed":
          state = await this.#performPartialStorageRollbackInterruption(state);
          break;
        case "rollback_partial_storage_delete_started":
          state = await this.#performRestore(state, rollbackPointForPhase(state), false, false);
          break;
        case "rollback_started":
          state = await this.#performRestore(
            state,
            rollbackPointForPhase(state),
            restoreWasACompletedExercise(state),
            false,
          );
          break;
        case "database_reset_started":
          state = await this.#completeDatabaseReset(state);
          break;
        case "database_committed":
          state = await this.#performStorageDelete(state);
          break;
        case "storage_delete_started":
          state = await this.#completeStorageDelete(state);
          break;
        case "storage_deleted":
          state = await this.#performFirstVerification(state);
          break;
        case "verification_started":
          state = await this.#completeFirstVerification(state);
          break;
        case "first_verified":
          state = await this.#performSecondRun(state);
          break;
        case "second_run_started":
          state = await this.#completeSecondRun(state);
          break;
        case "restore_started":
        case "restore_verification_started":
          state = await this.#recover(state);
          break;
        case "verified":
          this.#reporter.emit({
            kind: "complete",
            artifactDigest: state.bindings.artifactDigest,
            manifestDigest: state.bindings.manifestDigest,
            stateDigest: state.stateDigest,
            mutationTotals: state.mutationTotals,
          });
          return this.#result(state);
      }
    }
    stop("PHASE_STATE_INVALID");
  }

  async #forceRestore(): Promise<RunnerResult> {
    let state = await this.#requiredState();
    if (state.phase === "restored") return this.#result(state);
    if (state.phase === "restore_started" || state.phase === "restore_verification_started") {
      state = await this.#recover(state);
      if (state.phase === "restored") return this.#result(state);
    }
    state = await this.#performRestore(state, rollbackPointForPhase(state), false, true);
    return this.#result(state);
  }

  async #performQuarantine(state: DurableRunState, purpose: RunPurpose): Promise<DurableRunState> {
    const started = await this.#transition(state, (current) => ({
      ...current,
      phase: "quarantine_started",
      activePurpose: purpose,
    }));
    return this.#completeQuarantine(started, purpose);
  }

  async #completeQuarantine(state: DurableRunState, purpose: RunPurpose): Promise<DurableRunState> {
    const authorized = await this.#authorize(state, quarantineAction(purpose));
    const receipt = await this.#ports.quarantine(authorized.context, purpose);
    assertReceiptForContext(receipt, authorized.context);
    return this.#recordReceipt(authorized.state, receipt, "objects_quarantined");
  }

  async #performRollbackInterruption(
    state: DurableRunState,
    point: RequiredRollbackPoint,
  ): Promise<DurableRunState> {
    const started = await this.#transition(state, (current) => ({
      ...current,
      phase: "rollback_scenario_started",
    }));
    if (point === "after_partial_storage_delete") {
      const action = "rollback_interrupt_database:after_partial_storage_delete" as const;
      const authorized = await this.#authorize(started, action);
      await this.#ports.assertDatabaseRecoveryReady(authorized.context);
      const receipt = await this.#ports.interruptForRollback(authorized.context, point);
      assertReceiptForContext(receipt, authorized.context);
      const databaseCommitted = await this.#recordReceipt(
        authorized.state,
        receipt,
        "rollback_partial_database_committed",
      );
      return this.#performPartialStorageRollbackInterruption(databaseCommitted);
    }
    const action = `rollback_interrupt:${point}` as const;
    const authorized = await this.#authorize(started, action);
    if (point === "after_database_commit_before_storage_delete") {
      await this.#ports.assertDatabaseRecoveryReady(authorized.context);
    }
    const receipt = await this.#ports.interruptForRollback(authorized.context, point);
    assertReceiptForContext(receipt, authorized.context);
    const interrupted = await this.#recordReceipt(authorized.state, receipt, "rollback_started");
    return this.#performRestore(interrupted, point, true, false);
  }

  async #performPartialStorageRollbackInterruption(
    state: DurableRunState,
  ): Promise<DurableRunState> {
    if (
      state.activePurpose?.kind !== "rollback" ||
      state.activePurpose.point !== "after_partial_storage_delete"
    ) {
      stop("PHASE_STATE_INVALID");
    }
    const started = await this.#transition(state, (current) => ({
      ...current,
      phase: "rollback_partial_storage_delete_started",
    }));
    const action = "rollback_interrupt_storage:after_partial_storage_delete" as const;
    const authorized = await this.#authorize(started, action);
    await this.#ports.assertDatabaseRecoveryReady(authorized.context);
    const receipt = await this.#ports.interruptForRollback(
      authorized.context,
      "after_partial_storage_delete",
    );
    assertReceiptForContext(receipt, authorized.context);
    const interrupted = await this.#recordReceipt(authorized.state, receipt, "rollback_started");
    return this.#performRestore(interrupted, "after_partial_storage_delete", true, false);
  }

  async #performDatabaseReset(state: DurableRunState): Promise<DurableRunState> {
    const started = await this.#transition(state, (current) => ({
      ...current,
      phase: "database_reset_started",
    }));
    return this.#completeDatabaseReset(started);
  }

  async #completeDatabaseReset(state: DurableRunState): Promise<DurableRunState> {
    const authorized = await this.#authorize(state, "database_reset");
    await this.#ports.assertDatabaseRecoveryReady(authorized.context);
    const receipt = await this.#ports.resetDatabase(authorized.context);
    assertReceiptForContext(receipt, authorized.context);
    return this.#recordReceipt(authorized.state, receipt, "database_committed");
  }

  async #performStorageDelete(state: DurableRunState): Promise<DurableRunState> {
    const started = await this.#transition(state, (current) => ({
      ...current,
      phase: "storage_delete_started",
    }));
    return this.#completeStorageDelete(started);
  }

  async #completeStorageDelete(state: DurableRunState): Promise<DurableRunState> {
    const authorized = await this.#authorize(state, "storage_delete");
    await this.#ports.assertDatabaseRecoveryReady(authorized.context);
    const receipt = await this.#ports.deleteStorage(authorized.context);
    assertReceiptForContext(receipt, authorized.context);
    return this.#recordReceipt(authorized.state, receipt, "storage_deleted");
  }

  async #performFirstVerification(state: DurableRunState): Promise<DurableRunState> {
    const started = await this.#transition(state, (current) => ({
      ...current,
      phase: "verification_started",
    }));
    return this.#completeFirstVerification(started);
  }

  async #completeFirstVerification(state: DurableRunState): Promise<DurableRunState> {
    const authorized = await this.#authorize(state, "post_reset_verify");
    const receipt = await this.#ports.verifyPostReset(authorized.context);
    assertReceiptForContext(receipt, authorized.context, true);
    if (!hasZeroMutations(receipt.mutations)) stop("POST_RESET_INTEGRITY_MISMATCH");
    return this.#recordReceipt(authorized.state, receipt, "first_verified");
  }

  async #performSecondRun(state: DurableRunState): Promise<DurableRunState> {
    const first =
      receiptForAction(state, "post_reset_verify") ??
      receiptForAction(state, "reconcile_post_reset");
    if (!first?.postStateFingerprint) stop("POST_RESET_INTEGRITY_REQUIRED");
    const started = await this.#transition(state, (current) => ({
      ...current,
      phase: "second_run_started",
    }));
    return this.#completeSecondRun(started, first);
  }

  async #completeSecondRun(
    state: DurableRunState,
    knownFirstReceipt?: DurableOperationReceipt,
  ): Promise<DurableRunState> {
    const firstReceipt =
      knownFirstReceipt ??
      receiptForAction(state, "post_reset_verify") ??
      receiptForAction(state, "reconcile_post_reset");
    const first = firstReceipt?.postStateFingerprint;
    if (!firstReceipt || !first) stop("POST_RESET_INTEGRITY_REQUIRED");
    const authorized = await this.#authorize(state, "second_run");
    await this.#ports.assertDatabaseRecoveryReady(authorized.context);
    const receipt = await this.#ports.runSecondTime(authorized.context, firstReceipt);
    assertReceiptForContext(receipt, authorized.context, true);
    if (
      !hasZeroMutations(receipt.mutations) ||
      receipt.postStateFingerprint === null ||
      !sameDigest(receipt.postStateFingerprint, first)
    ) {
      stop("POST_RESET_INTEGRITY_MISMATCH");
    }
    return this.#recordReceipt(authorized.state, receipt, "verified");
  }

  async #performRestore(
    state: DurableRunState,
    point: RequiredRollbackPoint,
    completeExercise: boolean,
    manual: boolean,
  ): Promise<DurableRunState> {
    this.#assertDurableRestoreEvidence(state, point, manual);
    const started =
      state.phase === "restore_started"
        ? state
        : await this.#transition(state, (current) => ({ ...current, phase: "restore_started" }));
    const action: DurableAction = manual ? "manual_restore" : `rollback_restore:${point}`;
    const authorized = await this.#authorize(started, action);
    const receipt = await this.#ports.restore(authorized.context, point);
    assertReceiptForContext(receipt, authorized.context);
    const restoring = await this.#recordReceipt(
      authorized.state,
      receipt,
      "restore_verification_started",
    );
    return this.#completeRestoreVerification(restoring, point, completeExercise, manual);
  }

  async #completeRestoreVerification(
    state: DurableRunState,
    point: RequiredRollbackPoint,
    completeExercise: boolean,
    manual: boolean,
  ): Promise<DurableRunState> {
    const restoreAction: DurableAction = manual ? "manual_restore" : `rollback_restore:${point}`;
    const restoreReceipt = latestReceiptForActions(
      state,
      new Set<DurableAction>([restoreAction, "reconcile_restore"]),
    );
    if (!restoreReceipt) stop("RESTORE_PROOF_MISMATCH");
    const action: DurableAction = manual ? "manual_restore_verify" : `rollback_verify:${point}`;
    const authorized = await this.#authorize(state, action);
    const receipt = await this.#ports.verifyRestored(authorized.context, point, restoreReceipt);
    assertReceiptForContext(receipt, authorized.context, true);
    if (!hasZeroMutations(receipt.mutations)) stop("RESTORE_PROOF_MISMATCH");
    const completedRollbackPoints = completeExercise
      ? [...new Set([...authorized.state.completedRollbackPoints, point])]
      : authorized.state.completedRollbackPoints;
    return this.#recordReceipt(authorized.state, receipt, "restored", {
      activePurpose: null,
      completedRollbackPoints,
    });
  }

  async #recover(state: DurableRunState): Promise<DurableRunState> {
    if (state.phase === "rollback_scenario_started") {
      const point = rollbackPointForPhase(state);
      const authorized = await this.#authorize(state, "reconcile_rollback_interruption");
      const result = await this.#ports.reconcileRollbackInterruption(authorized.context, point);
      if (result.observation === "baseline") {
        if (result.receipt !== null) stop("DATABASE_VERIFICATION_MISMATCH");
        return this.#transition(authorized.state, (current) => ({
          ...current,
          phase: "objects_quarantined",
        }));
      }
      if (
        result.observation !== "post_reset" ||
        point === "before_database_commit" ||
        result.receipt === null
      ) {
        stop("DATABASE_VERIFICATION_MISMATCH");
      }
      assertReceiptForContext(result.receipt, authorized.context);
      if (
        result.receipt.mutations.databaseRows <= 0 ||
        result.receipt.mutations.storageCopies !== 0 ||
        result.receipt.mutations.storageDeletes !== 0
      ) {
        stop("DATABASE_VERIFICATION_MISMATCH");
      }
      return this.#recordReceipt(
        authorized.state,
        result.receipt,
        point === "after_partial_storage_delete"
          ? "rollback_partial_database_committed"
          : "rollback_started",
      );
    }
    if (state.phase === "rollback_partial_storage_delete_started") {
      const databaseReceipt =
        receiptForAction(state, "rollback_interrupt_database:after_partial_storage_delete") ??
        receiptForAction(state, "reconcile_rollback_interruption");
      if (!databaseReceipt || databaseReceipt.mutations.databaseRows <= 0) {
        stop("DATABASE_VERIFICATION_MISMATCH");
      }
      return this.#performRestore(state, rollbackPointForPhase(state), false, false);
    }
    const action = reconciliationAction(state.phase);
    const authorized = await this.#authorize(state, action);
    const restoreReconciliation =
      state.phase === "restore_started" || state.phase === "restore_verification_started"
        ? {
            point: rollbackPointForPhase(state),
            durableAction: restoreWasManual(state)
              ? ("manual_restore" as const)
              : (`rollback_restore:${rollbackPointForPhase(state)}` as const),
          }
        : undefined;
    const result = await this.#ports.reconcile(
      authorized.context,
      state.phase,
      restoreReconciliation,
    );
    const decision = recoveryDecision(state.phase, result.observation);

    if (decision === "restore" || decision === "retry_restore") {
      return this.#performRestore(
        authorized.state,
        rollbackPointForPhase(state),
        restoreWasACompletedExercise(state),
        restoreWasManual(state),
      );
    }
    if (decision === "verify_restore") {
      const point = rollbackPointForPhase(state);
      const receipt = result.receipt;
      if (receipt) {
        assertReceiptForContext(receipt, authorized.context);
        const verifying = await this.#recordReceipt(
          authorized.state,
          receipt,
          "restore_verification_started",
        );
        return this.#completeRestoreVerification(
          verifying,
          point,
          restoreWasACompletedExercise(state),
          restoreWasManual(state),
        );
      }
      return this.#completeRestoreVerification(
        authorized.state,
        point,
        restoreWasACompletedExercise(state),
        restoreWasManual(state),
      );
    }
    if (decision === "retry_operation") return authorized.state;
    if (decision !== "reconcile_completed_operation") stop("PHASE_STATE_INVALID");
    if (!result.receipt) stop("PHASE_STATE_INVALID");
    const requireFingerprint = state.phase === "verification_started";
    assertReceiptForContext(result.receipt, authorized.context, requireFingerprint);
    switch (state.phase) {
      case "quarantine_started":
        return this.#recordReceipt(authorized.state, result.receipt, "objects_quarantined");
      case "database_reset_started":
        // This is the crash window where the database committed before the
        // local revision was published. Reconcile the exact DB receipt; never
        // repeat the reset based only on the older local phase.
        return this.#recordReceipt(authorized.state, result.receipt, "database_committed");
      case "storage_delete_started":
        return this.#recordReceipt(authorized.state, result.receipt, "storage_deleted");
      case "verification_started":
        return this.#recordReceipt(authorized.state, result.receipt, "first_verified");
      default:
        stop("PHASE_STATE_INVALID");
    }
  }

  #assertDurableRestoreEvidence(
    state: DurableRunState,
    point: RequiredRollbackPoint,
    manual: boolean,
  ): void {
    if (manual) return;
    if (state.activePurpose?.kind === "rollback") {
      if (point === "before_database_commit") {
        const receipt = receiptForAction(state, "rollback_interrupt:before_database_commit");
        if (!receipt || !hasZeroMutations(receipt.mutations)) {
          stop("DATABASE_VERIFICATION_MISMATCH");
        }
        return;
      }
      const databaseReceipt =
        point === "after_database_commit_before_storage_delete"
          ? (receiptForAction(
              state,
              "rollback_interrupt:after_database_commit_before_storage_delete",
            ) ?? receiptForAction(state, "reconcile_rollback_interruption"))
          : (receiptForAction(state, "rollback_interrupt_database:after_partial_storage_delete") ??
            receiptForAction(state, "reconcile_rollback_interruption"));
      if (!databaseReceipt || databaseReceipt.mutations.databaseRows <= 0) {
        stop("DATABASE_VERIFICATION_MISMATCH");
      }
      return;
    }

    if (point !== "before_database_commit") {
      const databaseReceipt = latestReceiptForActions(
        state,
        new Set<DurableAction>(["database_reset", "reconcile_database_commit"]),
      );
      if (!databaseReceipt || databaseReceipt.mutations.databaseRows <= 0) {
        stop("DATABASE_VERIFICATION_MISMATCH");
      }
    }
  }

  async #authorize(
    state: DurableRunState,
    action: DurableAction,
  ): Promise<Readonly<{ state: DurableRunState; context: AuthorizedActionContext }>> {
    const challengeToken = await this.#ports.freshChallenge(action);
    assertProtectedToken(challengeToken);
    const issued = validDate(this.#clock.now());
    const issuedAt = issued.toISOString();
    const expiresAt = new Date(issued.getTime() + this.#nonceTtlMs).toISOString();
    let durable = await issueDurableNonce(this.#store, state, {
      challengeToken,
      action,
      artifactDigest: state.bindings.artifactDigest,
      targetObservationDigest: state.bindings.approvedTargetObservationDigest,
      issuedAt,
      expiresAt,
    });
    const targetObservationDigest = await this.#ports.observeTarget({
      action,
      challengeToken,
      issuedAt,
      expiresAt,
    });
    assertSha256Digest(targetObservationDigest);
    if (!sameDigest(targetObservationDigest, state.bindings.approvedTargetObservationDigest)) {
      stop("FRESHNESS_PROOF_INVALID");
    }
    const currentTime = validDate(this.#clock.now()).toISOString();
    durable = await consumeDurableNonce(this.#store, durable, {
      challengeToken,
      action,
      artifactDigest: state.bindings.artifactDigest,
      targetObservationDigest,
      consumedAt: currentTime,
    });
    const context: AuthorizedActionContext = {
      action,
      artifactDigest: durable.bindings.artifactDigest,
      manifestDigest: durable.bindings.manifestDigest,
      targetPolicyDigest: durable.bindings.targetPolicyDigest,
      targetDatabaseFingerprint: durable.bindings.targetDatabaseFingerprint,
      targetStorageFingerprint: durable.bindings.targetStorageFingerprint,
      executionApprovalDigest: durable.bindings.executionApprovalDigest,
      migrationDigest: durable.bindings.migrationDigest,
      privateEnvelopeDigest: durable.bindings.privateEnvelopeDigest,
      resetPlanDigest: durable.bindings.resetPlanDigest,
      evidenceObservationDigest: durable.bindings.evidenceObservationDigest,
      databaseRestorePointFingerprint: durable.bindings.databaseRestorePointFingerprint,
      storageRestorePointFingerprint: durable.bindings.storageRestorePointFingerprint,
      preStorageNamespaceFingerprint: durable.bindings.preStorageNamespaceFingerprint,
      postStorageNamespaceFingerprint: durable.bindings.postStorageNamespaceFingerprint,
      targetObservationDigest,
      challengeToken,
      issuedAt,
      expiresAt,
      currentTime,
      durableNonceConsumptionDigest: consumedDurableNonceDigest(durable, challengeToken),
    };
    await this.#ports.assertAuthorizedTarget(context);
    return {
      state: durable,
      context,
    };
  }

  async #recordReceipt(
    state: DurableRunState,
    receipt: DurableOperationReceipt,
    phase: DurableRunPhase,
    overrides: Readonly<{
      activePurpose?: RunPurpose | null;
      completedRollbackPoints?: readonly RequiredRollbackPoint[];
    }> = {},
  ): Promise<DurableRunState> {
    return this.#transition(state, (current) => ({
      ...current,
      phase,
      activePurpose:
        overrides.activePurpose === undefined ? current.activePurpose : overrides.activePurpose,
      completedRollbackPoints: overrides.completedRollbackPoints ?? current.completedRollbackPoints,
      receipts: [...current.receipts, receipt],
      mutationTotals: addMutationCounters(current.mutationTotals, receipt.mutations),
    }));
  }

  async #transition(
    state: DurableRunState,
    mutate: Parameters<DurableRunStateStore["transition"]>[1],
  ): Promise<DurableRunState> {
    const next = await this.#store.transition(state, mutate);
    this.#emitPhase(next);
    return next;
  }

  async #requiredState(): Promise<DurableRunState> {
    const state = await this.#store.load();
    if (!state) stop("PHASE_STATE_INVALID");
    return state;
  }

  #emitPhase(state: DurableRunState): void {
    this.#reporter.emit({ kind: "phase", phase: state.phase, revision: state.revision });
  }

  #result(state: DurableRunState): RunnerResult {
    return {
      phase: state.phase,
      revision: state.revision,
      artifactDigest: state.bindings.artifactDigest,
      manifestDigest: state.bindings.manifestDigest,
      stateDigest: state.stateDigest,
      mutationTotals: state.mutationTotals,
    };
  }
}
