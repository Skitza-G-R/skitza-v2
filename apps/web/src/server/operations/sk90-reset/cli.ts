import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { createNeonPool } from "@skitza/db";

import type { ApprovedResetArtifact } from "./artifact";
import { assertApprovedResetArtifact } from "./artifact";
import {
  assertSha256Digest,
  canonicalJson,
  sha256Digest,
  sameDigest,
} from "./canonical";
import {
  Sk90DatabaseRehearsalAdapter,
  type NeonPoolClientLike,
  type NeonPoolLike,
} from "./database-adapter";
import { createDatabaseRecovery } from "./database-recovery";
import { FileDurableRunStateStore } from "./durable-state";
import {
  readExecutableRehearsalEnvironment,
  type BackupPreparationEnvironment,
  type ExecutableRehearsalEnvironment,
} from "./environment";
import { Sk90ResetSafetyError, stop, toSafeErrorReport, type SafeErrorReport } from "./errors";
import type { ExecutableResetApproval } from "./execution";
import { assertManifestDigest, type SanitizedResetManifest } from "./manifest";
import {
  assertPrivateExecutionEnvelope,
  readOwnerOnlyUtf8,
  type PrivateExecutionEnvelope,
} from "./private-envelope";
import {
  assertRehearsalTarget,
  authorizeFreshTargetAction,
  targetObservationDigest,
  type RehearsalTargetPolicy,
} from "./policy";
import { createSk90R2RehearsalClient } from "./r2-rehearsal";
import {
  createAdapterBackedRehearsalPorts,
  Sk90RehearsalRunner,
  type RunnerMode,
  type RunnerResult,
  type Sk90MigrationApprovalBinding,
  type Sk90MigrationTransactionPort,
} from "./runner";
import type { Sk90R2RehearsalConfig, Sk90S3Client } from "./storage-port";
import {
  assertChallengeBoundTargetObservation,
  assertActiveTargetObserverConfiguration,
  challengeBoundTargetObservationDigest,
  createActiveSk90TargetObserver,
  type BoundTargetObservation,
  type PrivateDatabaseTargetAttestation,
  type PrivateStorageTargetAttestation,
} from "./target-observer";

const RUNNER_MODES = new Set<RunnerMode>(["plan", "execute", "resume", "restore"]);
const BACKUP_PREPARATION_MODE = "prepare-backup" as const;
type CliMode = RunnerMode | typeof BACKUP_PREPARATION_MODE;

export function assertExactBackupPreparationObservation(
  observation: BoundTargetObservation,
  expected: Readonly<{
    challengeToken: BoundTargetObservation["challengeToken"];
    issuedAt: string;
    expiresAt: string;
    approvedTarget: ApprovedResetArtifact["target"];
  }>,
): `sha256:${string}` {
  assertChallengeBoundTargetObservation(observation);
  if (
    observation.action !== "prepare" ||
    !sameDigest(observation.challengeToken, expected.challengeToken) ||
    observation.issuedAt !== expected.issuedAt ||
    observation.expiresAt !== expected.expiresAt ||
    !sameDigest(
      observation.bindingDigest,
      challengeBoundTargetObservationDigest(observation),
    )
  ) {
    stop("FRESH_TARGET_AUTHORIZATION_INVALID");
  }
  const observedTarget = assertRehearsalTarget(
    observation.policy,
    expected.approvedTarget.policyDigest,
  );
  const observedDigest = targetObservationDigest(observedTarget);
  if (!sameDigest(observedDigest, targetObservationDigest(expected.approvedTarget))) {
    stop("FRESH_TARGET_AUTHORIZATION_INVALID");
  }
  return observedDigest;
}

export type SafeBackupPreparationResult = Readonly<{
  artifactDigest: `sha256:${string}`;
  targetObservationDigest: `sha256:${string}`;
  preparedBackupReceiptDigest: `sha256:${string}`;
  databaseRestorePointFingerprint: `sha256:${string}`;
}>;

