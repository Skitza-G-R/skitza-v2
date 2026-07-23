import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { constants as fsConstants, createReadStream } from "node:fs";
import { chmod, copyFile, link, lstat, open, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import type { Writable } from "node:stream";

import {
  assertProtectedToken,
  assertSha256Digest,
  canonicalJson,
  protectValue,
  sameDigest,
  sha256Digest,
  type ProtectedToken,
  type Sha256Digest,
} from "../sk90-reset/canonical";
import {
  ensureOwnerOnlyDirectory,
  readOwnerOnlyUtf8,
  writeOwnerOnlyUtf8Atomic,
} from "../sk90-reset/private-envelope";
import { assertSk104ProductionManifest, type Sk104ProductionManifest } from "./contract";
import {
  SK104_DATABASE_ADVISORY_LOCK_KEY,
  SK104_CHILD_RESTORE_ADVISORY_LOCK_KEY,
  SK104_RUN_LEASE_ADVISORY_LOCK_KEY,
} from "./database";
import { SK90_MIGRATION_ADVISORY_LOCK_KEY } from "../sk90-reset/database-adapter";
import { stopSk104 } from "./environment";

const BACKUP_CONTRACT = "sk104-production-database-backup-v2" as const;
const MAX_PG_RESTORE_LIST_BYTES = 16 * 1024 * 1024;

type BackupBody = Readonly<{
  contract: typeof BACKUP_CONTRACT;
  manifestDigest: Sha256Digest;
  targetDatabaseFingerprint: Sha256Digest;
  protectedSnapshot: ProtectedToken;
  archiveFingerprint: Sha256Digest;
  archiveSizeBytes: number;
  restoreListVerified: true;
  archiveCreatesPublicSchema: boolean;
  preparedAt: string;
}>;

type BackupStagingBody = Readonly<{
  contract: "sk104-production-database-backup-staging-v1";
  manifestDigest: Sha256Digest;
  targetDatabaseFingerprint: Sha256Digest;
  protectedSnapshot: ProtectedToken;
  stagingArchiveName: string;
  preparedAt: string;
  archiveFingerprint: Sha256Digest | null;
  archiveSizeBytes: number | null;
  archiveCreatesPublicSchema: boolean | null;
}>;

type BackupStagingReceipt = BackupStagingBody & Readonly<{ bindingToken: ProtectedToken }>;

export type Sk104DatabaseBackupReceipt = BackupBody &
  Readonly<{
    bindingToken: ProtectedToken;
    restorePointFingerprint: Sha256Digest;
  }>;

export type Sk104DatabaseBackupRuntime = Readonly<{
  runPgDump(
    input: Readonly<{
      binary: string;
      databaseUrl: string;
      snapshot: string;
      archivePath: string;
    }>,
  ): Promise<void>;
  verifyPgRestoreList(
    input: Readonly<{
      binary: string;
      archivePath: string;
    }>,
  ): Promise<Readonly<{ archiveCreatesPublicSchema: boolean }>>;
  runPgRestore(
    input: Readonly<{
      pgRestoreBinary: string;
      psqlBinary: string;
      databaseUrl: string;
      archivePath: string;
      archiveCreatesPublicSchema: boolean;
      expectedDatabaseName: string;
      parentProofAdvisoryLockKey: string;
      assertAuthorizationFresh(): void | Promise<void>;
    }>,
  ): Promise<void>;
}>;

export type Sk104DatabaseRestoreReceipt = Readonly<{
  contract: "sk104-production-database-restore-v1";
  manifestDigest: Sha256Digest;
  targetDatabaseFingerprint: Sha256Digest;
  backupRestorePointFingerprint: Sha256Digest;
  restoredAt: string;
  receiptDigest: Sha256Digest;
}>;

export type Sk104VerifiedSnapshotPort = Readonly<{
  withVerifiedExportedSnapshot(useSnapshot: (snapshot: string) => Promise<void>): Promise<void>;
}>;

function exactIso(value: string): void {
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString() !== value) {
    stopSk104("SK104_CONTRACT_INVALID");
  }
}

function backupPaths(directory: string, manifestDigest: Sha256Digest) {
  assertSha256Digest(manifestDigest);
  const stem = `sk104-${manifestDigest.slice("sha256:".length)}`;
  return {
    archive: join(directory, `${stem}.dump`),
    receipt: join(directory, `${stem}.backup.json`),
    staging: join(directory, `${stem}.backup-staging.json`),
    stagingPrefix: `.${stem}.dump-staging-`,
    publishPrefix: `.${stem}.dump-publish-`,
  };
}

