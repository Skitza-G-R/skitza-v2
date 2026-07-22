import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { S3Client } from "@aws-sdk/client-s3";
import { createNeonPool } from "@skitza/db";

import {
  defaultSk104DatabaseBackupRuntime,
  prepareSk104DatabaseBackup,
  restoreSk104DatabaseBackup,
  verifySk104DatabaseBackup,
} from "./backup";
import {
  SK104_APPROVED_MIGRATION_FILES,
  Sk104ProductionDatabaseAdapter,
  type Sk104ProductionMigrationBinding,
  type Sk104ProductionMigrationTransactionPort,
} from "./database";
import {
  readSk104CutoverEnvironment,
  type Sk104CutoverEnvironment,
  type Sk104CutoverMode,
} from "./environment";
import {
  defaultSk104RandomNonce,
  Sk104ProductionCutoverRunner,
  type Sk104DatabaseRuntime,
  type Sk104RunLeaseProof,
  type Sk104StorageRuntime,
} from "./runner";
import {
  createSk104ProductionStorageAdapter,
  type Sk104ProductionStorageAdapter,
  type Sk104ProductionStorageTarget,
  type Sk104StorageClient,
} from "./storage";
import { assertSha256Digest, sameDigest, type Sha256Digest } from "../sk90-reset/canonical";
import { stop } from "../sk90-reset/errors";
import type { NeonPoolClientLike, NeonPoolLike } from "../sk90-reset/database-adapter";

type ClosableNeonPool = NeonPoolLike & Readonly<{ end(): Promise<void> }>;
type ClosableStorageClient = Sk104StorageClient & Readonly<{ destroy?(): void }>;

export type Sk104MigrationModule = Readonly<{
  APPROVED_CUTOVER_BUNDLE_DIGEST: Sha256Digest;
  createSk104ProductionAdapterApproval(
    input: Sk104ProductionMigrationBinding &
      Readonly<{
        targetClass: "canonical_production";
        filename: "0027_purchase_foundation.sql";
        migrationDigest: string;
      }>,
  ): unknown;
  applyApprovedCutoverBundleInTransaction(
    client: NeonPoolClientLike,
    directory: string,
    approval: unknown,
    binding: Sk104ProductionMigrationBinding,
  ): Promise<unknown>;
}>;

export type Sk104ExecutableRuntime = Readonly<{
  environment: Readonly<Record<string, string | undefined>>;
  loadMigrationModule(): Promise<unknown>;
  readCutoverFloor(): Promise<string>;
  migrationDirectory: string;
  createPool(databaseUrl: string): ClosableNeonPool;
  createStorageClient(
    input: Readonly<{
      target: Sk104ProductionStorageTarget;
      accessKeyId: string;
      secretAccessKey: string;
    }>,
  ): ClosableStorageClient;
  now(): Date;
  randomNonce(): string;
}>;

function assertMigrationModule(value: unknown): Sk104MigrationModule {
  if (typeof value !== "object" || value === null) stop("MIGRATION_DIGEST_MISMATCH");
  const candidate = value as Record<string, unknown>;
  const bundleDigest = candidate.APPROVED_CUTOVER_BUNDLE_DIGEST;
  if (typeof bundleDigest !== "string") stop("MIGRATION_DIGEST_MISMATCH");
  assertSha256Digest(bundleDigest);
  if (
    typeof candidate.createSk104ProductionAdapterApproval !== "function" ||
    typeof candidate.applyApprovedCutoverBundleInTransaction !== "function"
  ) {
    stop("MIGRATION_DIGEST_MISMATCH");
  }
  return candidate as Sk104MigrationModule;
}