export type SafeCliEvent =
  | Readonly<{ kind: "success"; mode: RunnerMode; result: RunnerResult }>
  | Readonly<{
      kind: "success";
      mode: typeof BACKUP_PREPARATION_MODE;
      result: SafeBackupPreparationResult;
    }>
  | Readonly<{ kind: "error"; error: SafeErrorReport }>;

export interface SafeCliReporter {
  emit(event: SafeCliEvent): void;
}

export type CliDependencies = Readonly<{
  createRunner(mode: RunnerMode): Promise<Pick<Sk90RehearsalRunner, "run">>;
  prepareBackup?(): Promise<SafeBackupPreparationResult>;
  reporter: SafeCliReporter;
}>;

export type ExecutablePrivateApprovalBundle = Readonly<{
  contract: "sk90-executable-private-approval-bundle-v1";
  artifact: ApprovedResetArtifact;
  manifest: SanitizedResetManifest;
  privateEnvelope: PrivateExecutionEnvelope;
  executionApproval: ExecutableResetApproval;
  targetPolicy: RehearsalTargetPolicy;
  databaseAttestation: PrivateDatabaseTargetAttestation;
  storageAttestations: Readonly<{
    audio: PrivateStorageTargetAttestation & Readonly<{ bucketRole: "audio" }>;
    docs: PrivateStorageTargetAttestation & Readonly<{ bucketRole: "docs" }>;
  }>;
}>;

export type ExecutablePrivateBackupPreparationBundle = Readonly<{
  contract: "sk90-executable-private-backup-preparation-bundle-v1";
  artifact: ApprovedResetArtifact;
  manifest: SanitizedResetManifest;
  targetPolicy: RehearsalTargetPolicy;
  databaseAttestation: PrivateDatabaseTargetAttestation;
  storageAttestations: Readonly<{
    audio: PrivateStorageTargetAttestation & Readonly<{ bucketRole: "audio" }>;
    docs: PrivateStorageTargetAttestation & Readonly<{ bucketRole: "docs" }>;
  }>;
}>;

type MigrationModule = Readonly<{
  createSk90AdapterApproval(binding: Sk90MigrationApprovalBinding): unknown;
  applyMigrationInTransaction(
    client: NeonPoolClientLike,
    filename: "0027_purchase_foundation.sql",
    content: string,
    approval: unknown,
    binding: Omit<Sk90MigrationApprovalBinding, "targetClass" | "filename" | "migrationDigest">,
  ): Promise<void>;
}>;

export type ExecutableCliRuntime = Readonly<{
  environment: Readonly<Record<string, string | undefined>>;
  readPrivateApproval(path: string): Promise<string>;
  readMigration(): Promise<string>;
  loadMigrationModule(): Promise<MigrationModule>;
  createPool(databaseUrl: string): NeonPoolLike & Readonly<{ end(): Promise<void> }>;
  createStorageClient(config: Sk90R2RehearsalConfig): Sk90S3Client & Readonly<{ destroy?(): void }>;
  now(): Date;
}>;

type ExecutablePoolResource = Readonly<{ end(): Promise<void> }>;
type ExecutableStorageResource = Readonly<{ destroy?(): void }>;

/** Tracks each client as soon as it is created and closes every one exactly once. */
export class ExecutableResourceScope {
  readonly #pools: ExecutablePoolResource[] = [];
  #storageClient: ExecutableStorageResource | undefined;
  #closeResult: Promise<boolean> | undefined;

