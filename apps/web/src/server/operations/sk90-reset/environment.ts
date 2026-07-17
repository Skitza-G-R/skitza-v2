import { isAbsolute, relative, resolve } from "node:path";

import { assertSha256Digest, type Sha256Digest } from "./canonical";
import { stop } from "./errors";

export const SK90_REHEARSAL_ENV = {
  targetDatabaseUrl: "SK90_REHEARSAL_TARGET_DATABASE_URL",
  targetDatabaseFingerprint: "SK90_REHEARSAL_TARGET_DATABASE_FINGERPRINT",
  targetStorageFingerprint: "SK90_REHEARSAL_TARGET_STORAGE_FINGERPRINT",
  targetStorageNamespace: "SK90_REHEARSAL_TARGET_STORAGE_NAMESPACE",
  manifestHmacKey: "SK90_REHEARSAL_MANIFEST_HMAC_KEY",
  approvalPolicyDigest: "SK90_REHEARSAL_APPROVAL_POLICY_DIGEST",
} as const;

export const SK90_EXECUTABLE_REHEARSAL_ENV = {
  storageEndpoint: "SK90_REHEARSAL_STORAGE_ENDPOINT",
  storageAccessKeyId: "SK90_REHEARSAL_STORAGE_ACCESS_KEY_ID",
  storageSecretAccessKey: "SK90_REHEARSAL_STORAGE_SECRET_ACCESS_KEY",
  storageAudioBucket: "SK90_REHEARSAL_STORAGE_AUDIO_BUCKET",
  storageDocsBucket: "SK90_REHEARSAL_STORAGE_DOCS_BUCKET",
  storageDataPrefix: "SK90_REHEARSAL_STORAGE_DATA_PREFIX",
  storageRecoveryPrefix: "SK90_REHEARSAL_STORAGE_RECOVERY_PREFIX",
  privateApprovalFile: "SK90_REHEARSAL_PRIVATE_APPROVAL_FILE",
  privateApprovalLedgerDirectory: "SK90_REHEARSAL_PRIVATE_APPROVAL_LEDGER_DIRECTORY",
  privateStateDirectory: "SK90_REHEARSAL_PRIVATE_STATE_DIRECTORY",
  pgDumpBinary: "SK90_REHEARSAL_PG_DUMP_BINARY",
  pgRestoreBinary: "SK90_REHEARSAL_PG_RESTORE_BINARY",
  operatorConfirmation: "SK90_REHEARSAL_OPERATOR_CONFIRMATION",
  approvedExecutionDigest: "SK90_REHEARSAL_APPROVED_EXECUTION_DIGEST",
} as const;

/**
 * These familiar variables are intentionally rejected, not merely ignored.
 * That makes an inherited production shell fail before a caller can pass its
 * parsed configuration to a future database or storage adapter.
 */
export const FORBIDDEN_AMBIENT_ENV_NAMES = [
  "DATABASE_URL",
  "DATABASE_URL_NEON",
  "DATABASE_URL_UNPOOLED",
  "POSTGRES_URL",
  "POSTGRES_URL_NON_POOLING",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_AUDIO",
  "R2_BUCKET_DOCS",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_PROFILE",
  "AWS_DEFAULT_PROFILE",
  "PGHOST",
  "PGPORT",
  "PGDATABASE",
  "PGUSER",
  "PGPASSWORD",
  "PGSERVICE",
  "PGPASSFILE",
] as const;

export type RehearsalEnvironment = Readonly<{
  targetDatabaseUrl: string;
  targetDatabaseFingerprint: Sha256Digest;
  targetStorageFingerprint: Sha256Digest;
  targetStorageNamespace: string;
  manifestHmacKey: string;
  approvalPolicyDigest: Sha256Digest;
}>;

export type ExecutableRehearsalMode = "plan" | "execute" | "resume" | "restore";
export type BackupPreparationMode = "prepare-backup";

export type ExecutableRehearsalEnvironment = RehearsalEnvironment &
  Readonly<{
    storage: Readonly<{
      endpoint: string;
      accessKeyId: string;
      secretAccessKey: string;
      audioBucket: string;
      docsBucket: string;
      dataPrefix: string;
      recoveryPrefix: string;
    }>;
    privateApprovalFile: string;
    privateApprovalLedgerDirectory: string;
    privateStateDirectory: string;
    pgDumpBinary: string;
    pgRestoreBinary: string;
    approvedExecutionDigest: Sha256Digest;
  }>;

export type BackupPreparationEnvironment = Omit<
  ExecutableRehearsalEnvironment,
  "approvedExecutionDigest"
>;

type EnvironmentMap = Readonly<Record<string, string | undefined>>;

