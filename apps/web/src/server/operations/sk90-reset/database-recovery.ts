import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { chmod, link, lstat, open, readdir, realpath, unlink } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";

import {
  assertProtectedToken,
  assertSha256Digest,
  canonicalJson,
  protectValue,
  sameDigest,
  sha256Digest,
  type ProtectedToken,
  type Sha256Digest,
} from "./canonical";
import type {
  DatabaseRestorePreparedRecord,
  DatabaseVerificationReceipt,
  PrepareRestoreTargetInput,
} from "./database-adapter";
import { Sk90ResetSafetyError, stop } from "./errors";
import {
  bindExecutableResetApproval,
  type ExecutableResetApproval,
} from "./execution";
import { approvalLedgerDirectoryFingerprint } from "./approval-consumption";
import {
  ensureOwnerOnlyDirectory,
  publishOwnerOnlyUtf8Exclusive,
  readOwnerOnlyUtf8,
} from "./private-envelope";
import {
  assertFreshTargetAuthorization,
  type FreshTargetAuthorization,
  type TargetGatedResetAction,
} from "./policy";

const PRIVATE_FILE_MODE = 0o600;
const DEFAULT_PROCESS_TIMEOUT_MS = 15 * 60 * 1000;
const PREPARED_BACKUP_RECEIPT_CONTRACT =
  "sk90-database-prepared-backup-receipt-v1" as const;
const APPROVED_BACKUP_RECEIPT_CONTRACT =
  "sk90-database-approved-backup-receipt-v1" as const;
const PREPARATION_CONSUMPTION_CONTRACT =
  "sk90-database-backup-preparation-consumption-v1" as const;
const PREPARATION_COMPLETION_CONTRACT =
  "sk90-database-backup-preparation-completion-v1" as const;
const RESTORE_INTENT_CONTRACT = "sk90-database-restore-intent-v2" as const;
const RESTORE_PREPARED_CONTRACT = "sk90-database-restore-prepared-v1" as const;
const RESTORE_RECEIPT_CONTRACT = "sk90-database-restore-receipt-v2" as const;

export type RecoveryProcessInput = Readonly<{
  binary: string;
  arguments: readonly string[];
  environment: Readonly<Record<string, string>>;
  timeoutMs: number;
}>;

export interface RecoveryProcessPort {
  run(input: RecoveryProcessInput): Promise<Readonly<{ exitCode: 0 }>>;
}

export type DatabaseBackupPreparationAuthorization = Readonly<{
  freshAuthorization: FreshTargetAuthorization;
  actionChallengeToken: ProtectedToken;
  targetObservationBindingDigest: Sha256Digest;
  currentTime: string;
}>;

export type DatabaseRecoveryAuthorization = Readonly<{
    freshAuthorization: FreshTargetAuthorization;
    actionChallengeToken: ProtectedToken;
    currentTime: string;
    executionApproval: ExecutableResetApproval;
    approvedExecutionDigest: Sha256Digest;
  }>;

type DatabasePreparedBackupReceiptBody = Readonly<{
  contract: typeof PREPARED_BACKUP_RECEIPT_CONTRACT;
  artifactDigest: Sha256Digest;
  manifestDigest: Sha256Digest;
  policyDigest: Sha256Digest;
  targetDatabaseFingerprint: Sha256Digest;
  targetObservationDigest: Sha256Digest;
  baselineDatabaseFingerprint: Sha256Digest;
  baselineVerificationReceiptDigest: Sha256Digest;
  authorizationAction: "prepare";
  freshAuthorizationDigest: Sha256Digest;
  actionChallengeToken: ProtectedToken;
  targetObservationBindingDigest: Sha256Digest;
  preparationConsumptionReceiptDigest: Sha256Digest;
  preparationApprovalLedgerDirectoryFingerprint: Sha256Digest;
  backupFingerprint: Sha256Digest;
  backupSizeBytes: number;
  pgDumpBinaryFingerprint: Sha256Digest;
  pgRestoreBinaryFingerprint: Sha256Digest;
}>;

export type DatabasePreparedBackupReceipt = DatabasePreparedBackupReceiptBody &
  Readonly<{
    bindingToken: ProtectedToken;
    receiptDigest: Sha256Digest;
  }>;

export type DatabasePreparedBackupHandle = Readonly<{
  /** Private local path. Never include this handle in a CLI/public reporter. */
  backupPath: string;
  receipt: DatabasePreparedBackupReceipt;
}>;

type PreparationConsumptionBody = Readonly<{
  contract: typeof PREPARATION_CONSUMPTION_CONTRACT;
  action: "prepare";
  artifactDigest: Sha256Digest;
  manifestDigest: Sha256Digest;
  policyDigest: Sha256Digest;
  targetDatabaseFingerprint: Sha256Digest;
  targetObservationDigest: Sha256Digest;
  targetObservationBindingDigest: Sha256Digest;
  stateDirectoryFingerprint: Sha256Digest;
  approvalLedgerDirectoryFingerprint: Sha256Digest;
  freshAuthorizationDigest: Sha256Digest;
  actionChallengeToken: ProtectedToken;
  issuedAt: string;
  expiresAt: string;
  consumedAt: string;
}>;

type PreparationConsumptionReceipt = PreparationConsumptionBody &
  Readonly<{ bindingToken: ProtectedToken; receiptDigest: Sha256Digest }>;

type PreparationCompletionBody = Readonly<{
  contract: typeof PREPARATION_COMPLETION_CONTRACT;
  artifactDigest: Sha256Digest;
  stateDirectoryFingerprint: Sha256Digest;
  preparationConsumptionReceiptDigest: Sha256Digest;
  preparedBackupReceiptDigest: Sha256Digest;
  backupFingerprint: Sha256Digest;
  completedAt: string;
}>;

type PreparationCompletionReceipt = PreparationCompletionBody &
  Readonly<{ bindingToken: ProtectedToken; receiptDigest: Sha256Digest }>;

type DatabaseApprovedBackupReceiptBody = Readonly<{
  contract: typeof APPROVED_BACKUP_RECEIPT_CONTRACT;
  artifactDigest: Sha256Digest;
  manifestDigest: Sha256Digest;
  policyDigest: Sha256Digest;
  targetDatabaseFingerprint: Sha256Digest;
  targetObservationDigest: Sha256Digest;
  executionApprovalDigest: Sha256Digest;
  preparedBackupReceiptDigest: Sha256Digest;
  backupFingerprint: Sha256Digest;
  approvalChallengeToken: ProtectedToken;
  approvedAt: string;
  expiresAt: string;
  freshAuthorizationDigest: Sha256Digest;
  actionChallengeToken: ProtectedToken;
}>;

export type DatabaseBackupReceipt = DatabaseApprovedBackupReceiptBody &
  Readonly<{ bindingToken: ProtectedToken; receiptDigest: Sha256Digest }>;

export type DatabaseBackupHandle = Readonly<{
  /** Private local path. Never include this handle in a CLI/public reporter. */
  backupPath: string;
  preparedReceipt: DatabasePreparedBackupReceipt;
  receipt: DatabaseBackupReceipt;
}>;

export type DatabaseRestoreRollbackPoint =
  | "before_database_commit"
  | "after_database_commit_before_storage_delete"
  | "after_partial_storage_delete";

export type DatabaseRestoreExercise = Readonly<{
  rollbackPoint: DatabaseRestoreRollbackPoint;
  durableAction:
    | "manual_restore"
    | `rollback_restore:${DatabaseRestoreRollbackPoint}`;
  durableNonceConsumptionDigest: Sha256Digest;
}>;

export type DatabaseRestoreSelector = Readonly<{
  approvalDigest: Sha256Digest;
  expectedRestorePointFingerprint: Sha256Digest;
  expectedBaselineObservationDigest: Sha256Digest;
  rollbackPoint: DatabaseRestoreRollbackPoint;
  durableAction: DatabaseRestoreExercise["durableAction"];
}>;

type DatabaseRestoreIntentBody = Readonly<{
  contract: typeof RESTORE_INTENT_CONTRACT;
  artifactDigest: Sha256Digest;
  manifestDigest: Sha256Digest;
  policyDigest: Sha256Digest;
  targetDatabaseFingerprint: Sha256Digest;
  targetObservationDigest: Sha256Digest;
  executionApprovalDigest: Sha256Digest;
  freshAuthorizationDigest: Sha256Digest;
  actionChallengeToken: ProtectedToken;
  backupReceiptDigest: Sha256Digest;
  expectedRestorePointFingerprint: Sha256Digest;
  expectedBaselineObservationDigest: Sha256Digest;
  rollbackPoint: DatabaseRestoreRollbackPoint;
  durableAction: DatabaseRestoreExercise["durableAction"];
  durableNonceConsumptionDigest: Sha256Digest;
}>;

type DatabaseRestoreIntent = DatabaseRestoreIntentBody &
  Readonly<{ bindingToken: ProtectedToken; intentDigest: Sha256Digest }>;

type DatabaseRestorePreparedBody = Readonly<{
  contract: typeof RESTORE_PREPARED_CONTRACT;
  artifactDigest: Sha256Digest;
  manifestDigest: Sha256Digest;
  policyDigest: Sha256Digest;
  targetDatabaseFingerprint: Sha256Digest;
  targetObservationDigest: Sha256Digest;
  executionApprovalDigest: Sha256Digest;
  backupFingerprint: Sha256Digest;
  backupReceiptDigest: Sha256Digest;
  restoreIntentDigest: Sha256Digest;
  expectedRestorePointFingerprint: Sha256Digest;
  expectedBaselineObservationDigest: Sha256Digest;
  rollbackPoint: DatabaseRestoreRollbackPoint;
  durableAction: DatabaseRestoreExercise["durableAction"];
  durableNonceConsumptionDigest: Sha256Digest;
}>;

type DatabaseRestorePreparedMarker = DatabaseRestorePreparedBody &
  Readonly<{ bindingToken: ProtectedToken; markerDigest: Sha256Digest }>;

type DatabaseRestoreReceiptBody = Readonly<{
  contract: typeof RESTORE_RECEIPT_CONTRACT;
  artifactDigest: Sha256Digest;
  manifestDigest: Sha256Digest;
  policyDigest: Sha256Digest;
  targetDatabaseFingerprint: Sha256Digest;
  targetObservationDigest: Sha256Digest;
  executionApprovalDigest: Sha256Digest;
  backupFingerprint: Sha256Digest;
  restoreIntentDigest: Sha256Digest;
  rollbackPoint: DatabaseRestoreRollbackPoint;
  durableAction: DatabaseRestoreExercise["durableAction"];
  durableNonceConsumptionDigest: Sha256Digest;
  databaseStateFingerprint: Sha256Digest;
  verificationReceiptDigest: Sha256Digest;
  restoreDisposition: "executed" | "verified_without_replay";
  databaseMutationCount: 0;
  restored: true;
}>;

export type DatabaseRestoreReceipt = DatabaseRestoreReceiptBody &
  Readonly<{ bindingToken: ProtectedToken; receiptDigest: Sha256Digest }>;

export interface DatabaseRecoveryPort {
  prepareBackup(
    input: DatabaseBackupPreparationAuthorization,
  ): Promise<DatabasePreparedBackupHandle>;
  requireApprovedBackup(input: DatabaseRecoveryAuthorization): Promise<DatabaseBackupHandle>;
  revalidateApprovedBackup(
    input: Readonly<{
      executionApproval: ExecutableResetApproval;
      approvedExecutionDigest: Sha256Digest;
    }>,
  ): Promise<DatabaseBackupHandle>;
  restore(
    input: Readonly<{
      approvalDigest: Sha256Digest;
      freshAuthorization: FreshTargetAuthorization;
      actionChallengeToken: ProtectedToken;
      currentTime: string;
      expectedRestorePointFingerprint: Sha256Digest;
      expectedBaselineObservationDigest: Sha256Digest;
      exercise: DatabaseRestoreExercise;
      forceReplay: boolean;
      resumePrepared: boolean;
    }>,
  ): Promise<DatabaseRestoreReceipt>;
  requirePreparedRestore(input: DatabaseRestoreSelector): Promise<void>;
  requireExecutedRestore(
    input: DatabaseRestoreSelector,
  ): Promise<DatabaseRestoreReceipt>;
}