  trackPool<T extends ExecutablePoolResource>(pool: T): T {
    if (this.#closeResult !== undefined) stop("UNEXPECTED_FAILURE");
    this.#pools.push(pool);
    return pool;
  }

  trackStorageClient<T extends ExecutableStorageResource>(storageClient: T): T {
    if (this.#closeResult !== undefined || this.#storageClient !== undefined) {
      stop("UNEXPECTED_FAILURE");
    }
    this.#storageClient = storageClient;
    return storageClient;
  }

  close(): Promise<boolean> {
    this.#closeResult ??= (async () => {
      const cleanupAttempts: Promise<unknown>[] = this.#pools.map((pool) =>
        Promise.resolve().then(() => pool.end()),
      );
      if (this.#storageClient !== undefined) {
        cleanupAttempts.push(Promise.resolve().then(() => this.#storageClient?.destroy?.()));
      }
      const results = await Promise.allSettled(cleanupAttempts);
      return results.every((result) => result.status === "fulfilled");
    })();
    return this.#closeResult;
  }
}

export async function constructWithExecutableResourceCleanup<T>(
  scope: ExecutableResourceScope,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    await scope.close();
    throw error;
  }
}

export async function runWithExecutableResourceCleanup<T>(
  scope: ExecutableResourceScope,
  operation: () => Promise<T>,
): Promise<T> {
  let result: T;
  try {
    result = await operation();
  } catch (error) {
    await scope.close();
    throw error;
  }
  if (!(await scope.close())) stop("UNEXPECTED_FAILURE");
  return result;
}

function exactObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseExecutablePrivateApprovalBundle(
  source: string,
): ExecutablePrivateApprovalBundle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch {
    stop("PRIVATE_ENVELOPE_MISMATCH");
  }
  if (
    !exactObject(parsed) ||
    parsed.contract !== "sk90-executable-private-approval-bundle-v1" ||
    !exactObject(parsed.artifact) ||
    !exactObject(parsed.manifest) ||
    !exactObject(parsed.privateEnvelope) ||
    !exactObject(parsed.executionApproval) ||
    !exactObject(parsed.targetPolicy) ||
    !exactObject(parsed.databaseAttestation) ||
    !exactObject(parsed.storageAttestations) ||
    !exactObject(parsed.storageAttestations.audio) ||
    !exactObject(parsed.storageAttestations.docs)
  ) {
    stop("PRIVATE_ENVELOPE_MISMATCH");
  }
  return parsed as ExecutablePrivateApprovalBundle;
}

export function parseExecutablePrivateBackupPreparationBundle(
  source: string,
): ExecutablePrivateBackupPreparationBundle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch {
    stop("PRIVATE_ENVELOPE_MISMATCH");
  }
  if (
    !exactObject(parsed) ||
    parsed.contract !== "sk90-executable-private-backup-preparation-bundle-v1" ||
    "executionApproval" in parsed ||
    !exactObject(parsed.artifact) ||
    !exactObject(parsed.manifest) ||
    !exactObject(parsed.targetPolicy) ||
    !exactObject(parsed.databaseAttestation) ||
    !exactObject(parsed.storageAttestations) ||
    !exactObject(parsed.storageAttestations.audio) ||
    !exactObject(parsed.storageAttestations.docs)
  ) {
    stop("PRIVATE_ENVELOPE_MISMATCH");
  }
  return parsed as ExecutablePrivateBackupPreparationBundle;
}

function storageConfig(
  environment: Pick<ExecutableRehearsalEnvironment, "storage" | "targetStorageNamespace">,
): Sk90R2RehearsalConfig {
  return {
    endpoint: environment.storage.endpoint,
    accessKeyId: environment.storage.accessKeyId,
    secretAccessKey: environment.storage.secretAccessKey,
    buckets: {
      audio: environment.storage.audioBucket,
      docs: environment.storage.docsBucket,
    },
    namespace: environment.targetStorageNamespace,
  };
}

function backupPreparationStorageConfig(
  environment: BackupPreparationEnvironment,
): Sk90R2RehearsalConfig {
  return storageConfig(environment);
}