function bindBackupStaging(body: BackupStagingBody, hmacKey: string): BackupStagingReceipt {
  if (hmacKey.length < 32) stopSk104("SK104_ENV_INVALID");
  assertSha256Digest(body.manifestDigest);
  assertSha256Digest(body.targetDatabaseFingerprint);
  assertProtectedToken(body.protectedSnapshot);
  exactIso(body.preparedAt);
  if (!/^\.sk104-[0-9a-f]{64}\.dump-staging-[0-9a-f]{32}$/.test(body.stagingArchiveName)) {
    stopSk104("SK104_CONTRACT_INVALID");
  }
  const completed =
    body.archiveFingerprint !== null ||
    body.archiveSizeBytes !== null ||
    body.archiveCreatesPublicSchema !== null;
  if (
    completed &&
    (typeof body.archiveFingerprint !== "string" ||
      typeof body.archiveSizeBytes !== "number" ||
      typeof body.archiveCreatesPublicSchema !== "boolean")
  ) {
    stopSk104("SK104_CONTRACT_INVALID");
  }
  if (body.archiveFingerprint !== null) assertSha256Digest(body.archiveFingerprint);
  if (
    body.archiveSizeBytes !== null &&
    (!Number.isSafeInteger(body.archiveSizeBytes) || body.archiveSizeBytes <= 5)
  ) {
    stopSk104("SK104_CONTRACT_INVALID");
  }
  return {
    ...body,
    bindingToken: protectValue(hmacKey, `sk104-database-backup-staging\0${canonicalJson(body)}`),
  };
}

async function readBackupStaging(
  input: Readonly<{
    path: string;
    hmacKey: string;
    manifest: Sk104ProductionManifest;
  }>,
): Promise<BackupStagingReceipt> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readOwnerOnlyUtf8(input.path)) as unknown;
  } catch {
    return stopSk104("SK104_CONTRACT_INVALID");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return stopSk104("SK104_CONTRACT_INVALID");
  }
  const candidate = parsed as Partial<BackupStagingReceipt>;
  if (
    candidate.contract !== "sk104-production-database-backup-staging-v1" ||
    typeof candidate.manifestDigest !== "string" ||
    typeof candidate.targetDatabaseFingerprint !== "string" ||
    typeof candidate.protectedSnapshot !== "string" ||
    typeof candidate.stagingArchiveName !== "string" ||
    typeof candidate.preparedAt !== "string" ||
    !(candidate.archiveFingerprint === null || typeof candidate.archiveFingerprint === "string") ||
    !(candidate.archiveSizeBytes === null || typeof candidate.archiveSizeBytes === "number") ||
    !(
      candidate.archiveCreatesPublicSchema === null ||
      typeof candidate.archiveCreatesPublicSchema === "boolean"
    ) ||
    typeof candidate.bindingToken !== "string"
  ) {
    return stopSk104("SK104_CONTRACT_INVALID");
  }
  const rebound = bindBackupStaging(
    {
      contract: "sk104-production-database-backup-staging-v1",
      manifestDigest: candidate.manifestDigest,
      targetDatabaseFingerprint: candidate.targetDatabaseFingerprint,
      protectedSnapshot: candidate.protectedSnapshot,
      stagingArchiveName: candidate.stagingArchiveName,
      preparedAt: candidate.preparedAt,
      archiveFingerprint: candidate.archiveFingerprint,
      archiveSizeBytes: candidate.archiveSizeBytes,
      archiveCreatesPublicSchema: candidate.archiveCreatesPublicSchema,
    },
    input.hmacKey,
  );
  if (
    canonicalJson(candidate) !== canonicalJson(rebound) ||
    !sameDigest(rebound.manifestDigest, input.manifest.digest) ||
    !sameDigest(
      rebound.targetDatabaseFingerprint,
      input.manifest.target.approvedDatabaseFingerprint,
    )
  ) {
    return stopSk104("SK104_DIGEST_MISMATCH");
  }
  return rebound;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return false;
    }
    stopSk104("SK104_CONTRACT_INVALID");
  }
}

/** Read only the exact pg_restore TOC entry that causes CREATE SCHEMA public. */
export function parseSk104PgRestoreList(
  restoreList: string,
): Readonly<{ archiveCreatesPublicSchema: boolean }> {
  if (typeof restoreList !== "string" || restoreList.includes("\0")) {
    stopSk104("SK104_CONTRACT_INVALID");
  }
  const publicSchemaEntries = restoreList
    .split(/\r?\n/)
    .filter((line) => /^\s*\d+;\s+\d+\s+\d+\s+SCHEMA\s+-\s+public(?:\s|$)/.test(line));
  if (publicSchemaEntries.length > 1) stopSk104("SK104_CONTRACT_INVALID");
  return { archiveCreatesPublicSchema: publicSchemaEntries.length === 1 };
}

function exactDatabaseName(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl);
    const databaseName = decodeURIComponent(url.pathname.slice(1));
    if (!/^[A-Za-z0-9_-]{1,63}$/.test(databaseName)) {
      stopSk104("SK104_ENV_INVALID");
    }
    return databaseName;
  } catch {
    return stopSk104("SK104_ENV_INVALID");
  }
}