function required(environment: EnvironmentMap, name: string): string {
  const value = environment[name]?.trim();
  if (!value) stop("REHEARSAL_ENV_MISSING");
  return value;
}

function assertPrivatePostgresUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    stop("REHEARSAL_ENV_INVALID");
  }

  if (
    (url.protocol !== "postgres:" && url.protocol !== "postgresql:") ||
    !url.hostname ||
    !url.pathname ||
    url.pathname === "/"
  ) {
    stop("REHEARSAL_ENV_INVALID");
  }
}

function assertIsolatedNamespace(value: string): void {
  if (!/^sk90-rehearsal\/[a-z0-9][a-z0-9-]{7,63}$/.test(value)) {
    stop("REHEARSAL_ENV_INVALID");
  }
}

/**
 * Parse only dedicated SK-90 rehearsal names. This function performs no I/O
 * and callers must pass an environment map explicitly.
 */
export function readRehearsalEnvironment(environment: EnvironmentMap): RehearsalEnvironment {
  if (FORBIDDEN_AMBIENT_ENV_NAMES.some((name) => Boolean(environment[name]?.trim()))) {
    stop("AMBIENT_ENV_FORBIDDEN");
  }

  const targetDatabaseUrl = required(environment, SK90_REHEARSAL_ENV.targetDatabaseUrl);
  const targetDatabaseFingerprint = required(
    environment,
    SK90_REHEARSAL_ENV.targetDatabaseFingerprint,
  );
  const targetStorageFingerprint = required(
    environment,
    SK90_REHEARSAL_ENV.targetStorageFingerprint,
  );
  const targetStorageNamespace = required(environment, SK90_REHEARSAL_ENV.targetStorageNamespace);
  const manifestHmacKey = required(environment, SK90_REHEARSAL_ENV.manifestHmacKey);
  const approvalPolicyDigest = required(environment, SK90_REHEARSAL_ENV.approvalPolicyDigest);

  assertPrivatePostgresUrl(targetDatabaseUrl);
  assertSha256Digest(targetDatabaseFingerprint);
  assertSha256Digest(targetStorageFingerprint);
  assertSha256Digest(approvalPolicyDigest);
  assertIsolatedNamespace(targetStorageNamespace);
  if (manifestHmacKey.length < 32) stop("REHEARSAL_ENV_INVALID");

  return {
    targetDatabaseUrl,
    targetDatabaseFingerprint,
    targetStorageFingerprint,
    targetStorageNamespace,
    manifestHmacKey,
    approvalPolicyDigest,
  };
}

function assertStorageEndpoint(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    stop("REHEARSAL_ENV_INVALID");
  }
  if (
    url.protocol !== "https:" ||
    !url.hostname ||
    !/^[0-9a-f]{32}\.r2\.cloudflarestorage\.com$/.test(url.hostname) ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    (url.pathname !== "" && url.pathname !== "/") ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    stop("REHEARSAL_ENV_INVALID");
  }
}

function assertBucketName(value: string): void {
  if (
    !/^(?!\d{1,3}(?:\.\d{1,3}){3}$)[a-z0-9](?:[a-z0-9.-]{1,61}[a-z0-9])$/.test(value) ||
    value.includes("..") ||
    value.includes(".-") ||
    value.includes("-.")
  ) {
    stop("REHEARSAL_ENV_INVALID");
  }
}

function exactPrefix(value: string, namespace: string): string {
  const normalized = value.replace(/\/+$/, "");
  if (
    !normalized.startsWith(`${namespace}/`) ||
    !/^[a-z0-9][a-z0-9/_-]*$/.test(normalized) ||
    normalized.includes("//") ||
    normalized.includes("..")
  ) {
    stop("REHEARSAL_ENV_INVALID");
  }
  return `${normalized}/`;
}

function absolutePrivatePath(value: string): string {
  if (!isAbsolute(value) || value.includes("\0")) stop("REHEARSAL_ENV_INVALID");
  return resolve(value);
}