type PrivateLocations = Readonly<{
  backup: string;
  preparedBackupReceipt: string;
  preparationCompletionReceipt: string;
  directory: string;
  stateDirectoryFingerprint: Sha256Digest;
  approvalLedgerDirectory: string;
  approvalLedgerDirectoryFingerprint: Sha256Digest;
}>;

type ApprovedTools = Readonly<{
  dump: Readonly<{ path: string; digest: Sha256Digest }>;
  restore: Readonly<{ path: string; digest: Sha256Digest }>;
}>;

function errno(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

function assertOwner(stats: Stats): void {
  if (typeof process.getuid === "function" && stats.uid !== process.getuid()) {
    stop("DURABLE_STATE_INVALID");
  }
}

function assertPrivateRegularFile(stats: Stats, allowEmpty: boolean): void {
  if (
    stats.isSymbolicLink() ||
    !stats.isFile() ||
    (stats.mode & 0o777) !== PRIVATE_FILE_MODE ||
    (!allowEmpty && stats.size <= 0)
  ) {
    stop("DURABLE_STATE_INVALID");
  }
  assertOwner(stats);
}

function assertSafePositiveInteger(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) stop("RESTORE_PROOF_MISMATCH");
}

function assertRestoreSelector(
  exercise: Pick<DatabaseRestoreExercise, "rollbackPoint" | "durableAction">,
): void {
  const point: unknown = exercise.rollbackPoint;
  if (
    point !== "before_database_commit" &&
    point !== "after_database_commit_before_storage_delete" &&
    point !== "after_partial_storage_delete"
  ) {
    stop("RESTORE_PROOF_MISMATCH");
  }
  if (
    exercise.durableAction !== "manual_restore" &&
    exercise.durableAction !== `rollback_restore:${exercise.rollbackPoint}`
  ) {
    stop("RESTORE_PROOF_MISMATCH");
  }
}

function assertRestoreExercise(exercise: DatabaseRestoreExercise): void {
  assertRestoreSelector(exercise);
  assertSha256Digest(exercise.durableNonceConsumptionDigest);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (errno(error) === "ENOENT") return false;
    stop("DURABLE_STATE_INVALID");
  }
}

async function syncDirectory(directory: string): Promise<void> {
  let handle;
  try {
    handle = await open(directory, constants.O_RDONLY | constants.O_NOFOLLOW);
    await handle.sync();
  } catch {
    stop("DURABLE_STATE_INVALID");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function syncPrivateFile(path: string): Promise<void> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    assertPrivateRegularFile(await handle.stat(), false);
    await handle.sync();
  } catch {
    stop("DURABLE_STATE_INVALID");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function privateFileEvidence(
  path: string,
): Promise<Readonly<{ digest: Sha256Digest; sizeBytes: number }>> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stats = await handle.stat();
    assertPrivateRegularFile(stats, false);
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let position = 0;
    while (position < stats.size) {
      const result = await handle.read(buffer, 0, buffer.length, position);
      if (result.bytesRead <= 0) stop("DURABLE_STATE_INVALID");
      hash.update(buffer.subarray(0, result.bytesRead));
      position += result.bytesRead;
    }
    return { digest: `sha256:${hash.digest("hex")}`, sizeBytes: stats.size };
  } catch (error) {
    if (error instanceof Sk90ResetSafetyError) throw error;
    return stop("DURABLE_STATE_INVALID");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function binaryFingerprint(path: string): Promise<Sha256Digest> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size <= 0) stop("REHEARSAL_ENV_INVALID");
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let position = 0;
    while (position < stats.size) {
      const result = await handle.read(buffer, 0, buffer.length, position);
      if (result.bytesRead <= 0) stop("REHEARSAL_ENV_INVALID");
      hash.update(buffer.subarray(0, result.bytesRead));
      position += result.bytesRead;
    }
    return `sha256:${hash.digest("hex")}`;
  } catch (error) {
    if (error instanceof Sk90ResetSafetyError) throw error;
    return stop("REHEARSAL_ENV_INVALID");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function approvedBinary(
  path: string,
  expectedBasename: "pg_dump" | "pg_restore",
): Promise<Readonly<{ path: string; digest: Sha256Digest }>> {
  if (!isAbsolute(path) || basename(path) !== expectedBasename || path.includes("\0")) {
    stop("REHEARSAL_ENV_INVALID");
  }
  let resolved: string;
  let stats: Stats;
  try {
    resolved = await realpath(path);
    stats = await lstat(resolved);
  } catch {
    stop("REHEARSAL_ENV_INVALID");
  }
  // System package managers commonly install root-owned PostgreSQL binaries.
  // They need not be operator-owned; exact absolute path, executable bit, and
  // content fingerprint are the safety boundary.
  if (!stats.isFile() || (stats.mode & 0o111) === 0) stop("REHEARSAL_ENV_INVALID");
  return { path: resolved, digest: await binaryFingerprint(resolved) };
}

function postgresChildEnvironment(databaseUrl: string): Readonly<Record<string, string>> {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    stop("REHEARSAL_ENV_INVALID");
  }
  if (
    (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") ||
    parsed.hostname.length === 0 ||
    parsed.username.length === 0 ||
    parsed.password.length === 0 ||
    parsed.pathname === "/" ||
    parsed.hash.length > 0 ||
    [...parsed.searchParams.keys()].some((name) => name !== "sslmode") ||
    parsed.searchParams.getAll("sslmode").length > 1
  ) {
    stop("REHEARSAL_ENV_INVALID");
  }
  try {
    const database = decodeURIComponent(parsed.pathname.slice(1));
    const username = decodeURIComponent(parsed.username);
    const password = decodeURIComponent(parsed.password);
    const sslMode = parsed.searchParams.get("sslmode");
    if (
      database.length === 0 ||
      database.includes("/") ||
      [database, username, password, parsed.hostname, parsed.port, sslMode ?? ""].some((value) =>
        /[\0\r\n]/.test(value),
      ) ||
      (sslMode !== null &&
        !["disable", "allow", "prefer", "require", "verify-ca", "verify-full"].includes(sslMode))
    ) {
      stop("REHEARSAL_ENV_INVALID");
    }
    return Object.freeze({
      PGHOST: parsed.hostname,
      ...(parsed.port.length > 0 ? { PGPORT: parsed.port } : {}),
      PGDATABASE: database,
      PGUSER: username,
      PGPASSWORD: password,
      ...(sslMode === null ? {} : { PGSSLMODE: sslMode }),
      LC_ALL: "C",
      LANG: "C",
    });
  } catch (error) {
    if (error instanceof Sk90ResetSafetyError) throw error;
    stop("REHEARSAL_ENV_INVALID");
  }
}

const ARCHIVE_CHILD_ENVIRONMENT = Object.freeze({ LC_ALL: "C", LANG: "C" });

function assertAuthorization(
  authorization: Readonly<{
    freshAuthorization: FreshTargetAuthorization;
    actionChallengeToken: ProtectedToken;
    currentTime: string;
  }>,
  expected: Readonly<{
    action: TargetGatedResetAction;
    artifactDigest: Sha256Digest;
    targetObservationDigest: Sha256Digest;
  }>,
): void {
  assertFreshTargetAuthorization(authorization.freshAuthorization, {
    action: expected.action,
    artifactDigest: expected.artifactDigest,
    challengeToken: authorization.actionChallengeToken,
    targetObservationDigest: expected.targetObservationDigest,
    currentTime: authorization.currentTime,
  });
}

function exactIsoTimestamp(value: string): number {
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString() !== value) {
    stop("FRESHNESS_PROOF_INVALID");
  }
  return epoch;
}

function bindPreparedBackupReceipt(
  body: DatabasePreparedBackupReceiptBody,
  hmacKey: string,
): DatabasePreparedBackupReceipt {
  const canonical = canonicalJson(body);
  return {
    ...body,
    bindingToken: protectValue(hmacKey, `sk90-database-prepared-backup\0${canonical}`),
    receiptDigest: sha256Digest(canonical),
  };
}

function bindApprovedBackupReceipt(
  body: DatabaseApprovedBackupReceiptBody,
  hmacKey: string,
): DatabaseBackupReceipt {
  const canonical = canonicalJson(body);
  return {
    ...body,
    bindingToken: protectValue(hmacKey, `sk90-database-approved-backup\0${canonical}`),
    receiptDigest: sha256Digest(canonical),
  };
}

function bindRestoreIntent(body: DatabaseRestoreIntentBody, hmacKey: string): DatabaseRestoreIntent {
  const canonical = canonicalJson(body);
  return {
    ...body,
    bindingToken: protectValue(hmacKey, `sk90-database-restore-intent\0${canonical}`),
    intentDigest: sha256Digest(canonical),
  };
}

function bindRestorePreparedMarker(
  body: DatabaseRestorePreparedBody,
  hmacKey: string,
): DatabaseRestorePreparedMarker {
  const canonical = canonicalJson(body);
  return {
    ...body,
    bindingToken: protectValue(hmacKey, `sk90-database-restore-prepared\0${canonical}`),
    markerDigest: sha256Digest(canonical),
  };
}

function bindRestoreReceipt(
  body: DatabaseRestoreReceiptBody,
  hmacKey: string,
): DatabaseRestoreReceipt {
  const canonical = canonicalJson(body);
  return {
    ...body,
    bindingToken: protectValue(hmacKey, `sk90-database-restore-receipt\0${canonical}`),
    receiptDigest: sha256Digest(canonical),
  };
}

async function readPrivateJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readOwnerOnlyUtf8(path)) as unknown;
  } catch (error) {
    if (error instanceof Sk90ResetSafetyError) throw error;
    stop("DURABLE_STATE_INVALID");
  }
}

function requireRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    stop("RESTORE_PROOF_MISMATCH");
  }
  return value as Readonly<Record<string, unknown>>;
}