export function sk104LibpqEnvironment(databaseUrl: string): NodeJS.ProcessEnv {
  try {
    const url = new URL(databaseUrl);
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      url.hostname.length === 0 ||
      url.username.length === 0 ||
      url.password.length === 0 ||
      url.hash.length !== 0
    ) {
      stopSk104("SK104_ENV_INVALID");
    }
    const port = url.port || "5432";
    if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65_535) {
      stopSk104("SK104_ENV_INVALID");
    }
    const databaseName = exactDatabaseName(databaseUrl);
    const allowedParameters = new Set(["sslmode", "channel_binding"]);
    for (const key of url.searchParams.keys()) {
      if (!allowedParameters.has(key) || url.searchParams.getAll(key).length !== 1) {
        stopSk104("SK104_ENV_INVALID");
      }
    }
    const sslMode = url.searchParams.get("sslmode");
    const channelBinding = url.searchParams.get("channel_binding");
    if (
      (sslMode !== null &&
        !["disable", "allow", "prefer", "require", "verify-ca", "verify-full"].includes(
          sslMode,
        )) ||
      (channelBinding !== null &&
        !["disable", "prefer", "require"].includes(channelBinding))
    ) {
      stopSk104("SK104_ENV_INVALID");
    }
    return {
      LC_ALL: "C",
      LANG: "C",
      NODE_ENV: "production",
      PGHOST: url.hostname,
      PGPORT: port,
      PGUSER: decodeURIComponent(url.username),
      PGPASSWORD: decodeURIComponent(url.password),
      PGDATABASE: databaseName,
      ...(sslMode === null ? {} : { PGSSLMODE: sslMode }),
      ...(channelBinding === null ? {} : { PGCHANNELBINDING: channelBinding }),
    };
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "SK104_ENV_INVALID"
    ) {
      throw error;
    }
    return stopSk104("SK104_ENV_INVALID");
  }
}

function exactAdvisoryLockKey(value: string): string {
  if (!/^[1-9]\d{0,18}$/.test(value) || BigInt(value) > 9_223_372_036_854_775_807n) {
    stopSk104("SK104_CONTRACT_INVALID");
  }
  if (
    value === SK104_RUN_LEASE_ADVISORY_LOCK_KEY ||
    value === SK104_CHILD_RESTORE_ADVISORY_LOCK_KEY ||
    value === SK104_DATABASE_ADVISORY_LOCK_KEY ||
    value === SK90_MIGRATION_ADVISORY_LOCK_KEY
  ) {
    stopSk104("SK104_CONTRACT_INVALID");
  }
  return value;
}

export function sk104PublicSchemaRestorePrelude(
  input: Readonly<{
    archiveCreatesPublicSchema: boolean;
    expectedDatabaseName: string;
    parentProofAdvisoryLockKey: string;
  }>,
): string {
  if (
    typeof input.archiveCreatesPublicSchema !== "boolean" ||
    !/^[A-Za-z0-9_-]{1,63}$/.test(input.expectedDatabaseName)
  ) {
    stopSk104("SK104_CONTRACT_INVALID");
  }
  const parentProofAdvisoryLockKey = exactAdvisoryLockKey(input.parentProofAdvisoryLockKey);
  const guard = `BEGIN;
DO $sk104_restore_guard$
DECLARE
  parent_lock_was_free boolean;
BEGIN
  IF NOT pg_try_advisory_xact_lock(${SK104_CHILD_RESTORE_ADVISORY_LOCK_KEY}) THEN
    RAISE EXCEPTION 'SK104_CHILD_RESTORE_LEASE_UNAVAILABLE';
  END IF;
  SELECT pg_try_advisory_xact_lock(${parentProofAdvisoryLockKey}) INTO parent_lock_was_free;
  IF parent_lock_was_free THEN
    RAISE EXCEPTION 'SK104_PARENT_LEASE_PROOF_INVALID';
  END IF;
  IF current_database() IS DISTINCT FROM '${input.expectedDatabaseName}' OR
     pg_is_in_recovery() OR
     current_setting('transaction_read_only') IS DISTINCT FROM 'off' OR
     NULLIF(current_setting('neon.project_id', true), '') IS NULL OR
     NULLIF(current_setting('neon.branch_id', true), '') IS NULL OR
     NULLIF(current_setting('neon.endpoint_id', true), '') IS NULL THEN
    RAISE EXCEPTION 'SK104_DATABASE_TARGET_INVALID';
  END IF;
END
$sk104_restore_guard$;
DROP SCHEMA IF EXISTS skitza_migrations CASCADE;
DROP SCHEMA IF EXISTS public CASCADE;
`;
  return input.archiveCreatesPublicSchema ? guard : `${guard}CREATE SCHEMA public;\n`;
}

export function sk104DatabaseBackupArchivePath(
  directory: string,
  manifestDigest: Sha256Digest,
): string {
  return backupPaths(directory, manifestDigest).archive;
}

async function archiveFingerprint(path: string): Promise<
  Readonly<{
    digest: Sha256Digest;
    sizeBytes: number;
  }>