function pathContains(parent: string, candidate: string): boolean {
  const child = relative(parent, candidate);
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

/**
 * Parse the concrete adapter boundary without performing filesystem, database,
 * or storage I/O. Every mode requires the separately approved execution
 * digest because even `plan` initializes a globally bound durable journal.
 */
export function readExecutableRehearsalEnvironment(
  environment: EnvironmentMap,
  mode: ExecutableRehearsalMode,
): ExecutableRehearsalEnvironment;
export function readExecutableRehearsalEnvironment(
  environment: EnvironmentMap,
  mode: BackupPreparationMode,
): BackupPreparationEnvironment;
export function readExecutableRehearsalEnvironment(
  environment: EnvironmentMap,
  mode: ExecutableRehearsalMode | BackupPreparationMode,
): ExecutableRehearsalEnvironment | BackupPreparationEnvironment {
  const untrustedMode: unknown = mode;
  if (
    untrustedMode !== "plan" &&
    untrustedMode !== "execute" &&
    untrustedMode !== "resume" &&
    untrustedMode !== "restore" &&
    untrustedMode !== "prepare-backup"
  ) {
    stop("REHEARSAL_ENV_INVALID");
  }
  const core = readRehearsalEnvironment(environment);
  const endpoint = required(environment, SK90_EXECUTABLE_REHEARSAL_ENV.storageEndpoint);
  const accessKeyId = required(environment, SK90_EXECUTABLE_REHEARSAL_ENV.storageAccessKeyId);
  const secretAccessKey = required(
    environment,
    SK90_EXECUTABLE_REHEARSAL_ENV.storageSecretAccessKey,
  );
  const audioBucket = required(environment, SK90_EXECUTABLE_REHEARSAL_ENV.storageAudioBucket);
  const docsBucket = required(environment, SK90_EXECUTABLE_REHEARSAL_ENV.storageDocsBucket);
  const dataPrefix = exactPrefix(
    required(environment, SK90_EXECUTABLE_REHEARSAL_ENV.storageDataPrefix),
    core.targetStorageNamespace,
  );
  const recoveryPrefix = exactPrefix(
    required(environment, SK90_EXECUTABLE_REHEARSAL_ENV.storageRecoveryPrefix),
    core.targetStorageNamespace,
  );
  const privateApprovalFile = absolutePrivatePath(
    required(environment, SK90_EXECUTABLE_REHEARSAL_ENV.privateApprovalFile),
  );
  const privateApprovalLedgerDirectory = absolutePrivatePath(
    required(environment, SK90_EXECUTABLE_REHEARSAL_ENV.privateApprovalLedgerDirectory),
  );
  const privateStateDirectory = absolutePrivatePath(
    required(environment, SK90_EXECUTABLE_REHEARSAL_ENV.privateStateDirectory),
  );
  const pgDumpBinary = absolutePrivatePath(
    required(environment, SK90_EXECUTABLE_REHEARSAL_ENV.pgDumpBinary),
  );
  const pgRestoreBinary = absolutePrivatePath(
    required(environment, SK90_EXECUTABLE_REHEARSAL_ENV.pgRestoreBinary),
  );
  const operatorConfirmation = required(
    environment,
    SK90_EXECUTABLE_REHEARSAL_ENV.operatorConfirmation,
  );
  const approvedExecutionDigestValue =
    environment[SK90_EXECUTABLE_REHEARSAL_ENV.approvedExecutionDigest]?.trim() ?? "";

  assertStorageEndpoint(endpoint);
  assertBucketName(audioBucket);
  assertBucketName(docsBucket);
  if (
    audioBucket === docsBucket ||
    dataPrefix !== `${core.targetStorageNamespace}/data/` ||
    recoveryPrefix !== `${core.targetStorageNamespace}/recovery/` ||
    dataPrefix === recoveryPrefix ||
    dataPrefix.startsWith(recoveryPrefix) ||
    recoveryPrefix.startsWith(dataPrefix) ||
    privateApprovalFile === privateStateDirectory ||
    pathContains(privateApprovalLedgerDirectory, privateApprovalFile) ||
    pathContains(privateApprovalLedgerDirectory, privateStateDirectory) ||
    pathContains(privateStateDirectory, privateApprovalLedgerDirectory) ||
    accessKeyId.length < 16 ||
    secretAccessKey.length < 32 ||
    operatorConfirmation !== "isolated-nonproduction-only"
  ) {
    stop("REHEARSAL_ENV_INVALID");
  }

  if (mode === "prepare-backup") {
    if (approvedExecutionDigestValue) stop("EXECUTION_APPROVAL_MISMATCH");
    return {
      ...core,
      storage: {
        endpoint,
        accessKeyId,
        secretAccessKey,
        audioBucket,
        docsBucket,
        dataPrefix,
        recoveryPrefix,
      },
      privateApprovalFile,
      privateApprovalLedgerDirectory,
      privateStateDirectory,
      pgDumpBinary,
      pgRestoreBinary,
    };
  }

  if (!approvedExecutionDigestValue) stop("REHEARSAL_ENV_MISSING");
  assertSha256Digest(approvedExecutionDigestValue);
  const approvedExecutionDigest = approvedExecutionDigestValue;

  return {
    ...core,
    storage: {
      endpoint,
      accessKeyId,
      secretAccessKey,
      audioBucket,
      docsBucket,
      dataPrefix,
      recoveryPrefix,
    },
    privateApprovalFile,
    privateApprovalLedgerDirectory,
    privateStateDirectory,
    pgDumpBinary,
    pgRestoreBinary,
    approvedExecutionDigest,
  };
}