export function createNodeRecoveryProcessPort(): RecoveryProcessPort {
  return {
    run(input) {
      if (
        !isAbsolute(input.binary) ||
        !Number.isSafeInteger(input.timeoutMs) ||
        input.timeoutMs <= 0 ||
        input.arguments.some((argument) => /postgres(?:ql)?:\/\//i.test(argument)) ||
        Object.keys(input.environment).some(
          (name) =>
            name !== "PGHOST" &&
            name !== "PGPORT" &&
            name !== "PGDATABASE" &&
            name !== "PGUSER" &&
            name !== "PGPASSWORD" &&
            name !== "PGSSLMODE" &&
            name !== "LC_ALL" &&
            name !== "LANG",
        )
      ) {
        return Promise.reject(new Error("invalid recovery process boundary"));
      }
      return new Promise((resolvePromise, rejectPromise) => {
        const options: SpawnOptions = {
          env: { ...input.environment } as NodeJS.ProcessEnv,
          shell: false,
          stdio: "ignore",
          timeout: input.timeoutMs,
          killSignal: "SIGTERM",
          windowsHide: true,
        };
        const child: ChildProcess = spawn(input.binary, [...input.arguments], options);
        child.once("error", rejectPromise);
        child.once("close", (code, signal) => {
          if (code === 0 && signal === null) resolvePromise({ exitCode: 0 });
          else rejectPromise(new Error("recovery process failed"));
        });
      });
    },
  };
}

export function createDatabaseRecovery(input: Readonly<{
  artifactDigest: Sha256Digest;
  manifestDigest: Sha256Digest;
  policyDigest: Sha256Digest;
  targetDatabaseFingerprint: Sha256Digest;
  targetObservationDigest: Sha256Digest;
  baselineDatabaseFingerprint: Sha256Digest;
  targetDatabaseUrl: string;
  privateStateDirectory: string;
  privateApprovalLedgerDirectory: string;
  pgDumpBinary: string;
  pgRestoreBinary: string;
  hmacKey: string;
  now(): Date;
  prepareRestoreTarget(input: PrepareRestoreTargetInput): Promise<void>;
  readRestorePreparedRecord(): Promise<DatabaseRestorePreparedRecord | null>;
  verifyRestoredBaseline(): Promise<DatabaseVerificationReceipt>;
  withVerifiedBaselineSnapshot?(
    useSnapshot: (snapshotId: string) => Promise<void>,
  ): Promise<DatabaseVerificationReceipt>;
  process?: RecoveryProcessPort;
  timeoutMs?: number;
}>): DatabaseRecoveryPort {
  for (const digest of [
    input.artifactDigest,
    input.manifestDigest,
    input.policyDigest,
    input.targetDatabaseFingerprint,
    input.targetObservationDigest,
    input.baselineDatabaseFingerprint,
  ]) {
    assertSha256Digest(digest);
  }
  if (input.hmacKey.length < 32) stop("REHEARSAL_ENV_INVALID");
  const childEnvironment = postgresChildEnvironment(input.targetDatabaseUrl);
  const processPort = input.process ?? createNodeRecoveryProcessPort();
  const timeoutMs = input.timeoutMs ?? DEFAULT_PROCESS_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) stop("REHEARSAL_ENV_INVALID");
  const digestSuffix = input.artifactDigest.slice("sha256:".length);

  function stateDirectoryFingerprint(directory: string): Sha256Digest {
    return sha256Digest(
      canonicalJson({
        contract: "sk90-database-recovery-state-directory-v1",
        path: directory,
      }),
    );
  }

  function bindPreparationConsumption(
    body: PreparationConsumptionBody,
  ): PreparationConsumptionReceipt {
    const canonical = canonicalJson(body);
    return {
      ...body,
      bindingToken: protectValue(
        input.hmacKey,
        `sk90-database-backup-preparation-consumption\0${canonical}`,
      ),
      receiptDigest: sha256Digest(canonical),
    };
  }

  function assertPreparationConsumption(
    value: unknown,
    expected: PreparationConsumptionBody,
  ): PreparationConsumptionReceipt {
    const candidate = requireRecord(value) as Partial<PreparationConsumptionReceipt>;
    if (
      candidate.contract !== PREPARATION_CONSUMPTION_CONTRACT ||
      candidate.action !== "prepare" ||
      typeof candidate.artifactDigest !== "string" ||
      typeof candidate.manifestDigest !== "string" ||
      typeof candidate.policyDigest !== "string" ||
      typeof candidate.targetDatabaseFingerprint !== "string" ||
      typeof candidate.targetObservationDigest !== "string" ||
      typeof candidate.targetObservationBindingDigest !== "string" ||
      typeof candidate.stateDirectoryFingerprint !== "string" ||
      typeof candidate.approvalLedgerDirectoryFingerprint !== "string" ||
      typeof candidate.freshAuthorizationDigest !== "string" ||
      typeof candidate.actionChallengeToken !== "string" ||
      typeof candidate.issuedAt !== "string" ||
      typeof candidate.expiresAt !== "string" ||
      typeof candidate.consumedAt !== "string" ||
      typeof candidate.bindingToken !== "string" ||
      typeof candidate.receiptDigest !== "string"
    ) {
      stop("RESTORE_PROOF_MISMATCH");
    }
    const body: PreparationConsumptionBody = {
      contract: PREPARATION_CONSUMPTION_CONTRACT,
      action: "prepare",
      artifactDigest: candidate.artifactDigest,
      manifestDigest: candidate.manifestDigest,
      policyDigest: candidate.policyDigest,
      targetDatabaseFingerprint: candidate.targetDatabaseFingerprint,
      targetObservationDigest: candidate.targetObservationDigest,
      targetObservationBindingDigest: candidate.targetObservationBindingDigest,
      stateDirectoryFingerprint: candidate.stateDirectoryFingerprint,
      approvalLedgerDirectoryFingerprint: candidate.approvalLedgerDirectoryFingerprint,
      freshAuthorizationDigest: candidate.freshAuthorizationDigest,
      actionChallengeToken: candidate.actionChallengeToken,
      issuedAt: candidate.issuedAt,
      expiresAt: candidate.expiresAt,
      consumedAt: candidate.consumedAt,
    };
    for (const digest of [
      body.artifactDigest,
      body.manifestDigest,
      body.policyDigest,
      body.targetDatabaseFingerprint,
      body.targetObservationDigest,
      body.targetObservationBindingDigest,
      body.stateDirectoryFingerprint,
      body.approvalLedgerDirectoryFingerprint,
      body.freshAuthorizationDigest,
      candidate.receiptDigest,
    ]) {
      assertSha256Digest(digest);
    }
    assertProtectedToken(body.actionChallengeToken);
    assertProtectedToken(candidate.bindingToken);
    exactIsoTimestamp(body.issuedAt);
    exactIsoTimestamp(body.expiresAt);
    exactIsoTimestamp(body.consumedAt);
    const rebound = bindPreparationConsumption(body);
    if (
      !sameDigest(candidate.bindingToken, rebound.bindingToken) ||
      !sameDigest(candidate.receiptDigest, rebound.receiptDigest)
    ) {
      stop("RESTORE_PROOF_MISMATCH");
    }
    if (canonicalJson(body) !== canonicalJson({ ...expected, consumedAt: body.consumedAt })) {
      stop("FRESHNESS_NONCE_REUSED");
    }
    return rebound;
  }

  function bindPreparationCompletion(
    body: PreparationCompletionBody,
  ): PreparationCompletionReceipt {
    const canonical = canonicalJson(body);
    return {
      ...body,
      bindingToken: protectValue(
        input.hmacKey,
        `sk90-database-backup-preparation-completion\0${canonical}`,
      ),
      receiptDigest: sha256Digest(canonical),
    };
  }

  function assertPreparationCompletion(
    value: unknown,
    expected: Omit<PreparationCompletionBody, "completedAt">,
  ): PreparationCompletionReceipt {
    const candidate = requireRecord(value) as Partial<PreparationCompletionReceipt>;
    if (
      candidate.contract !== PREPARATION_COMPLETION_CONTRACT ||
      typeof candidate.artifactDigest !== "string" ||
      typeof candidate.stateDirectoryFingerprint !== "string" ||
      typeof candidate.preparationConsumptionReceiptDigest !== "string" ||
      typeof candidate.preparedBackupReceiptDigest !== "string" ||
      typeof candidate.backupFingerprint !== "string" ||
      typeof candidate.completedAt !== "string" ||
      typeof candidate.bindingToken !== "string" ||
      typeof candidate.receiptDigest !== "string"
    ) {
      stop("RESTORE_PROOF_MISMATCH");
    }
    const body: PreparationCompletionBody = {
      contract: PREPARATION_COMPLETION_CONTRACT,
      artifactDigest: candidate.artifactDigest,
      stateDirectoryFingerprint: candidate.stateDirectoryFingerprint,
      preparationConsumptionReceiptDigest: candidate.preparationConsumptionReceiptDigest,
      preparedBackupReceiptDigest: candidate.preparedBackupReceiptDigest,
      backupFingerprint: candidate.backupFingerprint,
      completedAt: candidate.completedAt,
    };
    for (const digest of [
      body.artifactDigest,
      body.stateDirectoryFingerprint,
      body.preparationConsumptionReceiptDigest,
      body.preparedBackupReceiptDigest,
      body.backupFingerprint,
      candidate.receiptDigest,
    ]) {
      assertSha256Digest(digest);
    }
    assertProtectedToken(candidate.bindingToken);
    exactIsoTimestamp(body.completedAt);
    const rebound = bindPreparationCompletion(body);
    if (
      !sameDigest(candidate.bindingToken, rebound.bindingToken) ||
      !sameDigest(candidate.receiptDigest, rebound.receiptDigest)
    ) {
      stop("RESTORE_PROOF_MISMATCH");
    }
    if (
      canonicalJson({
        contract: body.contract,
        artifactDigest: body.artifactDigest,
        stateDirectoryFingerprint: body.stateDirectoryFingerprint,
        preparationConsumptionReceiptDigest: body.preparationConsumptionReceiptDigest,
        preparedBackupReceiptDigest: body.preparedBackupReceiptDigest,
        backupFingerprint: body.backupFingerprint,
      }) !== canonicalJson(expected)
    ) {
      stop("FRESHNESS_NONCE_REUSED");
    }
    return rebound;
  }

  async function locations(): Promise<PrivateLocations> {
    const directory = await realpath(
      await ensureOwnerOnlyDirectory(input.privateStateDirectory, true),
    );
    const approvalLedgerDirectory = await realpath(
      await ensureOwnerOnlyDirectory(input.privateApprovalLedgerDirectory, true),
    );
    return {
      directory,
      backup: join(directory, `database-${digestSuffix}.dump`),
      preparedBackupReceipt: join(directory, `database-${digestSuffix}.backup-prepared.json`),
      preparationCompletionReceipt: join(
        directory,
        `database-${digestSuffix}.backup-prepare-complete.json`,
      ),
      stateDirectoryFingerprint: stateDirectoryFingerprint(directory),
      approvalLedgerDirectory,
      approvalLedgerDirectoryFingerprint:
        approvalLedgerDirectoryFingerprint(approvalLedgerDirectory),
    };
  }

  function preparationConsumptionBody(
    place: PrivateLocations,
    authorization: DatabaseBackupPreparationAuthorization,
    consumedAt: string,
  ): PreparationConsumptionBody {
    assertSha256Digest(authorization.targetObservationBindingDigest);
    return {
      contract: PREPARATION_CONSUMPTION_CONTRACT,
      action: "prepare",
      artifactDigest: input.artifactDigest,
      manifestDigest: input.manifestDigest,
      policyDigest: input.policyDigest,
      targetDatabaseFingerprint: input.targetDatabaseFingerprint,
      targetObservationDigest: input.targetObservationDigest,
      targetObservationBindingDigest: authorization.targetObservationBindingDigest,
      stateDirectoryFingerprint: place.stateDirectoryFingerprint,
      approvalLedgerDirectoryFingerprint: place.approvalLedgerDirectoryFingerprint,
      freshAuthorizationDigest: authorization.freshAuthorization.authorizationDigest,
      actionChallengeToken: authorization.actionChallengeToken,
      issuedAt: authorization.freshAuthorization.issuedAt,
      expiresAt: authorization.freshAuthorization.expiresAt,
      consumedAt,
    };
  }

  async function consumePreparationAuthorization(
    place: PrivateLocations,
    authorization: DatabaseBackupPreparationAuthorization,
  ): Promise<PreparationConsumptionReceipt> {
    const expected = preparationConsumptionBody(
      place,
      authorization,
      assertPreparationFreshAtBoundary(authorization),
    );
    const receiptPath = join(
      place.approvalLedgerDirectory,
      `sk90-backup-prepare-${digestSuffix}-${authorization.freshAuthorization.authorizationDigest.slice("sha256:".length)}.consumed.json`,
    );
    if (await pathExists(receiptPath)) {
      assertPreparationConsumption(await readPrivateJson(receiptPath), expected);
      stop("FRESHNESS_NONCE_REUSED");
    }
    const receipt = bindPreparationConsumption(expected);
    try {
      await publishOwnerOnlyUtf8Exclusive(receiptPath, canonicalJson(receipt));
      return receipt;
    } catch (error) {
      if (!(await pathExists(receiptPath))) throw error;
      assertPreparationConsumption(await readPrivateJson(receiptPath), expected);
      stop("FRESHNESS_NONCE_REUSED");
    }
  }

  async function requirePreparedConsumption(
    place: PrivateLocations,
    prepared: DatabasePreparedBackupReceipt,
  ): Promise<PreparationConsumptionReceipt> {
    const receiptPath = join(
      place.approvalLedgerDirectory,
      `sk90-backup-prepare-${digestSuffix}-${prepared.freshAuthorizationDigest.slice("sha256:".length)}.consumed.json`,
    );
    if (!(await pathExists(receiptPath))) stop("RESTORE_PROOF_MISMATCH");
    const stored = requireRecord(await readPrivateJson(receiptPath));
    const targetObservationBindingDigest = stored.targetObservationBindingDigest;
    const actionChallengeToken = stored.actionChallengeToken;
    const issuedAt = stored.issuedAt;
    const expiresAt = stored.expiresAt;
    const consumedAt = stored.consumedAt;
    if (
      typeof targetObservationBindingDigest !== "string" ||
      typeof actionChallengeToken !== "string" ||
      typeof issuedAt !== "string" ||
      typeof expiresAt !== "string" ||
      typeof consumedAt !== "string"
    ) {
      stop("RESTORE_PROOF_MISMATCH");
    }
    const consumption = assertPreparationConsumption(stored, {
      contract: PREPARATION_CONSUMPTION_CONTRACT,
      action: "prepare",
      artifactDigest: input.artifactDigest,
      manifestDigest: input.manifestDigest,
      policyDigest: input.policyDigest,
      targetDatabaseFingerprint: input.targetDatabaseFingerprint,
      targetObservationDigest: input.targetObservationDigest,
      targetObservationBindingDigest: targetObservationBindingDigest as Sha256Digest,
      stateDirectoryFingerprint: place.stateDirectoryFingerprint,
      approvalLedgerDirectoryFingerprint: place.approvalLedgerDirectoryFingerprint,
      freshAuthorizationDigest: prepared.freshAuthorizationDigest,
      actionChallengeToken: actionChallengeToken as ProtectedToken,
      issuedAt,
      expiresAt,
      consumedAt,
    });
    if (
      !sameDigest(consumption.receiptDigest, prepared.preparationConsumptionReceiptDigest) ||
      !sameDigest(
        consumption.targetObservationBindingDigest,
        prepared.targetObservationBindingDigest,
      ) ||
      !sameDigest(consumption.actionChallengeToken, prepared.actionChallengeToken)
    ) {
      stop("RESTORE_PROOF_MISMATCH");
    }
    return consumption;
  }

  function preparationCompletionExpectation(
    place: PrivateLocations,
    consumption: PreparationConsumptionReceipt,
    prepared: DatabasePreparedBackupHandle,
  ): Omit<PreparationCompletionBody, "completedAt"> {
    return {
      contract: PREPARATION_COMPLETION_CONTRACT,
      artifactDigest: input.artifactDigest,
      stateDirectoryFingerprint: place.stateDirectoryFingerprint,
      preparationConsumptionReceiptDigest: consumption.receiptDigest,
      preparedBackupReceiptDigest: prepared.receipt.receiptDigest,
      backupFingerprint: prepared.receipt.backupFingerprint,
    };
  }

  async function existingPreparationCompletion(
    place: PrivateLocations,
    consumption: PreparationConsumptionReceipt,
    prepared: DatabasePreparedBackupHandle,
  ): Promise<PreparationCompletionReceipt | null> {
    if (!(await pathExists(place.preparationCompletionReceipt))) return null;
    return assertPreparationCompletion(
      await readPrivateJson(place.preparationCompletionReceipt),
      preparationCompletionExpectation(place, consumption, prepared),
    );
  }

  async function completePreparation(
    place: PrivateLocations,
    consumption: PreparationConsumptionReceipt,
    prepared: DatabasePreparedBackupHandle,
  ): Promise<void> {
    const now = input.now();
    if (!Number.isFinite(now.getTime())) stop("FRESHNESS_PROOF_INVALID");
    const receipt = bindPreparationCompletion({
      ...preparationCompletionExpectation(place, consumption, prepared),
      completedAt: now.toISOString(),
    });
    await publishOwnerOnlyUtf8Exclusive(
      place.preparationCompletionReceipt,
      canonicalJson(receipt),
    );
  }

  function assertPreparationFreshAtBoundary(
    authorization: DatabaseBackupPreparationAuthorization,
  ): string {
    const now = input.now();
    if (!Number.isFinite(now.getTime())) stop("FRESHNESS_PROOF_INVALID");
    const currentTime = now.toISOString();
    assertAuthorization(
      {
        freshAuthorization: authorization.freshAuthorization,
        actionChallengeToken: authorization.actionChallengeToken,
        currentTime,
      },
      {
        action: "prepare",
        artifactDigest: input.artifactDigest,
        targetObservationDigest: input.targetObservationDigest,
      },
    );
    return currentTime;
  }

  function preparingBackupPath(place: PrivateLocations): string {
    return join(place.directory, `.database-${digestSuffix}.preparing.dump`);
  }

  function approvedBackupReceiptPath(place: PrivateLocations, approvalDigest: Sha256Digest): string {
    assertSha256Digest(approvalDigest);
    return join(
      place.directory,
      `database-${digestSuffix}.backup-approved-${approvalDigest.slice("sha256:".length)}.json`,
    );
  }

  function restoreGenerationPaths(
    place: PrivateLocations,
    exercise: DatabaseRestoreExercise,
    approvalDigest: Sha256Digest,
  ): Readonly<{ intent: string; receipt: string; generationDigest: Sha256Digest }> {
    const generationDigest = sha256Digest(
      canonicalJson({
        contract: "sk90-database-restore-generation-v1",
        artifactDigest: input.artifactDigest,
        approvalDigest,
        rollbackPoint: exercise.rollbackPoint,
        durableAction: exercise.durableAction,
        durableNonceConsumptionDigest: exercise.durableNonceConsumptionDigest,
      }),
    );
    const suffix = generationDigest.slice("sha256:".length);
    return {
      generationDigest,
      intent: join(place.directory, `database-${digestSuffix}.restore-${suffix}.intent.json`),
      receipt: join(place.directory, `database-${digestSuffix}.restore-${suffix}.receipt.json`),
    };
  }

  async function currentTools(): Promise<ApprovedTools> {
    const [dump, restore] = await Promise.all([
      approvedBinary(input.pgDumpBinary, "pg_dump"),
      approvedBinary(input.pgRestoreBinary, "pg_restore"),
    ]);
    return { dump, restore };
  }

  async function validateArchive(path: string, tools: ApprovedTools): Promise<void> {
    try {
      await processPort.run({
        binary: tools.restore.path,
        arguments: ["--list", path],
        environment: ARCHIVE_CHILD_ENVIRONMENT,
        timeoutMs,
      });
    } catch {
      stop("RESTORE_POINT_NOT_READY");
    }
  }

  function preparedBackupBody(
    authorization: DatabaseBackupPreparationAuthorization,
    consumption: PreparationConsumptionReceipt,
    place: PrivateLocations,
    evidence: Readonly<{ digest: Sha256Digest; sizeBytes: number }>,
    tools: ApprovedTools,
    baselineVerification: DatabaseVerificationReceipt,
  ): DatabasePreparedBackupReceiptBody {
    return {
      contract: PREPARED_BACKUP_RECEIPT_CONTRACT,
      artifactDigest: input.artifactDigest,
      manifestDigest: input.manifestDigest,
      policyDigest: input.policyDigest,
      targetDatabaseFingerprint: input.targetDatabaseFingerprint,
      targetObservationDigest: input.targetObservationDigest,
      baselineDatabaseFingerprint: input.baselineDatabaseFingerprint,
      baselineVerificationReceiptDigest: sha256Digest(canonicalJson(baselineVerification)),
      authorizationAction: "prepare",
      freshAuthorizationDigest: authorization.freshAuthorization.authorizationDigest,
      actionChallengeToken: authorization.actionChallengeToken,
      targetObservationBindingDigest: authorization.targetObservationBindingDigest,
      preparationConsumptionReceiptDigest: consumption.receiptDigest,
      preparationApprovalLedgerDirectoryFingerprint:
        place.approvalLedgerDirectoryFingerprint,
      backupFingerprint: evidence.digest,
      backupSizeBytes: evidence.sizeBytes,
      pgDumpBinaryFingerprint: tools.dump.digest,
      pgRestoreBinaryFingerprint: tools.restore.digest,
    };
  }

  function assertPreparedBackupReceipt(
    value: unknown,
    expected: Readonly<{
      evidence: Readonly<{ digest: Sha256Digest; sizeBytes: number }>;
      tools: ApprovedTools;
      approvalLedgerDirectoryFingerprint: Sha256Digest;
    }>,
  ): DatabasePreparedBackupReceipt {
    const candidate = requireRecord(value) as Partial<DatabasePreparedBackupReceipt>;
    if (
      candidate.contract !== PREPARED_BACKUP_RECEIPT_CONTRACT ||
      typeof candidate.artifactDigest !== "string" ||
      typeof candidate.manifestDigest !== "string" ||
      typeof candidate.policyDigest !== "string" ||
      typeof candidate.targetDatabaseFingerprint !== "string" ||
      typeof candidate.targetObservationDigest !== "string" ||
      typeof candidate.baselineDatabaseFingerprint !== "string" ||
      typeof candidate.baselineVerificationReceiptDigest !== "string" ||
      candidate.authorizationAction !== "prepare" ||
      typeof candidate.freshAuthorizationDigest !== "string" ||
      typeof candidate.actionChallengeToken !== "string" ||
      typeof candidate.targetObservationBindingDigest !== "string" ||
      typeof candidate.preparationConsumptionReceiptDigest !== "string" ||
      typeof candidate.preparationApprovalLedgerDirectoryFingerprint !== "string" ||
      typeof candidate.backupFingerprint !== "string" ||
      typeof candidate.backupSizeBytes !== "number" ||
      typeof candidate.pgDumpBinaryFingerprint !== "string" ||
      typeof candidate.pgRestoreBinaryFingerprint !== "string" ||
      typeof candidate.bindingToken !== "string" ||
      typeof candidate.receiptDigest !== "string"
    ) {
      stop("RESTORE_PROOF_MISMATCH");
    }
    for (const digest of [
      candidate.artifactDigest,
      candidate.manifestDigest,
      candidate.policyDigest,
      candidate.targetDatabaseFingerprint,
      candidate.targetObservationDigest,
      candidate.baselineDatabaseFingerprint,
      candidate.baselineVerificationReceiptDigest,
      candidate.freshAuthorizationDigest,
      candidate.targetObservationBindingDigest,
      candidate.preparationConsumptionReceiptDigest,
      candidate.preparationApprovalLedgerDirectoryFingerprint,
      candidate.backupFingerprint,
      candidate.pgDumpBinaryFingerprint,
      candidate.pgRestoreBinaryFingerprint,
      candidate.receiptDigest,
    ]) {
      assertSha256Digest(digest);
    }
    assertProtectedToken(candidate.actionChallengeToken);
    assertProtectedToken(candidate.bindingToken);
    assertSafePositiveInteger(candidate.backupSizeBytes);
    const body: DatabasePreparedBackupReceiptBody = {
      contract: PREPARED_BACKUP_RECEIPT_CONTRACT,
      artifactDigest: candidate.artifactDigest,
      manifestDigest: candidate.manifestDigest,
      policyDigest: candidate.policyDigest,
      targetDatabaseFingerprint: candidate.targetDatabaseFingerprint,
      targetObservationDigest: candidate.targetObservationDigest,
      baselineDatabaseFingerprint: candidate.baselineDatabaseFingerprint,
      baselineVerificationReceiptDigest: candidate.baselineVerificationReceiptDigest,
      authorizationAction: "prepare",
      freshAuthorizationDigest: candidate.freshAuthorizationDigest,
      actionChallengeToken: candidate.actionChallengeToken,
      targetObservationBindingDigest: candidate.targetObservationBindingDigest,
      preparationConsumptionReceiptDigest: candidate.preparationConsumptionReceiptDigest,
      preparationApprovalLedgerDirectoryFingerprint:
        candidate.preparationApprovalLedgerDirectoryFingerprint,
      backupFingerprint: candidate.backupFingerprint,
      backupSizeBytes: candidate.backupSizeBytes,
      pgDumpBinaryFingerprint: candidate.pgDumpBinaryFingerprint,
      pgRestoreBinaryFingerprint: candidate.pgRestoreBinaryFingerprint,
    };
    const rebound = bindPreparedBackupReceipt(body, input.hmacKey);
    if (
      !sameDigest(candidate.bindingToken, rebound.bindingToken) ||
      !sameDigest(candidate.receiptDigest, rebound.receiptDigest) ||
      !sameDigest(candidate.artifactDigest, input.artifactDigest) ||
      !sameDigest(candidate.manifestDigest, input.manifestDigest) ||
      !sameDigest(candidate.policyDigest, input.policyDigest) ||
      !sameDigest(candidate.targetDatabaseFingerprint, input.targetDatabaseFingerprint) ||
      !sameDigest(candidate.targetObservationDigest, input.targetObservationDigest) ||
      !sameDigest(candidate.baselineDatabaseFingerprint, input.baselineDatabaseFingerprint) ||
      !sameDigest(
        candidate.preparationApprovalLedgerDirectoryFingerprint,
        expected.approvalLedgerDirectoryFingerprint,
      ) ||
      !sameDigest(candidate.backupFingerprint, expected.evidence.digest) ||
      candidate.backupSizeBytes !== expected.evidence.sizeBytes ||
      !sameDigest(candidate.pgDumpBinaryFingerprint, expected.tools.dump.digest) ||
      !sameDigest(candidate.pgRestoreBinaryFingerprint, expected.tools.restore.digest)
    ) {
      stop("RESTORE_PROOF_MISMATCH");
    }
    return rebound;
  }

  async function existingPreparedBackup(
    place: PrivateLocations,
    tools: ApprovedTools,
    beforeRepair?: () => void,
  ): Promise<DatabasePreparedBackupHandle | null> {
    const [hasBackup, hasReceipt] = await Promise.all([
      pathExists(place.backup),
      pathExists(place.preparedBackupReceipt),
    ]);
    if (!hasBackup && !hasReceipt) return null;
    if (!hasReceipt) stop("DURABLE_STATE_INVALID");

    const stored = requireRecord(await readPrivateJson(place.preparedBackupReceipt));
    const authorizationDigest = stored.freshAuthorizationDigest;
    if (typeof authorizationDigest !== "string") stop("RESTORE_PROOF_MISMATCH");
    assertSha256Digest(authorizationDigest);
    const sourcePath = hasBackup
      ? place.backup
      : preparingBackupPath(place);
    if (!(await pathExists(sourcePath))) stop("DURABLE_STATE_INVALID");
    const evidence = await privateFileEvidence(sourcePath);
    await validateArchive(sourcePath, tools);
    const receipt = assertPreparedBackupReceipt(stored, {
      evidence,
      tools,
      approvalLedgerDirectoryFingerprint: place.approvalLedgerDirectoryFingerprint,
    });
    await requirePreparedConsumption(place, receipt);
    const pendingTemporary = preparingBackupPath(place);
    if (hasBackup && (await pathExists(pendingTemporary))) {
      if (beforeRepair === undefined) stop("RESTORE_POINT_NOT_READY");
      const pendingEvidence = await privateFileEvidence(pendingTemporary);
      await validateArchive(pendingTemporary, tools);
      if (
        !sameDigest(pendingEvidence.digest, evidence.digest) ||
        pendingEvidence.sizeBytes !== evidence.sizeBytes
      ) {
        stop("RESTORE_PROOF_MISMATCH");
      }
      beforeRepair();
      await unlink(pendingTemporary);
      await syncDirectory(place.directory);
    }
    if (!hasBackup) {
      if (beforeRepair === undefined) stop("RESTORE_POINT_NOT_READY");
      beforeRepair();
      try {
        await link(sourcePath, place.backup);
      } catch {
        stop("CONCURRENT_RUN_DETECTED");
      }
      await syncDirectory(place.directory);
      await unlink(sourcePath).catch(() => undefined);
      await syncDirectory(place.directory);
    }
    return { backupPath: place.backup, receipt };
  }

  async function publishPreparedBackupFromTemporary(
    place: PrivateLocations,
    temporary: string,
    authorization: DatabaseBackupPreparationAuthorization,
    consumption: PreparationConsumptionReceipt,
    tools: ApprovedTools,
    baselineVerification: DatabaseVerificationReceipt,
  ): Promise<DatabasePreparedBackupHandle> {
    await chmod(temporary, PRIVATE_FILE_MODE);
    await syncPrivateFile(temporary);
    const evidence = await privateFileEvidence(temporary);
    await validateArchive(temporary, tools);
    const receipt = bindPreparedBackupReceipt(
      preparedBackupBody(
        authorization,
        consumption,
        place,
        evidence,
        tools,
        baselineVerification,
      ),
      input.hmacKey,
    );
    await publishOwnerOnlyUtf8Exclusive(
      place.preparedBackupReceipt,
      canonicalJson(receipt),
    );
    try {
      await link(temporary, place.backup);
    } catch {
      stop("CONCURRENT_RUN_DETECTED");
    }
    await syncDirectory(place.directory);
    await unlink(temporary);
    await syncDirectory(place.directory);
    const prepared = { backupPath: place.backup, receipt };
    await completePreparation(place, consumption, prepared);
    return prepared;
  }

  function approvedBackupBody(
    authorization: DatabaseRecoveryAuthorization,
    prepared: DatabasePreparedBackupHandle,
  ): DatabaseApprovedBackupReceiptBody {
    return {
      contract: APPROVED_BACKUP_RECEIPT_CONTRACT,
      artifactDigest: input.artifactDigest,
      manifestDigest: input.manifestDigest,
      policyDigest: input.policyDigest,
      targetDatabaseFingerprint: input.targetDatabaseFingerprint,
      targetObservationDigest: input.targetObservationDigest,
      executionApprovalDigest: authorization.executionApproval.digest,
      preparedBackupReceiptDigest: prepared.receipt.receiptDigest,
      backupFingerprint: prepared.receipt.backupFingerprint,
      approvalChallengeToken: authorization.executionApproval.approvalChallengeToken,
      approvedAt: authorization.executionApproval.approvedAt,
      expiresAt: authorization.executionApproval.expiresAt,
      freshAuthorizationDigest: authorization.freshAuthorization.authorizationDigest,
      actionChallengeToken: authorization.actionChallengeToken,
    };
  }

  function assertApprovedBackupReceipt(
    value: unknown,
    expected: DatabaseApprovedBackupReceiptBody,
  ): DatabaseBackupReceipt {
    const candidate = requireRecord(value) as Partial<DatabaseBackupReceipt>;
    if (
      candidate.contract !== APPROVED_BACKUP_RECEIPT_CONTRACT ||
      typeof candidate.bindingToken !== "string" ||
      typeof candidate.receiptDigest !== "string"
    ) {
      stop("RESTORE_PROOF_MISMATCH");
    }
    const fields: Array<keyof Omit<DatabaseApprovedBackupReceiptBody, "contract">> = [
      "artifactDigest",
      "manifestDigest",
      "policyDigest",
      "targetDatabaseFingerprint",
      "targetObservationDigest",
      "executionApprovalDigest",
      "preparedBackupReceiptDigest",
      "backupFingerprint",
      "approvalChallengeToken",
      "approvedAt",
      "expiresAt",
      "freshAuthorizationDigest",
      "actionChallengeToken",
    ];
    if (fields.some((field) => typeof candidate[field] !== "string")) {
      stop("RESTORE_PROOF_MISMATCH");
    }
    const body: DatabaseApprovedBackupReceiptBody = {
      contract: APPROVED_BACKUP_RECEIPT_CONTRACT,
      artifactDigest: candidate.artifactDigest as Sha256Digest,
      manifestDigest: candidate.manifestDigest as Sha256Digest,
      policyDigest: candidate.policyDigest as Sha256Digest,
      targetDatabaseFingerprint: candidate.targetDatabaseFingerprint as Sha256Digest,
      targetObservationDigest: candidate.targetObservationDigest as Sha256Digest,
      executionApprovalDigest: candidate.executionApprovalDigest as Sha256Digest,
      preparedBackupReceiptDigest: candidate.preparedBackupReceiptDigest as Sha256Digest,
      backupFingerprint: candidate.backupFingerprint as Sha256Digest,
      approvalChallengeToken: candidate.approvalChallengeToken as ProtectedToken,
      approvedAt: candidate.approvedAt as string,
      expiresAt: candidate.expiresAt as string,
      freshAuthorizationDigest: candidate.freshAuthorizationDigest as Sha256Digest,
      actionChallengeToken: candidate.actionChallengeToken as ProtectedToken,
    };
    for (const digest of [
      body.artifactDigest,
      body.manifestDigest,
      body.policyDigest,
      body.targetDatabaseFingerprint,
      body.targetObservationDigest,
      body.executionApprovalDigest,
      body.preparedBackupReceiptDigest,
      body.backupFingerprint,
      body.freshAuthorizationDigest,
    ]) {
      assertSha256Digest(digest);
    }
    assertProtectedToken(body.approvalChallengeToken);
    assertProtectedToken(body.actionChallengeToken);
    assertProtectedToken(candidate.bindingToken);
    assertSha256Digest(candidate.receiptDigest);
    const rebound = bindApprovedBackupReceipt(body, input.hmacKey);
    if (
      !sameDigest(candidate.bindingToken, rebound.bindingToken) ||
      !sameDigest(candidate.receiptDigest, rebound.receiptDigest) ||
      canonicalJson(body) !== canonicalJson(expected)
    ) {
      stop("RESTORE_PROOF_MISMATCH");
    }
    return rebound;
  }

  async function existingApprovedBackup(
    place: PrivateLocations,
    tools: ApprovedTools,
    approvalDigest: Sha256Digest,
  ): Promise<DatabaseBackupHandle | null> {
    const prepared = await existingPreparedBackup(place, tools);
    if (prepared === null) return null;
    const approvedPath = approvedBackupReceiptPath(place, approvalDigest);
    if (!(await pathExists(approvedPath))) return null;
    const stored = requireRecord(await readPrivateJson(approvedPath));
    const storedFreshAuthorizationDigest = stored.freshAuthorizationDigest;
    const storedActionChallengeToken = stored.actionChallengeToken;
    if (
      typeof storedFreshAuthorizationDigest !== "string" ||
      typeof storedActionChallengeToken !== "string"
    ) {
      stop("RESTORE_PROOF_MISMATCH");
    }
    assertSha256Digest(storedFreshAuthorizationDigest);
    assertProtectedToken(storedActionChallengeToken);
    const candidateApprovalChallengeToken = stored.approvalChallengeToken;
    const candidateApprovedAt = stored.approvedAt;
    const candidateExpiresAt = stored.expiresAt;
    if (
      typeof candidateApprovalChallengeToken !== "string" ||
      typeof candidateApprovedAt !== "string" ||
      typeof candidateExpiresAt !== "string"
    ) {
      stop("RESTORE_PROOF_MISMATCH");
    }
    const receipt = assertApprovedBackupReceipt(stored, {
      contract: APPROVED_BACKUP_RECEIPT_CONTRACT,
      artifactDigest: input.artifactDigest,
      manifestDigest: input.manifestDigest,
      policyDigest: input.policyDigest,
      targetDatabaseFingerprint: input.targetDatabaseFingerprint,
      targetObservationDigest: input.targetObservationDigest,
      executionApprovalDigest: approvalDigest,
      preparedBackupReceiptDigest: prepared.receipt.receiptDigest,
      backupFingerprint: prepared.receipt.backupFingerprint,
      approvalChallengeToken: candidateApprovalChallengeToken as ProtectedToken,
      approvedAt: candidateApprovedAt,
      expiresAt: candidateExpiresAt,
      freshAuthorizationDigest: storedFreshAuthorizationDigest,
      actionChallengeToken: storedActionChallengeToken,
    });
    return { backupPath: prepared.backupPath, preparedReceipt: prepared.receipt, receipt };
  }

  function restoreIntentBody(
    authorization: Readonly<{
      approvalDigest: Sha256Digest;
      freshAuthorization: FreshTargetAuthorization;
      actionChallengeToken: ProtectedToken;
    }>,
    backup: DatabaseBackupHandle,
    expectedRestorePointFingerprint: Sha256Digest,
    expectedBaselineObservationDigest: Sha256Digest,
    exercise: DatabaseRestoreExercise,
  ): DatabaseRestoreIntentBody {
    return {
      contract: RESTORE_INTENT_CONTRACT,
      artifactDigest: input.artifactDigest,
      manifestDigest: input.manifestDigest,
      policyDigest: input.policyDigest,
      targetDatabaseFingerprint: input.targetDatabaseFingerprint,
      targetObservationDigest: input.targetObservationDigest,
      executionApprovalDigest: authorization.approvalDigest,
      freshAuthorizationDigest: authorization.freshAuthorization.authorizationDigest,
      actionChallengeToken: authorization.actionChallengeToken,
      backupReceiptDigest: backup.receipt.receiptDigest,
      expectedRestorePointFingerprint,
      expectedBaselineObservationDigest,
      rollbackPoint: exercise.rollbackPoint,
      durableAction: exercise.durableAction,
      durableNonceConsumptionDigest: exercise.durableNonceConsumptionDigest,
    };
  }

  function assertRestoreIntent(
    value: unknown,
    expected?: DatabaseRestoreIntentBody,
  ): DatabaseRestoreIntent {
    const candidate = requireRecord(value) as Partial<DatabaseRestoreIntent>;
    if (
      candidate.contract !== RESTORE_INTENT_CONTRACT ||
      typeof candidate.bindingToken !== "string" ||
      typeof candidate.intentDigest !== "string"
    ) {
      stop("RESTORE_PROOF_MISMATCH");
    }
    const fields: Array<keyof DatabaseRestoreIntentBody> = [
      "artifactDigest",
      "manifestDigest",
      "policyDigest",
      "targetDatabaseFingerprint",
      "targetObservationDigest",
      "executionApprovalDigest",
      "freshAuthorizationDigest",
      "actionChallengeToken",
      "backupReceiptDigest",
      "expectedRestorePointFingerprint",
      "expectedBaselineObservationDigest",
      "rollbackPoint",
      "durableAction",
      "durableNonceConsumptionDigest",
    ];
    if (fields.some((field) => typeof candidate[field] !== "string")) {
      stop("RESTORE_PROOF_MISMATCH");
    }
    const body: DatabaseRestoreIntentBody = {
      contract: RESTORE_INTENT_CONTRACT,
      artifactDigest: candidate.artifactDigest as Sha256Digest,
      manifestDigest: candidate.manifestDigest as Sha256Digest,
      policyDigest: candidate.policyDigest as Sha256Digest,
      targetDatabaseFingerprint: candidate.targetDatabaseFingerprint as Sha256Digest,
      targetObservationDigest: candidate.targetObservationDigest as Sha256Digest,
      executionApprovalDigest: candidate.executionApprovalDigest as Sha256Digest,
      freshAuthorizationDigest: candidate.freshAuthorizationDigest as Sha256Digest,
      actionChallengeToken: candidate.actionChallengeToken as ProtectedToken,
      backupReceiptDigest: candidate.backupReceiptDigest as Sha256Digest,
      expectedRestorePointFingerprint: candidate.expectedRestorePointFingerprint as Sha256Digest,
      expectedBaselineObservationDigest:
        candidate.expectedBaselineObservationDigest as Sha256Digest,
      rollbackPoint: candidate.rollbackPoint as DatabaseRestoreRollbackPoint,
      durableAction: candidate.durableAction as DatabaseRestoreExercise["durableAction"],
      durableNonceConsumptionDigest: candidate.durableNonceConsumptionDigest as Sha256Digest,
    };
    for (const digest of [
      body.artifactDigest,
      body.manifestDigest,
      body.policyDigest,
      body.targetDatabaseFingerprint,
      body.targetObservationDigest,
      body.executionApprovalDigest,
      body.freshAuthorizationDigest,
      body.backupReceiptDigest,
      body.expectedRestorePointFingerprint,
      body.expectedBaselineObservationDigest,
      body.durableNonceConsumptionDigest,
    ]) {
      assertSha256Digest(digest);
    }
    assertRestoreExercise({
      rollbackPoint: body.rollbackPoint,
      durableAction: body.durableAction,
      durableNonceConsumptionDigest: body.durableNonceConsumptionDigest,
    });
    assertProtectedToken(body.actionChallengeToken);
    const rebound = bindRestoreIntent(body, input.hmacKey);
    assertProtectedToken(candidate.bindingToken);
    assertSha256Digest(candidate.intentDigest);
    if (
      !sameDigest(candidate.bindingToken, rebound.bindingToken) ||
      !sameDigest(candidate.intentDigest, rebound.intentDigest) ||
      (expected !== undefined && canonicalJson(body) !== canonicalJson(expected))
    ) {
      stop("RESTORE_PROOF_MISMATCH");
    }
    return rebound;
  }

  function restorePreparedBody(
    backup: DatabaseBackupHandle,
    intent: DatabaseRestoreIntent,
  ): DatabaseRestorePreparedBody {
    return {
      contract: RESTORE_PREPARED_CONTRACT,
      artifactDigest: input.artifactDigest,
      manifestDigest: input.manifestDigest,
      policyDigest: input.policyDigest,
      targetDatabaseFingerprint: input.targetDatabaseFingerprint,
      targetObservationDigest: input.targetObservationDigest,
      executionApprovalDigest: intent.executionApprovalDigest,
      backupFingerprint: backup.receipt.backupFingerprint,
      backupReceiptDigest: backup.receipt.receiptDigest,
      restoreIntentDigest: intent.intentDigest,
      expectedRestorePointFingerprint: intent.expectedRestorePointFingerprint,
      expectedBaselineObservationDigest: intent.expectedBaselineObservationDigest,
      rollbackPoint: intent.rollbackPoint,
      durableAction: intent.durableAction,
      durableNonceConsumptionDigest: intent.durableNonceConsumptionDigest,
    };
  }

  function assertRestorePreparedMarker(
    value: unknown,
    expected?: DatabaseRestorePreparedBody,
  ): DatabaseRestorePreparedMarker {
    const candidate = requireRecord(value) as Partial<DatabaseRestorePreparedMarker>;
    if (
      candidate.contract !== RESTORE_PREPARED_CONTRACT ||
      typeof candidate.artifactDigest !== "string" ||
      typeof candidate.manifestDigest !== "string" ||
      typeof candidate.policyDigest !== "string" ||
      typeof candidate.targetDatabaseFingerprint !== "string" ||
      typeof candidate.targetObservationDigest !== "string" ||
      typeof candidate.executionApprovalDigest !== "string" ||
      typeof candidate.backupFingerprint !== "string" ||
      typeof candidate.backupReceiptDigest !== "string" ||
      typeof candidate.restoreIntentDigest !== "string" ||
      typeof candidate.expectedRestorePointFingerprint !== "string" ||
      typeof candidate.expectedBaselineObservationDigest !== "string" ||
      typeof candidate.rollbackPoint !== "string" ||
      typeof candidate.durableAction !== "string" ||
      typeof candidate.durableNonceConsumptionDigest !== "string" ||
      typeof candidate.bindingToken !== "string" ||
      typeof candidate.markerDigest !== "string"
    ) {
      stop("RESTORE_PROOF_MISMATCH");
    }
    const body: DatabaseRestorePreparedBody = {
      contract: RESTORE_PREPARED_CONTRACT,
      artifactDigest: candidate.artifactDigest,
      manifestDigest: candidate.manifestDigest,
      policyDigest: candidate.policyDigest,
      targetDatabaseFingerprint: candidate.targetDatabaseFingerprint,
      targetObservationDigest: candidate.targetObservationDigest,
      executionApprovalDigest: candidate.executionApprovalDigest,
      backupFingerprint: candidate.backupFingerprint,
      backupReceiptDigest: candidate.backupReceiptDigest,
      restoreIntentDigest: candidate.restoreIntentDigest,
      expectedRestorePointFingerprint: candidate.expectedRestorePointFingerprint,
      expectedBaselineObservationDigest: candidate.expectedBaselineObservationDigest,
      rollbackPoint: candidate.rollbackPoint,
      durableAction: candidate.durableAction,
      durableNonceConsumptionDigest: candidate.durableNonceConsumptionDigest,
    };
    for (const digest of [
      body.artifactDigest,
      body.manifestDigest,
      body.policyDigest,
      body.targetDatabaseFingerprint,
      body.targetObservationDigest,
      body.executionApprovalDigest,
      body.backupFingerprint,
      body.backupReceiptDigest,
      body.restoreIntentDigest,
      body.expectedRestorePointFingerprint,
      body.expectedBaselineObservationDigest,
      body.durableNonceConsumptionDigest,
      candidate.markerDigest,
    ]) {
      assertSha256Digest(digest);
    }
    assertRestoreExercise({
      rollbackPoint: body.rollbackPoint,
      durableAction: body.durableAction,
      durableNonceConsumptionDigest: body.durableNonceConsumptionDigest,
    });
    assertProtectedToken(candidate.bindingToken);
    const rebound = bindRestorePreparedMarker(body, input.hmacKey);
    if (
      !sameDigest(candidate.bindingToken, rebound.bindingToken) ||
      !sameDigest(candidate.markerDigest, rebound.markerDigest) ||
      (expected !== undefined && canonicalJson(body) !== canonicalJson(expected))
    ) {
      stop("RESTORE_PROOF_MISMATCH");
    }
    return rebound;
  }

  function preparedRecord(marker: DatabaseRestorePreparedMarker): DatabaseRestorePreparedRecord {
    const markerJson = canonicalJson(marker);
    return { markerJson, markerFingerprint: sha256Digest(markerJson) };
  }

  function assertPreparedRecord(
    record: DatabaseRestorePreparedRecord,
    expected?: DatabaseRestorePreparedBody,
  ): Readonly<{
    marker: DatabaseRestorePreparedMarker;
    record: DatabaseRestorePreparedRecord;
  }> {
    if (
      typeof record.markerJson !== "string" ||
      record.markerJson.length === 0 ||
      typeof record.markerFingerprint !== "string"
    ) {
      stop("RESTORE_PROOF_MISMATCH");
    }
    assertSha256Digest(record.markerFingerprint);
    if (!sameDigest(sha256Digest(record.markerJson), record.markerFingerprint)) {
      stop("RESTORE_PROOF_MISMATCH");
    }
    let value: unknown;
    try {
      value = JSON.parse(record.markerJson) as unknown;
    } catch {
      stop("RESTORE_PROOF_MISMATCH");
    }
    const marker = assertRestorePreparedMarker(value, expected);
    if (record.markerJson !== canonicalJson(marker)) stop("RESTORE_PROOF_MISMATCH");
    return { marker, record };
  }

  function assertExactBaselineVerification(
    receipt: DatabaseVerificationReceipt,
  ): DatabaseVerificationReceipt {
    if (
      receipt.artifactDigest !== input.artifactDigest ||
      receipt.manifestDigest !== input.manifestDigest ||
      receipt.purpose !== "restored_baseline" ||
      !sameDigest(receipt.databaseStateFingerprint, input.baselineDatabaseFingerprint)
    ) {
      stop("RESTORE_PROOF_MISMATCH");
    }
    assertSha256Digest(receipt.schemaFingerprint);
    assertSha256Digest(receipt.databaseStateFingerprint);
    return receipt;
  }

  async function exactRestoredVerification(): Promise<DatabaseVerificationReceipt> {
    try {
      return assertExactBaselineVerification(await input.verifyRestoredBaseline());
    } catch (error) {
      if (error instanceof Sk90ResetSafetyError) throw error;
      return stop("UNEXPECTED_FAILURE");
    }
  }

  async function alreadyRestoredVerification(): Promise<DatabaseVerificationReceipt | null> {
    try {
      return await exactRestoredVerification();
    } catch (error) {
      if (
        error instanceof Sk90ResetSafetyError &&
        (error.code === "RESTORE_PROOF_MISMATCH" ||
          error.code === "POST_RESET_INTEGRITY_MISMATCH" ||
          error.code === "DATABASE_VERIFICATION_MISMATCH")
      ) {
        return null;
      }
      throw error;
    }
  }

  function restoreReceiptBody(
    approvalDigest: Sha256Digest,
    backup: DatabaseBackupHandle,
    intent: DatabaseRestoreIntent,
    verification: DatabaseVerificationReceipt,
    disposition: DatabaseRestoreReceiptBody["restoreDisposition"],
  ): DatabaseRestoreReceiptBody {
    return {
      contract: RESTORE_RECEIPT_CONTRACT,
      artifactDigest: input.artifactDigest,
      manifestDigest: input.manifestDigest,
      policyDigest: input.policyDigest,
      targetDatabaseFingerprint: input.targetDatabaseFingerprint,
      targetObservationDigest: input.targetObservationDigest,
      executionApprovalDigest: approvalDigest,
      backupFingerprint: backup.receipt.backupFingerprint,
      restoreIntentDigest: intent.intentDigest,
      rollbackPoint: intent.rollbackPoint,
      durableAction: intent.durableAction,
      durableNonceConsumptionDigest: intent.durableNonceConsumptionDigest,
      databaseStateFingerprint: verification.databaseStateFingerprint,
      verificationReceiptDigest: sha256Digest(canonicalJson(verification)),
      restoreDisposition: disposition,
      databaseMutationCount: 0,
      restored: true,
    };
  }

  function assertRestoreReceipt(
    value: unknown,
    expected?: DatabaseRestoreReceiptBody,
  ): DatabaseRestoreReceipt {
    const candidate = requireRecord(value) as Partial<DatabaseRestoreReceipt>;
    if (
      candidate.contract !== RESTORE_RECEIPT_CONTRACT ||
      typeof candidate.bindingToken !== "string" ||
      typeof candidate.receiptDigest !== "string"
    ) {
      stop("RESTORE_PROOF_MISMATCH");
    }
    if (
      typeof candidate.artifactDigest !== "string" ||
      typeof candidate.manifestDigest !== "string" ||
      typeof candidate.policyDigest !== "string" ||
      typeof candidate.targetDatabaseFingerprint !== "string" ||
      typeof candidate.targetObservationDigest !== "string" ||
      typeof candidate.executionApprovalDigest !== "string" ||
      typeof candidate.backupFingerprint !== "string" ||
      typeof candidate.restoreIntentDigest !== "string" ||
      typeof candidate.rollbackPoint !== "string" ||
      typeof candidate.durableAction !== "string" ||
      typeof candidate.durableNonceConsumptionDigest !== "string" ||
      typeof candidate.databaseStateFingerprint !== "string" ||
      typeof candidate.verificationReceiptDigest !== "string" ||
      (candidate.restoreDisposition !== "executed" &&
        candidate.restoreDisposition !== "verified_without_replay") ||
      candidate.databaseMutationCount !== 0 ||
      candidate.restored !== true
    ) {
      stop("RESTORE_PROOF_MISMATCH");
    }
    const body: DatabaseRestoreReceiptBody = {
      contract: RESTORE_RECEIPT_CONTRACT,
      artifactDigest: candidate.artifactDigest,
      manifestDigest: candidate.manifestDigest,
      policyDigest: candidate.policyDigest,
      targetDatabaseFingerprint: candidate.targetDatabaseFingerprint,
      targetObservationDigest: candidate.targetObservationDigest,
      executionApprovalDigest: candidate.executionApprovalDigest,
      backupFingerprint: candidate.backupFingerprint,
      restoreIntentDigest: candidate.restoreIntentDigest,
      rollbackPoint: candidate.rollbackPoint,
      durableAction: candidate.durableAction,
      durableNonceConsumptionDigest: candidate.durableNonceConsumptionDigest,
      databaseStateFingerprint: candidate.databaseStateFingerprint,
      verificationReceiptDigest: candidate.verificationReceiptDigest,
      restoreDisposition: candidate.restoreDisposition,
      databaseMutationCount: 0,
      restored: true,
    };
    for (const digest of [
      body.artifactDigest,
      body.manifestDigest,
      body.policyDigest,
      body.targetDatabaseFingerprint,
      body.targetObservationDigest,
      body.executionApprovalDigest,
      body.backupFingerprint,
      body.restoreIntentDigest,
      body.durableNonceConsumptionDigest,
      body.databaseStateFingerprint,
      body.verificationReceiptDigest,
    ]) {
      assertSha256Digest(digest);
    }
    assertRestoreExercise({
      rollbackPoint: body.rollbackPoint,
      durableAction: body.durableAction,
      durableNonceConsumptionDigest: body.durableNonceConsumptionDigest,
    });
    const rebound = bindRestoreReceipt(body, input.hmacKey);
    assertProtectedToken(candidate.bindingToken);
    assertSha256Digest(candidate.receiptDigest);
    if (
      !sameDigest(candidate.bindingToken, rebound.bindingToken) ||
      !sameDigest(candidate.receiptDigest, rebound.receiptDigest) ||
      (expected !== undefined && canonicalJson(body) !== canonicalJson(expected))
    ) {
      stop("RESTORE_PROOF_MISMATCH");
    }
    return rebound;
  }

  async function exactPreparedRestore(
    selector: DatabaseRestoreSelector,
  ): Promise<DatabaseRestorePreparedRecord> {
    assertSha256Digest(selector.approvalDigest);
    assertSha256Digest(selector.expectedRestorePointFingerprint);
    assertSha256Digest(selector.expectedBaselineObservationDigest);
    assertRestoreSelector(selector);
    if (
      !sameDigest(selector.expectedBaselineObservationDigest, input.baselineDatabaseFingerprint)
    ) {
      stop("RESTORE_PROOF_MISMATCH");
    }
    const place = await locations();
    const tools = await currentTools();
    const backup = await existingApprovedBackup(place, tools, selector.approvalDigest);
    if (
      backup === null ||
      !sameDigest(backup.receipt.backupFingerprint, selector.expectedRestorePointFingerprint)
    ) {
      stop("RESTORE_POINT_NOT_READY");
    }
    let stored: DatabaseRestorePreparedRecord | null;
    try {
      stored = await input.readRestorePreparedRecord();
    } catch (error) {
      if (error instanceof Sk90ResetSafetyError) throw error;
      stop("RESTORE_REQUIRED");
    }
    if (stored === null) stop("RESTORE_REQUIRED");
    const preliminary = assertPreparedRecord(stored);
    const marker = preliminary.marker;
    if (
      !sameDigest(marker.executionApprovalDigest, selector.approvalDigest) ||
      !sameDigest(marker.backupFingerprint, selector.expectedRestorePointFingerprint) ||
      !sameDigest(
        marker.expectedRestorePointFingerprint,
        selector.expectedRestorePointFingerprint,
      ) ||
      !sameDigest(
        marker.expectedBaselineObservationDigest,
        selector.expectedBaselineObservationDigest,
      ) ||
      marker.rollbackPoint !== selector.rollbackPoint ||
      marker.durableAction !== selector.durableAction
    ) {
      stop("RESTORE_PROOF_MISMATCH");
    }
    const generation = restoreGenerationPaths(
      place,
      {
        rollbackPoint: marker.rollbackPoint,
        durableAction: marker.durableAction,
        durableNonceConsumptionDigest: marker.durableNonceConsumptionDigest,
      },
      selector.approvalDigest,
    );
    if (!(await pathExists(generation.intent))) stop("RESTORE_PROOF_MISMATCH");
    const intent = assertRestoreIntent(
      requireRecord(await readPrivateJson(generation.intent)),
    );
    if (!sameDigest(intent.intentDigest, marker.restoreIntentDigest)) {
      stop("RESTORE_PROOF_MISMATCH");
    }
    return assertPreparedRecord(stored, restorePreparedBody(backup, intent)).record;
  }

  return {
    async prepareBackup(authorization) {
      assertAuthorization(authorization, {
        action: "prepare",
        artifactDigest: input.artifactDigest,
        targetObservationDigest: input.targetObservationDigest,
      });
      assertSha256Digest(authorization.targetObservationBindingDigest);
      if (input.withVerifiedBaselineSnapshot === undefined) {
        stop("EXTERNAL_ADAPTER_REQUIRED");
      }
      const place = await locations();
      const consumption = await consumePreparationAuthorization(place, authorization);
      const tools = await currentTools();
      const existing = await existingPreparedBackup(place, tools, () => {
        assertPreparationFreshAtBoundary(authorization);
      });
      if (existing) {
        if ((await existingPreparationCompletion(place, consumption, existing)) !== null) {
          stop("FRESHNESS_NONCE_REUSED");
        }
        await completePreparation(place, consumption, existing);
        return existing;
      }
      if (await pathExists(place.preparationCompletionReceipt)) {
        stop("DURABLE_STATE_INVALID");
      }

      const temporary = preparingBackupPath(place);
      if (await pathExists(temporary)) {
        await validateArchive(temporary, tools);
        assertPreparationFreshAtBoundary(authorization);
        const recoveredBaseline = assertExactBaselineVerification(
          await input.withVerifiedBaselineSnapshot(() => {
            assertPreparationFreshAtBoundary(authorization);
            return Promise.resolve();
          }),
        );
        try {
          return await publishPreparedBackupFromTemporary(
            place,
            temporary,
            authorization,
            consumption,
            tools,
            recoveredBaseline,
          );
        } catch (error) {
          if (error instanceof Sk90ResetSafetyError) throw error;
          stop("UNEXPECTED_FAILURE");
        }
      }

      assertPreparationFreshAtBoundary(authorization);
      let handle;
      let temporaryCreated = false;
      try {
        handle = await open(
          temporary,
          constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
          PRIVATE_FILE_MODE,
        );
        temporaryCreated = true;
        await chmod(temporary, PRIVATE_FILE_MODE);
        assertPrivateRegularFile(await handle.stat(), true);
      } catch (error) {
        if (temporaryCreated) await unlink(temporary).catch(() => undefined);
        if (errno(error) === "EEXIST") stop("CONCURRENT_RUN_DETECTED");
        stop("DURABLE_STATE_INVALID");
      } finally {
        await handle?.close().catch(() => undefined);
      }

      let baselineVerification: DatabaseVerificationReceipt;
      try {
        baselineVerification = assertExactBaselineVerification(
          await input.withVerifiedBaselineSnapshot(async (snapshotId) => {
            assertPreparationFreshAtBoundary(authorization);
            await processPort.run({
              binary: tools.dump.path,
              arguments: [
                "--format=custom",
                "--no-owner",
                "--no-privileges",
                `--snapshot=${snapshotId}`,
                "--file",
                temporary,
              ],
              environment: childEnvironment,
              timeoutMs,
            });
          }),
        );
      } catch (error) {
        if (!(await pathExists(place.preparedBackupReceipt))) {
          await unlink(temporary).catch(() => undefined);
        }
        if (error instanceof Sk90ResetSafetyError) throw error;
        stop("RESTORE_POINT_NOT_READY");
      }

      try {
        return await publishPreparedBackupFromTemporary(
          place,
          temporary,
          authorization,
          consumption,
          tools,
          baselineVerification,
        );
      } catch (error) {
        if (!(await pathExists(place.preparedBackupReceipt))) {
          await unlink(temporary).catch(() => undefined);
        }
        if (error instanceof Sk90ResetSafetyError) throw error;
        stop("UNEXPECTED_FAILURE");
      }
    },

    async requireApprovedBackup(authorization) {
      assertSha256Digest(authorization.approvedExecutionDigest);
      const reboundApproval = bindExecutableResetApproval(authorization.executionApproval);
      if (
        !sameDigest(reboundApproval.digest, authorization.executionApproval.digest) ||
        !sameDigest(reboundApproval.digest, authorization.approvedExecutionDigest)
      ) {
        stop("EXECUTION_APPROVAL_MISMATCH");
      }
      assertAuthorization(authorization, {
        action: "quarantine_objects",
        artifactDigest: input.artifactDigest,
        targetObservationDigest: input.targetObservationDigest,
      });
      const place = await locations();
      const tools = await currentTools();
      const prepared = await existingPreparedBackup(place, tools);
      if (
        prepared === null ||
        !sameDigest(
          prepared.receipt.backupFingerprint,
          authorization.executionApproval.databaseRestorePointFingerprint,
        ) ||
        !sameDigest(authorization.executionApproval.artifactDigest, input.artifactDigest) ||
        !sameDigest(authorization.executionApproval.manifestDigest, input.manifestDigest) ||
        !sameDigest(authorization.executionApproval.policyDigest, input.policyDigest) ||
        !sameDigest(
          prepared.receipt.preparationApprovalLedgerDirectoryFingerprint,
          authorization.executionApproval.approvalLedgerDirectoryFingerprint,
        ) ||
        !sameDigest(
          authorization.executionApproval.targetDatabaseFingerprint,
          input.targetDatabaseFingerprint,
        )
      ) {
        stop("EXECUTION_APPROVAL_MISMATCH");
      }
      const approvedPath = approvedBackupReceiptPath(
        place,
        authorization.executionApproval.digest,
      );
      const requestedBody = approvedBackupBody(authorization, prepared);
      let receipt: DatabaseBackupReceipt;
      if (await pathExists(approvedPath)) {
        const stored = requireRecord(await readPrivateJson(approvedPath));
        const storedFreshAuthorizationDigest = stored.freshAuthorizationDigest;
        const storedActionChallengeToken = stored.actionChallengeToken;
        if (
          typeof storedFreshAuthorizationDigest !== "string" ||
          typeof storedActionChallengeToken !== "string"
        ) {
          stop("RESTORE_PROOF_MISMATCH");
        }
        receipt = assertApprovedBackupReceipt(stored, {
          ...requestedBody,
          freshAuthorizationDigest: storedFreshAuthorizationDigest as Sha256Digest,
          actionChallengeToken: storedActionChallengeToken as ProtectedToken,
        });
      } else {
        receipt = bindApprovedBackupReceipt(requestedBody, input.hmacKey);
        await publishOwnerOnlyUtf8Exclusive(approvedPath, canonicalJson(receipt));
      }
      return { backupPath: prepared.backupPath, preparedReceipt: prepared.receipt, receipt };
    },

    async revalidateApprovedBackup(authorization) {
      assertSha256Digest(authorization.approvedExecutionDigest);
      const reboundApproval = bindExecutableResetApproval(authorization.executionApproval);
      if (
        !sameDigest(reboundApproval.digest, authorization.executionApproval.digest) ||
        !sameDigest(reboundApproval.digest, authorization.approvedExecutionDigest) ||
        !sameDigest(reboundApproval.artifactDigest, input.artifactDigest) ||
        !sameDigest(reboundApproval.manifestDigest, input.manifestDigest) ||
        !sameDigest(reboundApproval.policyDigest, input.policyDigest) ||
        !sameDigest(reboundApproval.targetDatabaseFingerprint, input.targetDatabaseFingerprint)
      ) {
        stop("EXECUTION_APPROVAL_MISMATCH");
      }
      const place = await locations();
      const tools = await currentTools();
      const backup = await existingApprovedBackup(place, tools, reboundApproval.digest);
      if (
        backup === null ||
        !sameDigest(
          backup.receipt.backupFingerprint,
          reboundApproval.databaseRestorePointFingerprint,
        )
      ) {
        stop("RESTORE_POINT_NOT_READY");
      }
      return backup;
    },

    async requirePreparedRestore(selector) {
      await exactPreparedRestore(selector);
    },

    async requireExecutedRestore(selector) {
      assertSha256Digest(selector.approvalDigest);
      assertSha256Digest(selector.expectedRestorePointFingerprint);
      assertSha256Digest(selector.expectedBaselineObservationDigest);
      assertRestoreSelector(selector);
      if (
        !sameDigest(selector.expectedBaselineObservationDigest, input.baselineDatabaseFingerprint)
      ) {
        stop("RESTORE_PROOF_MISMATCH");
      }

      const place = await locations();
      const prefix = `database-${digestSuffix}.restore-`;
      const suffix = ".receipt.json";
      const receiptNames = (await readdir(place.directory))
        .filter(
          (name) =>
            name.startsWith(prefix) &&
            name.endsWith(suffix) &&
            /^[0-9a-f]{64}$/.test(name.slice(prefix.length, -suffix.length)),
        )
        .sort();
      const matches: DatabaseRestoreReceipt[] = [];

      for (const receiptName of receiptNames) {
        const receipt = assertRestoreReceipt(
          requireRecord(await readPrivateJson(join(place.directory, receiptName))),
        );
        if (
          !sameDigest(receipt.executionApprovalDigest, selector.approvalDigest) ||
          receipt.rollbackPoint !== selector.rollbackPoint ||
          receipt.durableAction !== selector.durableAction
        ) {
          continue;
        }
        const intentName = `${receiptName.slice(0, -suffix.length)}.intent.json`;
        const intent = assertRestoreIntent(
          requireRecord(await readPrivateJson(join(place.directory, intentName))),
        );
        if (
          !sameDigest(intent.intentDigest, receipt.restoreIntentDigest) ||
          !sameDigest(intent.executionApprovalDigest, selector.approvalDigest) ||
          intent.rollbackPoint !== selector.rollbackPoint ||
          intent.durableAction !== selector.durableAction ||
          !sameDigest(
            intent.durableNonceConsumptionDigest,
            receipt.durableNonceConsumptionDigest,
          ) ||
          !sameDigest(
            intent.expectedRestorePointFingerprint,
            selector.expectedRestorePointFingerprint,
          ) ||
          !sameDigest(
            intent.expectedBaselineObservationDigest,
            selector.expectedBaselineObservationDigest,
          ) ||
          !sameDigest(receipt.backupFingerprint, selector.expectedRestorePointFingerprint) ||
          !sameDigest(receipt.databaseStateFingerprint, input.baselineDatabaseFingerprint) ||
          !sameDigest(receipt.artifactDigest, input.artifactDigest) ||
          !sameDigest(receipt.manifestDigest, input.manifestDigest) ||
          !sameDigest(receipt.policyDigest, input.policyDigest) ||
          !sameDigest(receipt.targetDatabaseFingerprint, input.targetDatabaseFingerprint) ||
          !sameDigest(receipt.targetObservationDigest, input.targetObservationDigest) ||
          receipt.restoreDisposition !== "executed"
        ) {
          stop("RESTORE_PROOF_MISMATCH");
        }
        matches.push(receipt);
      }

      if (matches.length === 0) stop("RESTORE_REQUIRED");
      if (matches.length !== 1) stop("RESTORE_PROOF_MISMATCH");
      return matches[0] as DatabaseRestoreReceipt;
    },

    async restore(authorization) {
      assertSha256Digest(authorization.approvalDigest);
      assertSha256Digest(authorization.expectedRestorePointFingerprint);
      assertSha256Digest(authorization.expectedBaselineObservationDigest);
      assertRestoreExercise(authorization.exercise);
      if (
        typeof authorization.forceReplay !== "boolean" ||
        typeof authorization.resumePrepared !== "boolean"
      ) {
        stop("RESTORE_PROOF_MISMATCH");
      }
      assertAuthorization(
        {
          freshAuthorization: authorization.freshAuthorization,
          actionChallengeToken: authorization.actionChallengeToken,
          currentTime: authorization.currentTime,
        },
        {
          action: "restore",
          artifactDigest: input.artifactDigest,
          targetObservationDigest: input.targetObservationDigest,
        },
      );
      if (
        !sameDigest(
          authorization.expectedBaselineObservationDigest,
          input.baselineDatabaseFingerprint,
        )
      ) {
        stop("RESTORE_PROOF_MISMATCH");
      }

      const assertRestoreFresh = (): void => {
        const boundaryTime = input.now();
        if (!Number.isFinite(boundaryTime.getTime())) stop("FRESHNESS_PROOF_INVALID");
        assertAuthorization(
          {
            freshAuthorization: authorization.freshAuthorization,
            actionChallengeToken: authorization.actionChallengeToken,
            currentTime: boundaryTime.toISOString(),
          },
          {
            action: "restore",
            artifactDigest: input.artifactDigest,
            targetObservationDigest: input.targetObservationDigest,
          },
        );
      };

      const place = await locations();
      const tools = await currentTools();
      const backup = await existingApprovedBackup(place, tools, authorization.approvalDigest);
      if (
        backup === null ||
        !sameDigest(
          backup.receipt.backupFingerprint,
          authorization.expectedRestorePointFingerprint,
        )
      ) {
        stop("RESTORE_POINT_NOT_READY");
      }

      const requestedIntentBody = restoreIntentBody(
        authorization,
        backup,
        authorization.expectedRestorePointFingerprint,
        authorization.expectedBaselineObservationDigest,
        authorization.exercise,
      );
      const generation = restoreGenerationPaths(
        place,
        authorization.exercise,
        authorization.approvalDigest,
      );
      let intent: DatabaseRestoreIntent;
      const intentAlreadyExisted = await pathExists(generation.intent);
      if (intentAlreadyExisted) {
        // A resume uses a new fresh authorization, but the immutable original
        // intent remains the durable crash boundary. Compare all static
        // bindings, then separately validate the current authorization above.
        const stored = requireRecord(await readPrivateJson(generation.intent));
        const storedFreshAuthorizationDigest = stored.freshAuthorizationDigest;
        const storedActionChallengeToken = stored.actionChallengeToken;
        if (
          typeof storedFreshAuthorizationDigest !== "string" ||
          typeof storedActionChallengeToken !== "string"
        ) {
          stop("RESTORE_PROOF_MISMATCH");
        }
        assertSha256Digest(storedFreshAuthorizationDigest);
        assertProtectedToken(storedActionChallengeToken);
        const resumedBody: DatabaseRestoreIntentBody = {
          ...requestedIntentBody,
          freshAuthorizationDigest: storedFreshAuthorizationDigest,
          actionChallengeToken: storedActionChallengeToken,
        };
        intent = assertRestoreIntent(stored, resumedBody);
      } else {
        intent = bindRestoreIntent(requestedIntentBody, input.hmacKey);
        await publishOwnerOnlyUtf8Exclusive(generation.intent, canonicalJson(intent));
      }

      if (await pathExists(generation.receipt)) {
        const verification = await exactRestoredVerification();
        const expectedBody = restoreReceiptBody(
          authorization.approvalDigest,
          backup,
          intent,
          verification,
          "verified_without_replay",
        );
        const stored = requireRecord(await readPrivateJson(generation.receipt));
        const storedDisposition = stored.restoreDisposition;
        if (storedDisposition !== "executed" && storedDisposition !== "verified_without_replay") {
          stop("RESTORE_PROOF_MISMATCH");
        }
        return assertRestoreReceipt(stored, {
          ...expectedBody,
          restoreDisposition: storedDisposition,
        });
      }

      const crashWindowVerification = await alreadyRestoredVerification();
      let verification: DatabaseVerificationReceipt;
      let disposition: DatabaseRestoreReceiptBody["restoreDisposition"];
      if (crashWindowVerification && !authorization.forceReplay) {
        if ((await input.readRestorePreparedRecord()) !== null) {
          stop("RESTORE_PROOF_MISMATCH");
        }
        verification = crashWindowVerification;
        disposition = "verified_without_replay";
      } else {
        const selector: DatabaseRestoreSelector = {
          approvalDigest: authorization.approvalDigest,
          expectedRestorePointFingerprint: authorization.expectedRestorePointFingerprint,
          expectedBaselineObservationDigest: authorization.expectedBaselineObservationDigest,
          rollbackPoint: authorization.exercise.rollbackPoint,
          durableAction: authorization.exercise.durableAction,
        };
        const existingPrepared = authorization.resumePrepared
          ? await exactPreparedRestore(selector)
          : await input.readRestorePreparedRecord();
        if (!authorization.resumePrepared && existingPrepared !== null) {
          stop("RESTORE_PROOF_MISMATCH");
        }
        assertRestoreFresh();
        const nextPrepared = preparedRecord(
          bindRestorePreparedMarker(restorePreparedBody(backup, intent), input.hmacKey),
        );
        try {
          await input.prepareRestoreTarget({
            marker: nextPrepared,
            expectedExistingMarkerFingerprint:
              existingPrepared?.markerFingerprint ?? null,
            expectedSourceState:
              authorization.exercise.rollbackPoint === "before_database_commit"
                ? "baseline"
                : "post_reset",
            assertFresh: assertRestoreFresh,
          });
        } catch (error) {
          if (error instanceof Sk90ResetSafetyError) throw error;
          stop("RESTORE_REQUIRED");
        }
        assertRestoreFresh();
        const targetDatabaseName = childEnvironment.PGDATABASE;
        if (!targetDatabaseName) stop("REHEARSAL_ENV_INVALID");
        try {
          await processPort.run({
            binary: tools.restore.path,
            arguments: [
              `--dbname=${targetDatabaseName}`,
              "--clean",
              "--if-exists",
              "--exit-on-error",
              "--single-transaction",
              "--no-owner",
              "--no-privileges",
              place.backup,
            ],
            environment: childEnvironment,
            timeoutMs,
          });
        } catch {
          stop("RESTORE_REQUIRED");
        }
        verification = await exactRestoredVerification();
        if ((await input.readRestorePreparedRecord()) !== null) {
          stop("RESTORE_PROOF_MISMATCH");
        }
        disposition = "executed";
      }

      const receipt = bindRestoreReceipt(
        restoreReceiptBody(authorization.approvalDigest, backup, intent, verification, disposition),
        input.hmacKey,
      );
      await publishOwnerOnlyUtf8Exclusive(generation.receipt, canonicalJson(receipt));
      return receipt;
    },
  };
}