function assertBundleAgainstEnvironment(
  bundle: ExecutablePrivateApprovalBundle,
  environment: ExecutableRehearsalEnvironment,
): void {
  assertManifestDigest(bundle.manifest);
  assertApprovedResetArtifact(bundle.artifact);
  assertPrivateExecutionEnvelope(bundle.privateEnvelope, environment.manifestHmacKey, {
    artifactDigest: bundle.artifact.digest,
    manifestDigest: bundle.manifest.digest,
    targetPolicyDigest: bundle.artifact.target.policyDigest,
  });
  const observedTarget = assertRehearsalTarget(
    bundle.targetPolicy,
    environment.approvalPolicyDigest,
  );
  if (
    !sameDigest(
      bundle.artifact.target.databaseFingerprint,
      environment.targetDatabaseFingerprint,
    ) ||
    !sameDigest(bundle.artifact.target.storageFingerprint, environment.targetStorageFingerprint) ||
    !sameDigest(bundle.artifact.target.policyDigest, environment.approvalPolicyDigest) ||
    !sameDigest(bundle.artifact.target.databaseFingerprint, observedTarget.databaseFingerprint) ||
    !sameDigest(bundle.artifact.target.storageFingerprint, observedTarget.storageFingerprint) ||
    !sameDigest(bundle.executionApproval.digest, environment.approvedExecutionDigest)
  ) {
    stop("EXECUTION_APPROVAL_MISMATCH");
  }
}

function approvedPolicy(
  bundle: Pick<
    ExecutablePrivateApprovalBundle,
    "artifact" | "targetPolicy"
  >,
): Parameters<typeof createActiveSk90TargetObserver>[0]["approvedPolicy"] {
  const databaseForbidden = bundle.targetPolicy.database.forbidden.map((digest) => {
    assertSha256Digest(digest);
    return digest;
  });
  const storageForbidden = bundle.targetPolicy.storage.forbidden.map((digest) => {
    assertSha256Digest(digest);
    return digest;
  });
  return {
    targetClass: "isolated_nonproduction",
    policyDigest: bundle.artifact.target.policyDigest,
    database: {
      approved: bundle.artifact.target.databaseFingerprint,
      forbidden: databaseForbidden,
    },
    storage: {
      approved: bundle.artifact.target.storageFingerprint,
      forbidden: storageForbidden,
    },
    isolation: bundle.targetPolicy.isolation,
  };
}

function assertPreparationBundleAgainstEnvironment(
  bundle: ExecutablePrivateBackupPreparationBundle,
  environment: BackupPreparationEnvironment,
): void {
  assertManifestDigest(bundle.manifest);
  assertApprovedResetArtifact(bundle.artifact);
  const observedTarget = assertRehearsalTarget(
    bundle.targetPolicy,
    environment.approvalPolicyDigest,
  );
  if (
    !sameDigest(bundle.artifact.manifestDigest, bundle.manifest.digest) ||
    !sameDigest(
      bundle.artifact.target.databaseFingerprint,
      environment.targetDatabaseFingerprint,
    ) ||
    !sameDigest(bundle.artifact.target.storageFingerprint, environment.targetStorageFingerprint) ||
    !sameDigest(bundle.artifact.target.policyDigest, environment.approvalPolicyDigest) ||
    !sameDigest(bundle.artifact.target.databaseFingerprint, observedTarget.databaseFingerprint) ||
    !sameDigest(bundle.artifact.target.storageFingerprint, observedTarget.storageFingerprint)
  ) {
    stop("TARGET_POLICY_MISMATCH");
  }
}

function migrationPort(content: string, module: MigrationModule): Sk90MigrationTransactionPort {
  const digest = sha256Digest(content);
  return {
    filename: "0027_purchase_foundation.sql",
    content,
    digest,
    createApproval: (binding) => module.createSk90AdapterApproval(binding),
    applyMigrationInTransaction: (client, filename, source, approval, binding) =>
      module.applyMigrationInTransaction(client, filename, source, approval, binding),
  };
}

/**
 * Read-only preapproval stage. It actively observes the dedicated target,
 * exports one locked baseline snapshot, and reports only approval-safe digests.
 */