> {
  const handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const before = await handle.stat({ bigint: true });
    if (
      !before.isFile() ||
      (before.mode & 0o077n) !== 0n ||
      before.size <= 5n ||
      before.size > BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      stopSk104("SK104_CONTRACT_INVALID");
    }
    const magic = Buffer.alloc(5);
    const result = await handle.read(magic, 0, magic.length, 0);
    if (result.bytesRead !== magic.length || magic.toString("ascii") !== "PGDMP") {
      stopSk104("SK104_CONTRACT_INVALID");
    }
    const hash = createHash("sha256").update(magic);
    const chunk = Buffer.allocUnsafe(64 * 1024);
    let sizeBytes = magic.byteLength;
    for (;;) {
      const next = await handle.read(chunk, 0, chunk.byteLength, sizeBytes);
      if (next.bytesRead === 0) break;
      sizeBytes += next.bytesRead;
      if (!Number.isSafeInteger(sizeBytes)) stopSk104("SK104_CONTRACT_INVALID");
      hash.update(chunk.subarray(0, next.bytesRead));
    }
    const after = await handle.stat({ bigint: true });
    if (
      BigInt(sizeBytes) !== before.size ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeNs !== before.mtimeNs ||
      after.ctimeNs !== before.ctimeNs ||
      !after.isFile() ||
      (after.mode & 0o077n) !== 0n
    ) {
      stopSk104("SK104_CONTRACT_INVALID");
    }
    return {
      digest: `sha256:${hash.digest("hex")}`,
      sizeBytes,
    };
  } finally {
    await handle.close();
  }
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

async function inspectStableStagingArchive(
  input: Readonly<{
    runtime: Sk104DatabaseBackupRuntime;
    pgRestoreBinary: string;
    stagingArchivePath: string;
  }>,
): Promise<
  Readonly<{
    archiveFingerprint: Sha256Digest;
    archiveSizeBytes: number;
    archiveCreatesPublicSchema: boolean;
  }>
> {
  const firstFingerprint = await archiveFingerprint(input.stagingArchivePath);
  const firstInspection = await input.runtime.verifyPgRestoreList({
    binary: input.pgRestoreBinary,
    archivePath: input.stagingArchivePath,
  });
  const secondFingerprint = await archiveFingerprint(input.stagingArchivePath);
  const secondInspection = await input.runtime.verifyPgRestoreList({
    binary: input.pgRestoreBinary,
    archivePath: input.stagingArchivePath,
  });
  if (
    typeof firstInspection.archiveCreatesPublicSchema !== "boolean" ||
    typeof secondInspection.archiveCreatesPublicSchema !== "boolean" ||
    !sameDigest(firstFingerprint.digest, secondFingerprint.digest) ||
    firstFingerprint.sizeBytes !== secondFingerprint.sizeBytes ||
    firstInspection.archiveCreatesPublicSchema !== secondInspection.archiveCreatesPublicSchema
  ) {
    stopSk104("SK104_CONTRACT_INVALID");
  }
  return {
    archiveFingerprint: secondFingerprint.digest,
    archiveSizeBytes: secondFingerprint.sizeBytes,
    archiveCreatesPublicSchema: secondInspection.archiveCreatesPublicSchema,
  };
}