/** Bind only the repository's immutable 0027-0034 production migration path. */
export function createFixedSk104MigrationPort(
  input: Readonly<{
    module: unknown;
    migrationDirectory: string;
    cutoverFloorContent: string;
  }>,
): Sk104ProductionMigrationTransactionPort {
  const migrationModule = assertMigrationModule(input.module);
  if (
    !input.migrationDirectory ||
    input.migrationDirectory.includes("\0") ||
    !input.cutoverFloorContent
  ) {
    stop("MIGRATION_DIGEST_MISMATCH");
  }
  const cutoverFloorDigest = createHash("sha256")
    .update(input.cutoverFloorContent, "utf8")
    .digest("hex");
  return {
    filenames: SK104_APPROVED_MIGRATION_FILES,
    bundleDigest: migrationModule.APPROVED_CUTOVER_BUNDLE_DIGEST,
    async applyApprovedBundleInTransaction(client, binding): Promise<void> {
      if (
        !sameDigest(binding.migrationBundleDigest, migrationModule.APPROVED_CUTOVER_BUNDLE_DIGEST)
      ) {
        stop("MIGRATION_DIGEST_MISMATCH");
      }
      const approval = migrationModule.createSk104ProductionAdapterApproval({
        ...binding,
        targetClass: "canonical_production",
        filename: "0027_purchase_foundation.sql",
        migrationDigest: cutoverFloorDigest,
      });
      await migrationModule.applyApprovedCutoverBundleInTransaction(
        client,
        input.migrationDirectory,
        approval,
        binding,
      );
    },
  };
}

class LazySk104DatabaseRuntime implements Sk104DatabaseRuntime {
  readonly #environment: Sk104CutoverEnvironment;
  readonly #runtime: Sk104ExecutableRuntime;
  readonly #pools: ClosableNeonPool[] = [];
  #adapterPromise: Promise<Sk104ProductionDatabaseAdapter> | null = null;
  #closePromise: Promise<void> | null = null;

  constructor(environment: Sk104CutoverEnvironment, runtime: Sk104ExecutableRuntime) {
    this.#environment = environment;
    this.#runtime = runtime;
  }