export async function prepareExecutableSk90DatabaseBackup(
  runtime: ExecutableCliRuntime,
): Promise<SafeBackupPreparationResult> {
  const environment = readExecutableRehearsalEnvironment(
    runtime.environment,
    BACKUP_PREPARATION_MODE,
  );
  const bundle = parseExecutablePrivateBackupPreparationBundle(
    await runtime.readPrivateApproval(environment.privateApprovalFile),
  );
  assertPreparationBundleAgainstEnvironment(bundle, environment);
  const config = backupPreparationStorageConfig(environment);
  const targetObserverConfiguration = {
    hmacKey: environment.manifestHmacKey,
    storageConfig: config,
    databaseAttestation: bundle.databaseAttestation,
    storageAttestations: bundle.storageAttestations,
    approvedPolicy: approvedPolicy(bundle),
  };
  assertActiveTargetObserverConfiguration(targetObserverConfiguration);

  const resources = new ExecutableResourceScope();
  return runWithExecutableResourceCleanup(resources, async () => {
    const transactionPool = resources.trackPool(
      runtime.createPool(environment.targetDatabaseUrl),
    );
    const concurrentProbePool = resources.trackPool(
      runtime.createPool(environment.targetDatabaseUrl),
    );
    const storageClient = resources.trackStorageClient(runtime.createStorageClient(config));
    const observer = createActiveSk90TargetObserver({
      ...targetObserverConfiguration,
      databasePool: transactionPool,
      storageClient,
    });
    const issued = runtime.now();
    const issuedMilliseconds = issued.getTime();
    if (!Number.isFinite(issuedMilliseconds)) stop("FRESHNESS_PROOF_INVALID");
    const issuedAt = issued.toISOString();
    const expiresAt = new Date(issuedMilliseconds + 60_000).toISOString();
    const challengeToken = await observer.freshChallenge("prepare");
    const observation = await observer.observe({
      action: "prepare",
      challengeToken,
      issuedAt,
      expiresAt,
    });
    const observedDigest = assertExactBackupPreparationObservation(observation, {
      challengeToken,
      issuedAt,
      expiresAt,
      approvedTarget: bundle.artifact.target,
    });
    const freshAuthorization = authorizeFreshTargetAction({
      action: "prepare",
      artifactDigest: bundle.artifact.digest,
      approvedTarget: bundle.artifact.target,
      freshPolicy: observation.policy,
      challengeToken,
      issuedAt,
      expiresAt,
    });
    const database = new Sk90DatabaseRehearsalAdapter(
      transactionPool,
      concurrentProbePool,
      runtime.now,
    );
    const baselineInput = {
      artifact: bundle.artifact,
      hmacKey: environment.manifestHmacKey,
      approvedStorageReferences: bundle.manifest.storageReferences,
    };
    const recovery = createDatabaseRecovery({
      artifactDigest: bundle.artifact.digest,
      manifestDigest: bundle.manifest.digest,
      policyDigest: bundle.artifact.target.policyDigest,
      targetDatabaseFingerprint: bundle.artifact.target.databaseFingerprint,
      targetObservationDigest: observedDigest,
      baselineDatabaseFingerprint: sha256Digest(canonicalJson(bundle.artifact.reviewedBaseline)),
      targetDatabaseUrl: environment.targetDatabaseUrl,
      privateStateDirectory: environment.privateStateDirectory,
      privateApprovalLedgerDirectory: environment.privateApprovalLedgerDirectory,
      pgDumpBinary: environment.pgDumpBinary,
      pgRestoreBinary: environment.pgRestoreBinary,
      hmacKey: environment.manifestHmacKey,
      now: runtime.now,
      verifyRestoredBaseline: () => database.verifyRestoredBaseline(baselineInput),
      withVerifiedBaselineSnapshot: (useSnapshot) =>
        database.withVerifiedBaselineSnapshot({ ...baselineInput, useSnapshot }),
    });
    const prepared = await recovery.prepareBackup({
      freshAuthorization,
      actionChallengeToken: challengeToken,
      targetObservationBindingDigest: observation.bindingDigest,
      currentTime: runtime.now().toISOString(),
    });
    return {
      artifactDigest: bundle.artifact.digest,
      targetObservationDigest: observedDigest,
      preparedBackupReceiptDigest: prepared.receipt.receiptDigest,
      databaseRestorePointFingerprint: prepared.receipt.backupFingerprint,
    };
  });
}