async function publishVerifiedArchive(
  input: Readonly<{
    directory: string;
    finalArchivePath: string;
    publishPrefix: string;
    stagingArchivePath: string;
    expectedFingerprint: Sha256Digest;
    expectedSizeBytes: number;
  }>,
): Promise<void> {
  if (await pathExists(input.finalArchivePath)) {
    const existing = await archiveFingerprint(input.finalArchivePath);
    if (
      !sameDigest(existing.digest, input.expectedFingerprint) ||
      existing.sizeBytes !== input.expectedSizeBytes
    ) {
      stopSk104("SK104_DIGEST_MISMATCH");
    }
    return;
  }
  const publishPath = join(
    input.directory,
    `${input.publishPrefix}${randomBytes(16).toString("hex")}`,
  );
  try {
    await copyFile(input.stagingArchivePath, publishPath, fsConstants.COPYFILE_EXCL);
    await chmod(publishPath, 0o600);
    const publishHandle = await open(publishPath, "r");
    try {
      await publishHandle.sync();
    } finally {
      await publishHandle.close();
    }
    const copied = await archiveFingerprint(publishPath);
    if (
      !sameDigest(copied.digest, input.expectedFingerprint) ||
      copied.sizeBytes !== input.expectedSizeBytes
    ) {
      stopSk104("SK104_DIGEST_MISMATCH");
    }
    try {
      await link(publishPath, input.finalArchivePath);
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }
    const published = await archiveFingerprint(input.finalArchivePath);
    if (
      !sameDigest(published.digest, input.expectedFingerprint) ||
      published.sizeBytes !== input.expectedSizeBytes
    ) {
      stopSk104("SK104_DIGEST_MISMATCH");
    }
  } catch (error) {
    if (error instanceof Error && error.name === "Sk104CutoverSafetyError") throw error;
    stopSk104("SK104_CONTRACT_INVALID");
  } finally {
    try {
      await unlink(publishPath);
    } catch (error) {
      if (
        !(typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")
      ) {
        stopSk104("SK104_CONTRACT_INVALID");
      }
    }
  }
}

function finalBackupFromStaging(
  staging: BackupStagingReceipt,
  hmacKey: string,
): Sk104DatabaseBackupReceipt {
  if (
    staging.archiveFingerprint === null ||
    staging.archiveSizeBytes === null ||
    staging.archiveCreatesPublicSchema === null
  ) {
    stopSk104("SK104_CONTRACT_INVALID");
  }
  return bindBackup(
    {
      contract: BACKUP_CONTRACT,
      manifestDigest: staging.manifestDigest,
      targetDatabaseFingerprint: staging.targetDatabaseFingerprint,
      protectedSnapshot: staging.protectedSnapshot,
      archiveFingerprint: staging.archiveFingerprint,
      archiveSizeBytes: staging.archiveSizeBytes,
      restoreListVerified: true,
      archiveCreatesPublicSchema: staging.archiveCreatesPublicSchema,
      preparedAt: staging.preparedAt,
    },
    hmacKey,
  );
}

function bindBackup(body: BackupBody, hmacKey: string): Sk104DatabaseBackupReceipt {
  if (hmacKey.length < 32) stopSk104("SK104_ENV_INVALID");
  assertSha256Digest(body.manifestDigest);
  assertSha256Digest(body.targetDatabaseFingerprint);
  assertProtectedToken(body.protectedSnapshot);
  assertSha256Digest(body.archiveFingerprint);
  if (!Number.isSafeInteger(body.archiveSizeBytes) || body.archiveSizeBytes <= 5) {
    stopSk104("SK104_CONTRACT_INVALID");
  }
  if (typeof body.archiveCreatesPublicSchema !== "boolean") {
    stopSk104("SK104_CONTRACT_INVALID");
  }
  exactIso(body.preparedAt);
  const bindingToken = protectValue(hmacKey, `sk104-database-backup\0${canonicalJson(body)}`);
  return {
    ...body,
    bindingToken,
    restorePointFingerprint: sha256Digest(canonicalJson({ ...body, bindingToken })),
  };
}

export async function prepareSk104DatabaseBackup(
  input: Readonly<{
    manifest: Sk104ProductionManifest;
    targetDatabaseFingerprint: Sha256Digest;
    targetDatabaseUrl: string;
    privateBackupDirectory: string;
    pgDumpBinary: string;
    pgRestoreBinary: string;
    hmacKey: string;
    preparedAt: string;
    snapshotPort: Sk104VerifiedSnapshotPort;
    runtime?: Sk104DatabaseBackupRuntime;
  }>,
): Promise<Sk104DatabaseBackupReceipt> {
  assertSk104ProductionManifest(input.manifest);
  assertSha256Digest(input.targetDatabaseFingerprint);
  if (
    !sameDigest(input.targetDatabaseFingerprint, input.manifest.target.approvedDatabaseFingerprint)
  ) {
    stopSk104("SK104_TARGET_INVALID");
  }
  exactIso(input.preparedAt);
  await ensureOwnerOnlyDirectory(input.privateBackupDirectory, true);
  const paths = backupPaths(input.privateBackupDirectory, input.manifest.digest);
  const runtime = input.runtime ?? defaultSk104DatabaseBackupRuntime();
  const [archiveExists, receiptExists, stagingExists] = await Promise.all([
    pathExists(paths.archive),
    pathExists(paths.receipt),
    pathExists(paths.staging),
  ]);
  if (receiptExists) {
    if (!archiveExists) stopSk104("SK104_CONTRACT_INVALID");
    return verifySk104DatabaseBackup({
      manifest: input.manifest,
      privateBackupDirectory: input.privateBackupDirectory,
      hmacKey: input.hmacKey,
    });
  }
  if (stagingExists) {
    const staging = await readBackupStaging({
      path: paths.staging,
      hmacKey: input.hmacKey,
      manifest: input.manifest,
    });
    const stagingArchivePath = join(input.privateBackupDirectory, staging.stagingArchiveName);
    const completed =
      staging.archiveFingerprint !== null &&
      staging.archiveSizeBytes !== null &&
      staging.archiveCreatesPublicSchema !== null;
    if (completed && (await pathExists(stagingArchivePath))) {
      const inspected = await inspectStableStagingArchive({
        runtime,
        pgRestoreBinary: input.pgRestoreBinary,
        stagingArchivePath,
      });
      if (
        !sameDigest(inspected.archiveFingerprint, staging.archiveFingerprint) ||
        inspected.archiveSizeBytes !== staging.archiveSizeBytes ||
        inspected.archiveCreatesPublicSchema !== staging.archiveCreatesPublicSchema
      ) {
        stopSk104("SK104_DIGEST_MISMATCH");
      }
    } else if (completed && !archiveExists) {
      stopSk104("SK104_CONTRACT_INVALID");
    }
    if (completed) {
      await publishVerifiedArchive({
        directory: input.privateBackupDirectory,
        finalArchivePath: paths.archive,
        publishPrefix: paths.publishPrefix,
        stagingArchivePath,
        expectedFingerprint: staging.archiveFingerprint,
        expectedSizeBytes: staging.archiveSizeBytes,
      });
      const receipt = finalBackupFromStaging(staging, input.hmacKey);
      await writeOwnerOnlyUtf8Atomic(paths.receipt, canonicalJson(receipt));
      return receipt;
    }
    // An orphan pg_dump may still own this incomplete stage. Leave it
    // untouched and bind a fresh unique stage to a fresh exported snapshot.
    if (archiveExists) stopSk104("SK104_CONTRACT_INVALID");
  }
  if (archiveExists) stopSk104("SK104_CONTRACT_INVALID");

  let preparedReceipt: Sk104DatabaseBackupReceipt | undefined;
  await input.snapshotPort.withVerifiedExportedSnapshot(async (snapshot) => {
    if (typeof snapshot !== "string" || snapshot.length === 0 || snapshot.includes("\0")) {
      stopSk104("SK104_CONTRACT_INVALID");
    }
    const stagingArchiveName = `${paths.stagingPrefix}${randomBytes(16).toString("hex")}`;
    const stagingArchivePath = join(input.privateBackupDirectory, stagingArchiveName);
    let staging = bindBackupStaging(
      {
        contract: "sk104-production-database-backup-staging-v1",
        manifestDigest: input.manifest.digest,
        targetDatabaseFingerprint: input.targetDatabaseFingerprint,
        protectedSnapshot: protectValue(input.hmacKey, `sk104-pg-snapshot\0${snapshot}`),
        stagingArchiveName,
        preparedAt: input.preparedAt,
        archiveFingerprint: null,
        archiveSizeBytes: null,
        archiveCreatesPublicSchema: null,
      },
      input.hmacKey,
    );
    // The bound intent exists before pg_dump can outlive this process.
    await writeOwnerOnlyUtf8Atomic(paths.staging, canonicalJson(staging));
    const stagingArchive = await open(stagingArchivePath, "wx", 0o600);
    await stagingArchive.close();
    await runtime.runPgDump({
      binary: input.pgDumpBinary,
      databaseUrl: input.targetDatabaseUrl,
      snapshot,
      archivePath: stagingArchivePath,
    });
    const inspected = await inspectStableStagingArchive({
      runtime,
      pgRestoreBinary: input.pgRestoreBinary,
      stagingArchivePath,
    });
    staging = bindBackupStaging(
      {
        contract: staging.contract,
        manifestDigest: staging.manifestDigest,
        targetDatabaseFingerprint: staging.targetDatabaseFingerprint,
        protectedSnapshot: staging.protectedSnapshot,
        stagingArchiveName: staging.stagingArchiveName,
        preparedAt: staging.preparedAt,
        archiveFingerprint: inspected.archiveFingerprint,
        archiveSizeBytes: inspected.archiveSizeBytes,
        archiveCreatesPublicSchema: inspected.archiveCreatesPublicSchema,
      },
      input.hmacKey,
    );
    await writeOwnerOnlyUtf8Atomic(paths.staging, canonicalJson(staging));
    await publishVerifiedArchive({
      directory: input.privateBackupDirectory,
      finalArchivePath: paths.archive,
      publishPrefix: paths.publishPrefix,
      stagingArchivePath,
      expectedFingerprint: inspected.archiveFingerprint,
      expectedSizeBytes: inspected.archiveSizeBytes,
    });
    preparedReceipt = finalBackupFromStaging(staging, input.hmacKey);
    await writeOwnerOnlyUtf8Atomic(paths.receipt, canonicalJson(preparedReceipt));
    // pg_dump has exited, so these two private staging files are now safe to remove.
    await unlink(stagingArchivePath);
    await unlink(paths.staging);
  });
  return preparedReceipt ?? stopSk104("SK104_CONTRACT_INVALID");
}

export async function verifySk104DatabaseBackup(
  input: Readonly<{
    manifest: Sk104ProductionManifest;
    privateBackupDirectory: string;
    hmacKey: string;
  }>,
): Promise<Sk104DatabaseBackupReceipt> {
  assertSk104ProductionManifest(input.manifest);
  const paths = backupPaths(input.privateBackupDirectory, input.manifest.digest);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readOwnerOnlyUtf8(paths.receipt)) as unknown;
  } catch {
    stopSk104("SK104_CONTRACT_INVALID");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    stopSk104("SK104_CONTRACT_INVALID");
  }
  const candidate = parsed as Partial<Sk104DatabaseBackupReceipt>;
  if (
    candidate.contract !== BACKUP_CONTRACT ||
    typeof candidate.manifestDigest !== "string" ||
    typeof candidate.targetDatabaseFingerprint !== "string" ||
    typeof candidate.protectedSnapshot !== "string" ||
    typeof candidate.archiveFingerprint !== "string" ||
    typeof candidate.archiveSizeBytes !== "number" ||
    candidate.restoreListVerified !== true ||
    typeof candidate.archiveCreatesPublicSchema !== "boolean" ||
    typeof candidate.preparedAt !== "string" ||
    typeof candidate.bindingToken !== "string" ||
    typeof candidate.restorePointFingerprint !== "string"
  ) {
    stopSk104("SK104_CONTRACT_INVALID");
  }
  const rebound = bindBackup(
    {
      contract: BACKUP_CONTRACT,
      manifestDigest: candidate.manifestDigest,
      targetDatabaseFingerprint: candidate.targetDatabaseFingerprint,
      protectedSnapshot: candidate.protectedSnapshot,
      archiveFingerprint: candidate.archiveFingerprint,
      archiveSizeBytes: candidate.archiveSizeBytes,
      restoreListVerified: true,
      archiveCreatesPublicSchema: candidate.archiveCreatesPublicSchema,
      preparedAt: candidate.preparedAt,
    },
    input.hmacKey,
  );
  const observedArchive = await archiveFingerprint(paths.archive);
  if (
    canonicalJson(candidate) !== canonicalJson(rebound) ||
    !sameDigest(rebound.manifestDigest, input.manifest.digest) ||
    !sameDigest(
      rebound.targetDatabaseFingerprint,
      input.manifest.target.approvedDatabaseFingerprint,
    ) ||
    !sameDigest(observedArchive.digest, rebound.archiveFingerprint) ||
    observedArchive.sizeBytes !== rebound.archiveSizeBytes
  ) {
    stopSk104("SK104_DIGEST_MISMATCH");
  }
  return rebound;
}