  #adapter(): Promise<Sk104ProductionDatabaseAdapter> {
    if (this.#closePromise !== null) stop("UNEXPECTED_FAILURE");
    this.#adapterPromise ??= Promise.resolve().then(() => {
      const transactionPool = this.#runtime.createPool(this.#environment.targetDatabaseUrl);
      this.#pools.push(transactionPool);
      const concurrentProbePool = this.#runtime.createPool(this.#environment.targetDatabaseUrl);
      this.#pools.push(concurrentProbePool);
      const leasePool = this.#runtime.createPool(this.#environment.targetDatabaseUrl);
      this.#pools.push(leasePool);
      return new Sk104ProductionDatabaseAdapter(
        transactionPool,
        concurrentProbePool,
        leasePool,
        this.#runtime.now,
      );
    });
    return this.#adapterPromise;
  }

  async inspectAttestedBaseline(
    input: Parameters<Sk104ProductionDatabaseAdapter["inspectAttestedBaseline"]>[0],
  ) {
    return (await this.#adapter()).inspectAttestedBaseline(input);
  }

  async withExclusiveRunLease<Result>(
    input: Parameters<Sk104ProductionDatabaseAdapter["withExclusiveRunLease"]>[0],
    operation: (lease: Sk104RunLeaseProof) => Promise<Result>,
  ): Promise<Result> {
    return (await this.#adapter()).withExclusiveRunLease(input, operation);
  }

  async prepareBackup(input: Parameters<Sk104DatabaseRuntime["prepareBackup"]>[0]) {
    const database = await this.#adapter();
    return prepareSk104DatabaseBackup({
      manifest: input.manifest,
      targetDatabaseFingerprint: this.#environment.approvedDatabaseFingerprint,
      targetDatabaseUrl: this.#environment.targetDatabaseUrl,
      privateBackupDirectory: input.privateBackupDirectory,
      pgDumpBinary: this.#environment.pgDumpBinary,
      pgRestoreBinary: this.#environment.pgRestoreBinary,
      hmacKey: this.#environment.manifestHmacKey,
      preparedAt: input.preparedAt,
      snapshotPort: {
        withVerifiedExportedSnapshot: (useSnapshot) =>
          database.withVerifiedExportedSnapshot(
            {
              manifest: input.manifest,
              privateManifest: input.privateManifest,
              hmacKey: this.#environment.manifestHmacKey,
            },
            useSnapshot,
          ),
      },
      runtime: defaultSk104DatabaseBackupRuntime(),
    });
  }

  verifyBackup(input: Parameters<Sk104DatabaseRuntime["verifyBackup"]>[0]) {
    return verifySk104DatabaseBackup({
      manifest: input.manifest,
      privateBackupDirectory: input.privateBackupDirectory,
      hmacKey: this.#environment.manifestHmacKey,
    });
  }

  async observeState(input: Parameters<Sk104ProductionDatabaseAdapter["observeState"]>[0]) {
    return (await this.#adapter()).observeState(input);
  }

  async execute(input: Parameters<Sk104ProductionDatabaseAdapter["execute"]>[0]) {
    return (await this.#adapter()).execute(input);
  }

  async reconcileCommitted(
    input: Parameters<Sk104ProductionDatabaseAdapter["reconcileCommitted"]>[0],
  ) {
    return (await this.#adapter()).reconcileCommitted(input);
  }

  restoreBackup(input: Parameters<Sk104DatabaseRuntime["restoreBackup"]>[0]) {
    return restoreSk104DatabaseBackup({
      manifest: input.manifest,
      targetDatabaseFingerprint: this.#environment.approvedDatabaseFingerprint,
      targetDatabaseUrl: this.#environment.targetDatabaseUrl,
      privateBackupDirectory: input.privateBackupDirectory,
      pgRestoreBinary: this.#environment.pgRestoreBinary,
      psqlBinary: this.#environment.psqlBinary,
      hmacKey: this.#environment.manifestHmacKey,
      restoredAt: input.restoredAt,
      parentProofAdvisoryLockKey: input.parentProofAdvisoryLockKey,
      assertAuthorizationFresh: input.assertAuthorizationFresh,
      runtime: defaultSk104DatabaseBackupRuntime(),
    });
  }

  async verifyRestoredBaseline(
    input: Parameters<Sk104ProductionDatabaseAdapter["verifyRestoredBaseline"]>[0],
  ) {
    return (await this.#adapter()).verifyRestoredBaseline(input);
  }

  close(): Promise<void> {
    this.#closePromise ??= (async () => {
      const results = await Promise.allSettled(this.#pools.map((pool) => pool.end()));
      if (results.some((result) => result.status === "rejected")) {
        throw new Error("SK104_DATABASE_RESOURCE_CLOSE_FAILED");
      }
    })();
    return this.#closePromise;
  }
}

class LazySk104StorageRuntime implements Sk104StorageRuntime {
  readonly #environment: Sk104CutoverEnvironment;
  readonly #runtime: Sk104ExecutableRuntime;
  #adapterValue: Sk104ProductionStorageAdapter | null = null;
  #client: ClosableStorageClient | null = null;
  #closed = false;

  constructor(environment: Sk104CutoverEnvironment, runtime: Sk104ExecutableRuntime) {
    this.#environment = environment;
    this.#runtime = runtime;
  }

  #adapter(): Sk104ProductionStorageAdapter {
    if (this.#closed) stop("UNEXPECTED_FAILURE");
    this.#adapterValue ??= createSk104ProductionStorageAdapter({
      targetClass: "canonical_production",
      endpoint: this.#environment.storage.endpoint,
      buckets: {
        audio: this.#environment.storage.audioBucket,
        docs: this.#environment.storage.docsBucket,
      },
      recoveryPrefix: this.#environment.storage.recoveryPrefix,
      approvedTargetFingerprint: this.#environment.approvedStorageFingerprint,
      forbiddenTargetFingerprint: this.#environment.forbiddenStorageFingerprint,
      clientFactory: (target) => {
        if (this.#client !== null) stop("UNEXPECTED_FAILURE");
        this.#client = this.#runtime.createStorageClient({
          target,
          accessKeyId: this.#environment.storage.accessKeyId,
          secretAccessKey: this.#environment.storage.secretAccessKey,
        });
        return this.#client;
      },
    });
    return this.#adapterValue;
  }

  discoverExactApprovedStorage(
    input: Parameters<Sk104ProductionStorageAdapter["discoverExactApprovedStorage"]>[0],
  ) {
    return this.#adapter().discoverExactApprovedStorage(input);
  }

  buildPrivateStorageEnvelope(
    input: Parameters<Sk104ProductionStorageAdapter["buildPrivateStorageEnvelope"]>[0],
  ) {
    return this.#adapter().buildPrivateStorageEnvelope(input);
  }

  planResetObjectRecovery(
    input: Parameters<Sk104ProductionStorageAdapter["planResetObjectRecovery"]>[0],
  ) {
    return this.#adapter().planResetObjectRecovery(input);
  }

  prepareResetObjectRecovery(
    input: Parameters<Sk104ProductionStorageAdapter["prepareResetObjectRecovery"]>[0],
  ) {
    return this.#adapter().prepareResetObjectRecovery(input);
  }

  deletePreparedResetObjects(
    input: Parameters<Sk104ProductionStorageAdapter["deletePreparedResetObjects"]>[0],
  ) {
    return this.#adapter().deletePreparedResetObjects(input);
  }

  verifyResetSourcesAbsent(
    input: Parameters<Sk104ProductionStorageAdapter["verifyResetSourcesAbsent"]>[0],
  ) {
    return this.#adapter().verifyResetSourcesAbsent(input);
  }

  restoreResetObjectsFromRecovery(
    input: Parameters<Sk104ProductionStorageAdapter["restoreResetObjectsFromRecovery"]>[0],
  ) {
    return this.#adapter().restoreResetObjectsFromRecovery(input);
  }

  verifyResetSourcesRestored(
    input: Parameters<Sk104ProductionStorageAdapter["verifyResetSourcesRestored"]>[0],
  ) {
    return this.#adapter().verifyResetSourcesRestored(input);
  }

  close(): Promise<void> {
    if (this.#closed) return Promise.resolve();
    this.#closed = true;
    return Promise.resolve().then(() => this.#client?.destroy?.());
  }
}

/** Build real adapters only after the exact mode and dedicated environment pass. */
export async function createExecutableSk104ProductionCutoverRunner(
  mode: Sk104CutoverMode,
  runtime: Sk104ExecutableRuntime,
): Promise<Pick<Sk104ProductionCutoverRunner, "run">> {
  const environment = readSk104CutoverEnvironment(runtime.environment, mode);
  const migration = createFixedSk104MigrationPort({
    module: await runtime.loadMigrationModule(),
    migrationDirectory: runtime.migrationDirectory,
    cutoverFloorContent: await runtime.readCutoverFloor(),
  });
  const database = new LazySk104DatabaseRuntime(environment, runtime);
  const storage = new LazySk104StorageRuntime(environment, runtime);
  try {
    return new Sk104ProductionCutoverRunner({
      environment,
      database,
      storage,
      migration,
      now: runtime.now,
      randomNonce: runtime.randomNonce,
    });
  } catch (error) {
    await Promise.allSettled([database.close(), storage.close()]);
    throw error;
  }
}

async function loadDefaultMigrationModule(): Promise<unknown> {
  const url = new URL("../../../../../../packages/db/apply-migrations.mjs", import.meta.url);
  return import(url.href) as Promise<unknown>;
}

export function defaultSk104ExecutableRuntime(): Sk104ExecutableRuntime {
  const migrationDirectoryUrl = new URL("../../../../../../packages/db/drizzle/", import.meta.url);
  return {
    environment: process.env,
    loadMigrationModule: loadDefaultMigrationModule,
    readCutoverFloor: () =>
      readFile(new URL("0027_purchase_foundation.sql", migrationDirectoryUrl), "utf8"),
    migrationDirectory: fileURLToPath(migrationDirectoryUrl),
    createPool: (databaseUrl) => createNeonPool(databaseUrl),
    createStorageClient: ({ target, accessKeyId, secretAccessKey }) =>
      new S3Client({
        region: "auto",
        endpoint: target.endpoint,
        credentials: { accessKeyId, secretAccessKey },
        maxAttempts: 1,
      }),
    now: () => new Date(),
    randomNonce: defaultSk104RandomNonce,
  };
}