/** Build the real runner only after mode, environment, owner-only bundle, and migration gates pass. */
export async function createExecutableSk90Runner(
  mode: RunnerMode,
  runtime: ExecutableCliRuntime,
): Promise<Pick<Sk90RehearsalRunner, "run">> {
  const environment = readExecutableRehearsalEnvironment(runtime.environment, mode);
  const bundle = parseExecutablePrivateApprovalBundle(
    await runtime.readPrivateApproval(environment.privateApprovalFile),
  );
  assertBundleAgainstEnvironment(bundle, environment);
  const migration = migrationPort(
    await runtime.readMigration(),
    await runtime.loadMigrationModule(),
  );
  const config = storageConfig(environment);
  const targetObserverConfiguration = {
    hmacKey: environment.manifestHmacKey,
    storageConfig: config,
    databaseAttestation: bundle.databaseAttestation,
    storageAttestations: bundle.storageAttestations,
    approvedPolicy: approvedPolicy(bundle),
  };
  assertActiveTargetObserverConfiguration(targetObserverConfiguration);
  const resources = new ExecutableResourceScope();
  const runner = await constructWithExecutableResourceCleanup(resources, async () => {
    const ports = await createAdapterBackedRehearsalPorts({
      artifact: bundle.artifact,
      manifest: bundle.manifest,
      privateEnvelope: bundle.privateEnvelope,
      executionApproval: bundle.executionApproval,
      approvedExecutionDigest: environment.approvedExecutionDigest,
      approvalFilePath: environment.privateApprovalFile,
      approvalLedgerDirectory: environment.privateApprovalLedgerDirectory,
      stateDirectory: environment.privateStateDirectory,
      hmacKey: environment.manifestHmacKey,
      migration,
      storageConfig: config,
      createDatabasePools: () => ({
        transactionPool: resources.trackPool(runtime.createPool(environment.targetDatabaseUrl)),
        concurrentProbePool: resources.trackPool(runtime.createPool(environment.targetDatabaseUrl)),
      }),
      createStorageClient: () => resources.trackStorageClient(runtime.createStorageClient(config)),
      createTargetObserver: ({ databasePool, storageClient: activeStorageClient }) =>
        createActiveSk90TargetObserver({
          ...targetObserverConfiguration,
          databasePool,
          storageClient: activeStorageClient,
        }),
      createDatabaseRecovery: ({ verifyRestoredBaseline }) =>
        createDatabaseRecovery({
          artifactDigest: bundle.artifact.digest,
          manifestDigest: bundle.manifest.digest,
          policyDigest: bundle.artifact.target.policyDigest,
          targetDatabaseFingerprint: bundle.artifact.target.databaseFingerprint,
          targetObservationDigest: targetObservationDigest(bundle.artifact.target),
          baselineDatabaseFingerprint: sha256Digest(
            canonicalJson(bundle.artifact.reviewedBaseline),
          ),
          targetDatabaseUrl: environment.targetDatabaseUrl,
          privateStateDirectory: environment.privateStateDirectory,
          privateApprovalLedgerDirectory: environment.privateApprovalLedgerDirectory,
          pgDumpBinary: environment.pgDumpBinary,
          pgRestoreBinary: environment.pgRestoreBinary,
          hmacKey: environment.manifestHmacKey,
          now: runtime.now,
          verifyRestoredBaseline,
        }),
      now: runtime.now,
    });
    return new Sk90RehearsalRunner({
      store: new FileDurableRunStateStore(
        join(environment.privateStateDirectory, "runner"),
        environment.manifestHmacKey,
        (state) => ports.recordState(state),
      ),
      ports,
      clock: { now: runtime.now },
    });
  });
  return {
    run: (requestedMode) =>
      runWithExecutableResourceCleanup(resources, () => runner.run(requestedMode)),
  };
}