export async function restoreSk104DatabaseBackup(
  input: Readonly<{
    manifest: Sk104ProductionManifest;
    targetDatabaseFingerprint: Sha256Digest;
    targetDatabaseUrl: string;
    privateBackupDirectory: string;
    pgRestoreBinary: string;
    psqlBinary: string;
    parentProofAdvisoryLockKey: string;
    assertAuthorizationFresh(): void | Promise<void>;
    hmacKey: string;
    restoredAt: string;
    runtime?: Sk104DatabaseBackupRuntime;
  }>,
): Promise<Sk104DatabaseRestoreReceipt> {
  const manifest = assertSk104ProductionManifest(input.manifest);
  assertSha256Digest(input.targetDatabaseFingerprint);
  if (!sameDigest(input.targetDatabaseFingerprint, manifest.target.approvedDatabaseFingerprint)) {
    stopSk104("SK104_TARGET_INVALID");
  }
  if (
    !isAbsolute(input.pgRestoreBinary) ||
    !isAbsolute(input.psqlBinary) ||
    input.pgRestoreBinary.includes("\0") ||
    input.psqlBinary.includes("\0") ||
    typeof input.assertAuthorizationFresh !== "function"
  ) {
    stopSk104("SK104_ENV_INVALID");
  }
  exactIso(input.restoredAt);
  const backup = await verifySk104DatabaseBackup({
    manifest,
    privateBackupDirectory: input.privateBackupDirectory,
    hmacKey: input.hmacKey,
  });
  await (input.runtime ?? defaultSk104DatabaseBackupRuntime()).runPgRestore({
    pgRestoreBinary: input.pgRestoreBinary,
    psqlBinary: input.psqlBinary,
    databaseUrl: input.targetDatabaseUrl,
    archivePath: backupPaths(input.privateBackupDirectory, manifest.digest).archive,
    archiveCreatesPublicSchema: backup.archiveCreatesPublicSchema,
    expectedDatabaseName: exactDatabaseName(input.targetDatabaseUrl),
    parentProofAdvisoryLockKey: exactAdvisoryLockKey(input.parentProofAdvisoryLockKey),
    assertAuthorizationFresh: input.assertAuthorizationFresh,
  });
  const body = {
    contract: "sk104-production-database-restore-v1" as const,
    manifestDigest: manifest.digest,
    targetDatabaseFingerprint: input.targetDatabaseFingerprint,
    backupRestorePointFingerprint: backup.restorePointFingerprint,
    restoredAt: input.restoredAt,
  };
  return { ...body, receiptDigest: sha256Digest(canonicalJson(body)) };
}