async function defaultMigrationModule(): Promise<MigrationModule> {
  const url = new URL("../../../../../../packages/db/apply-migrations.mjs", import.meta.url);
  return (await import(url.href)) as unknown as MigrationModule;
}

export function defaultExecutableCliRuntime(): ExecutableCliRuntime {
  return {
    environment: process.env,
    readPrivateApproval: readOwnerOnlyUtf8,
    readMigration: () =>
      readFile(
        new URL(
          "../../../../../../packages/db/drizzle/0027_purchase_foundation.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    loadMigrationModule: defaultMigrationModule,
    createPool: (databaseUrl) => createNeonPool(databaseUrl),
    createStorageClient: createSk90R2RehearsalClient,
    now: () => new Date(),
  };
}

/** Accept exactly one explicit mode. Missing or extra arguments are fail-closed. */
export function parseRunnerMode(arguments_: readonly string[]): RunnerMode | null {
  if (arguments_.length !== 1) return null;
  const candidate = arguments_[0];
  return typeof candidate === "string" && RUNNER_MODES.has(candidate as RunnerMode)
    ? (candidate as RunnerMode)
    : null;
}

function parseCliMode(arguments_: readonly string[]): CliMode | null {
  if (arguments_.length === 1 && arguments_[0] === BACKUP_PREPARATION_MODE) {
    return BACKUP_PREPARATION_MODE;
  }
  return parseRunnerMode(arguments_);
}

/** A JSON-lines reporter that can receive only whitelisted, sanitized event shapes. */
export function createSafeJsonCliReporter(write: (line: string) => void): SafeCliReporter {
  return {
    emit(event) {
      write(JSON.stringify(event));
    },
  };
}

/**
 * The CLI does not read process.env, files, databases, or storage itself.
 * Runner construction happens only after one explicit recognized mode.
 */
export async function runSk90ResetCli(
  arguments_: readonly string[],
  dependencies: CliDependencies,
): Promise<number> {
  const mode = parseCliMode(arguments_);
  if (mode === null) {
    dependencies.reporter.emit({
      kind: "error",
      error: toSafeErrorReport(new Sk90ResetSafetyError("PHASE_STATE_INVALID")),
    });
    return 2;
  }

  try {
    if (mode === BACKUP_PREPARATION_MODE) {
      if (dependencies.prepareBackup === undefined) stop("EXTERNAL_ADAPTER_REQUIRED");
      const result = await dependencies.prepareBackup();
      dependencies.reporter.emit({ kind: "success", mode, result });
      return 0;
    }
    const runner = await dependencies.createRunner(mode);
    const result = await runner.run(mode);
    dependencies.reporter.emit({ kind: "success", mode, result });
    return 0;
  } catch (error) {
    dependencies.reporter.emit({ kind: "error", error: toSafeErrorReport(error) });
    return 1;
  }
}

/** Real executable entry. Only sanitized JSON events are written. */
export async function runDefaultSk90ResetCli(
  arguments_: readonly string[] = process.argv.slice(2),
): Promise<number> {
  const runtime = defaultExecutableCliRuntime();
  return runSk90ResetCli(arguments_, {
    createRunner: (mode) => createExecutableSk90Runner(mode, runtime),
    prepareBackup: () => prepareExecutableSk90DatabaseBackup(runtime),
    reporter: createSafeJsonCliReporter((line) => {
      process.stdout.write(`${line}\n`);
    }),
  });
}

const isMain =
  typeof process.argv[1] === "string" && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  runDefaultSk90ResetCli()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch(() => {
      process.stdout.write(
        `${JSON.stringify({ kind: "error", error: toSafeErrorReport(undefined) })}\n`,
      );
      process.exitCode = 1;
    });
}