export function defaultSk104DatabaseBackupRuntime(): Sk104DatabaseBackupRuntime {
  const commandFailure = () => new Error("SK104_BACKUP_COMMAND_FAILED");
  const commandSucceeded = (child: ReturnType<typeof spawn>) =>
    new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (succeeded: boolean) => {
        if (settled) return;
        settled = true;
        resolve(succeeded);
      };
      child.once("error", () => {
        finish(false);
      });
      child.once("close", (code: number | null, signal: NodeJS.Signals | null) => {
        finish(code === 0 && signal === null);
      });
    });
  const spawnOptions = (env: NodeJS.ProcessEnv) => ({
    env,
    shell: false as const,
    windowsHide: true,
  });
  const run = async (
    binary: string,
    args: readonly string[],
    env: NodeJS.ProcessEnv,
    outputFd?: number,
  ): Promise<void> => {
    const child = spawn(binary, [...args], {
      ...spawnOptions(env),
      stdio: outputFd === undefined ? "ignore" : ["ignore", outputFd, "ignore"],
    });
    if (!(await commandSucceeded(child))) throw commandFailure();
  };
  const capture = async (
    binary: string,
    args: readonly string[],
    env: NodeJS.ProcessEnv,
  ): Promise<string> => {
    const child = spawn(binary, [...args], {
      ...spawnOptions(env),
      stdio: ["ignore", "pipe", "ignore"],
    });
    const output = child.stdout;
    const chunks: Buffer[] = [];
    let sizeBytes = 0;
    const outputState = { failed: false };
    output.on("data", (chunk: Buffer) => {
      if (outputState.failed) return;
      if (!(chunk instanceof Buffer)) {
        outputState.failed = true;
        child.kill("SIGTERM");
        return;
      }
      sizeBytes += chunk.byteLength;
      if (sizeBytes > MAX_PG_RESTORE_LIST_BYTES) {
        outputState.failed = true;
        child.kill("SIGTERM");
        return;
      }
      chunks.push(chunk);
    });
    output.once("error", () => {
      outputState.failed = true;
      child.kill("SIGTERM");
    });
    if (!(await commandSucceeded(child)) || outputState.failed) throw commandFailure();
    return Buffer.concat(chunks, sizeBytes).toString("utf8");
  };
  const writeInput = (input: Writable, chunk: string | Buffer): Promise<void> =>
    new Promise((resolve, reject) => {
      input.write(chunk, (error) => {
        if (error) reject(commandFailure());
        else resolve();
      });
    });
  const endInput = (input: Writable): Promise<void> =>
    new Promise((resolve) => {
      input.end(resolve);
    });
  const applyGeneratedRestore = async (
    input: Readonly<{
      psqlBinary: string;
      databaseUrl: string;
      restoreSqlPath: string;
      archiveCreatesPublicSchema: boolean;
      expectedDatabaseName: string;
      parentProofAdvisoryLockKey: string;
      assertAuthorizationFresh(): void | Promise<void>;
    }>,
  ): Promise<void> => {
    const child = spawn(
      input.psqlBinary,
      ["--no-psqlrc", "--no-password", "--set=ON_ERROR_STOP=1", "--set=VERBOSITY=terse", "--quiet"],
      {
        ...spawnOptions(sk104LibpqEnvironment(input.databaseUrl)),
        stdio: ["pipe", "ignore", "ignore"],
      },
    );
    const completion = commandSucceeded(child);
    const childInput = child.stdin;
    // A broken psql pipe is reported through write callbacks and process status.
    childInput.on("error", () => undefined);
    try {
      await input.assertAuthorizationFresh();
      await writeInput(
        childInput,
        sk104PublicSchemaRestorePrelude({
          archiveCreatesPublicSchema: input.archiveCreatesPublicSchema,
          expectedDatabaseName: input.expectedDatabaseName,
          parentProofAdvisoryLockKey: input.parentProofAdvisoryLockKey,
        }),
      );
      for await (const chunk of createReadStream(input.restoreSqlPath)) {
        if (!(chunk instanceof Buffer)) throw commandFailure();
        await writeInput(childInput, chunk);
      }
      await input.assertAuthorizationFresh();
      await writeInput(childInput, "\nCOMMIT;\n");
      await endInput(childInput);
      if (!(await completion)) throw commandFailure();
    } catch {
      childInput.destroy();
      child.kill("SIGTERM");
      await completion;
      throw commandFailure();
    }
  };
  const restorePublicSchema = async (
    input: Readonly<{
      pgRestoreBinary: string;
      psqlBinary: string;
      databaseUrl: string;
      archivePath: string;
      archiveCreatesPublicSchema: boolean;
      expectedDatabaseName: string;
      parentProofAdvisoryLockKey: string;
      assertAuthorizationFresh(): void | Promise<void>;
    }>,
  ): Promise<void> => {
    const restoreSqlPath = join(
      dirname(input.archivePath),
      `.sk104-restore-${randomBytes(16).toString("hex")}.sql`,
    );
    const restoreSql = await open(restoreSqlPath, "wx", 0o600).catch(() => {
      throw commandFailure();
    });
    let restoreFailed = false;
    try {
      try {
        await run(
          input.pgRestoreBinary,
          [
            "--exit-on-error",
            "--schema=public",
            "--strict-names",
            input.archivePath,
          ],
          { LC_ALL: "C", LANG: "C", NODE_ENV: "production" },
          restoreSql.fd,
        );
        await restoreSql.sync();
      } finally {
        await restoreSql.close();
      }
      const status = await lstat(restoreSqlPath);
      if (!status.isFile() || status.size === 0 || (status.mode & 0o077) !== 0) {
        throw commandFailure();
      }
      await applyGeneratedRestore({
        psqlBinary: input.psqlBinary,
        databaseUrl: input.databaseUrl,
        restoreSqlPath,
        archiveCreatesPublicSchema: input.archiveCreatesPublicSchema,
        expectedDatabaseName: input.expectedDatabaseName,
        parentProofAdvisoryLockKey: input.parentProofAdvisoryLockKey,
        assertAuthorizationFresh: input.assertAuthorizationFresh,
      });
    } catch {
      restoreFailed = true;
    }
    // The generated script may contain production data and must never persist.
    try {
      await unlink(restoreSqlPath);
    } catch {
      restoreFailed = true;
    }
    if (restoreFailed) throw commandFailure();
  };
  return {
    runPgDump: ({ binary, databaseUrl, snapshot, archivePath }) =>
      run(
        binary,
        [
          "--format=custom",
          `--file=${archivePath}`,
          `--snapshot=${snapshot}`,
          "--schema=public",
          "--strict-names",
        ],
        sk104LibpqEnvironment(databaseUrl),
      ),
    verifyPgRestoreList: async ({ binary, archivePath }) =>
      parseSk104PgRestoreList(
        await capture(binary, ["--list", archivePath], {
          LC_ALL: "C",
          LANG: "C",
          NODE_ENV: "production",
        }),
      ),
    runPgRestore: restorePublicSchema,
  };
}
