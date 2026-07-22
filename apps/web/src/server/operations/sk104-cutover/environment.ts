import { isAbsolute, relative, resolve } from "node:path";

import { isSha256Digest, sameDigest, type Sha256Digest } from "../sk90-reset/canonical";
import {
  SK104_CANONICAL_DATABASE_FINGERPRINT,
  SK104_FROZEN_DATABASE_FINGERPRINT,
  type ApprovedProductionTargetBoundary,
} from "./target-observer";

export const SK104_CUTOVER_ENV = {
  targetClass: "SK104_CUTOVER_TARGET_CLASS",
  targetDatabaseUrl: "SK104_CUTOVER_TARGET_DATABASE_URL",
  approvedDatabaseFingerprint: "SK104_CUTOVER_APPROVED_DATABASE_FINGERPRINT",
  forbiddenDatabaseFingerprint: "SK104_CUTOVER_FORBIDDEN_DATABASE_FINGERPRINT",
  targetSchemaFingerprint: "SK104_CUTOVER_TARGET_SCHEMA_FINGERPRINT",
  approvedStorageFingerprint: "SK104_CUTOVER_APPROVED_STORAGE_FINGERPRINT",
  forbiddenStorageFingerprint: "SK104_CUTOVER_FORBIDDEN_STORAGE_FINGERPRINT",
  manifestHmacKey: "SK104_CUTOVER_MANIFEST_HMAC_KEY",
  approvalPolicyDigest: "SK104_CUTOVER_APPROVAL_POLICY_DIGEST",
  storageEndpoint: "SK104_CUTOVER_STORAGE_ENDPOINT",
  storageAccessKeyId: "SK104_CUTOVER_STORAGE_ACCESS_KEY_ID",
  storageSecretAccessKey: "SK104_CUTOVER_STORAGE_SECRET_ACCESS_KEY",
  storageAudioBucket: "SK104_CUTOVER_STORAGE_AUDIO_BUCKET",
  storageDocsBucket: "SK104_CUTOVER_STORAGE_DOCS_BUCKET",
  storageRecoveryPrefix: "SK104_CUTOVER_STORAGE_RECOVERY_PREFIX",
  privateApprovalFile: "SK104_CUTOVER_PRIVATE_APPROVAL_FILE",
  privateApprovalLedgerDirectory: "SK104_CUTOVER_PRIVATE_APPROVAL_LEDGER_DIRECTORY",
  privateStateDirectory: "SK104_CUTOVER_PRIVATE_STATE_DIRECTORY",
  pgDumpBinary: "SK104_CUTOVER_PG_DUMP_BINARY",
  pgRestoreBinary: "SK104_CUTOVER_PG_RESTORE_BINARY",
  psqlBinary: "SK104_CUTOVER_PSQL_BINARY",
  operatorConfirmation: "SK104_CUTOVER_OPERATOR_CONFIRMATION",
  mockTestAttestation: "SK104_CUTOVER_MOCK_TEST_ATTESTATION",
  noWriterConfirmation: "SK104_CUTOVER_NO_WRITER_CONFIRMATION",
  releaseCommit: "SK104_CUTOVER_RELEASE_COMMIT",
  approvedExecutionDigest: "SK104_CUTOVER_APPROVED_EXECUTION_DIGEST",
  userApprovedPlanDigest: "SK104_CUTOVER_USER_APPROVED_PLAN_DIGEST",
} as const;

export const SK104_FORBIDDEN_AMBIENT_ENV_NAMES = [
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

export const SK104_OPERATOR_CONFIRMATION = "approved-production-cutover-sk104" as const;
export const SK104_MOCK_TEST_ATTESTATION = "all-current-activity-is-approved-mock-test" as const;
export const SK104_NO_WRITER_CONFIRMATION = "approved-no-writers-during-sk104-cutover" as const;

export const SK104_CUTOVER_ERROR_CODES = [
  "SK104_AMBIENT_ENV_FORBIDDEN",
  "SK104_ENV_MISSING",
  "SK104_ENV_INVALID",
  "SK104_TARGET_INVALID",
  "SK104_CONTRACT_INVALID",
  "SK104_DIGEST_MISMATCH",
  "SK104_APPROVAL_INVALID",
  "SK104_APPROVAL_EXPIRED",
] as const;

export type Sk104CutoverErrorCode = (typeof SK104_CUTOVER_ERROR_CODES)[number];

const SAFE_MESSAGES: Readonly<Record<Sk104CutoverErrorCode, string>> = {
  SK104_AMBIENT_ENV_FORBIDDEN: "Generic connection environment is present; cutover stopped.",
  SK104_ENV_MISSING: "Required production-cutover configuration is missing.",
  SK104_ENV_INVALID: "Production-cutover configuration is invalid.",
  SK104_TARGET_INVALID: "The production target boundary is invalid.",
  SK104_CONTRACT_INVALID: "The production-cutover contract is invalid.",
  SK104_DIGEST_MISMATCH: "The production-cutover digest does not match its content.",
  SK104_APPROVAL_INVALID: "The production-cutover approval is invalid.",
  SK104_APPROVAL_EXPIRED: "The production-cutover approval is not currently valid.",
};

export class Sk104CutoverSafetyError extends Error {
  readonly code: Sk104CutoverErrorCode;

  constructor(code: Sk104CutoverErrorCode) {
    super(SAFE_MESSAGES[code]);
    this.name = "Sk104CutoverSafetyError";
    this.code = code;
  }
}

export function stopSk104(code: Sk104CutoverErrorCode): never {
  throw new Sk104CutoverSafetyError(code);
}

export type Sk104CutoverMode =
  | "inspect"
  | "prepare-backup"
  | "plan"
  | "authorize-execute"
  | "authorize-restore"
  | "execute"
  | "resume"
  | "restore";

export type Sk104CutoverEnvironment = ApprovedProductionTargetBoundary &
  Readonly<{
    targetDatabaseUrl: string;
    targetSchemaFingerprint: Sha256Digest;
    approvedStorageFingerprint: Sha256Digest;
    forbiddenStorageFingerprint: Sha256Digest;
    manifestHmacKey: string;
    approvalPolicyDigest: Sha256Digest;
    storage: Readonly<{
      endpoint: string;
      accessKeyId: string;
      secretAccessKey: string;
      audioBucket: string;
      docsBucket: string;
      recoveryPrefix: string;
    }>;
    privateApprovalFile: string;
    privateApprovalLedgerDirectory: string;
    privateStateDirectory: string;
    pgDumpBinary: string;
    pgRestoreBinary: string;
    psqlBinary: string;
    releaseCommit: string;
    noWriterConfirmed: boolean;
    approvedExecutionDigest: Sha256Digest | null;
    userApprovedPlanDigest: Sha256Digest | null;
  }>;

type EnvironmentMap = Readonly<Record<string, string | undefined>>;

const EXECUTION_MODES = new Set<Sk104CutoverMode>(["execute", "resume", "restore"]);
const AUTHORIZATION_MODES = new Set<Sk104CutoverMode>(["authorize-execute", "authorize-restore"]);

function required(environment: EnvironmentMap, name: string): string {
  const value = environment[name]?.trim();
  if (!value) stopSk104("SK104_ENV_MISSING");
  return value;
}

function digest(environment: EnvironmentMap, name: string): Sha256Digest {
  const value = required(environment, name);
  if (!isSha256Digest(value)) stopSk104("SK104_ENV_INVALID");
  return value;
}

function assertPostgresUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    stopSk104("SK104_ENV_INVALID");
  }
  let databaseName = "";
  try {
    databaseName = decodeURIComponent(url.pathname.slice(1));
  } catch {
    stopSk104("SK104_ENV_INVALID");
  }
  const allowedSearchNames = new Set(["sslmode", "channel_binding"]);
  const searchNames = [...url.searchParams.keys()];
  const sslMode = url.searchParams.get("sslmode");
  const channelBinding = url.searchParams.get("channel_binding");
  if (
    (url.protocol !== "postgres:" && url.protocol !== "postgresql:") ||
    !url.hostname ||
    !url.hostname.endsWith(".neon.tech") ||
    !/^ep-[a-z0-9-]+$/.test(url.hostname.split(".")[0] ?? "") ||
    (url.hostname.split(".")[0] ?? "").endsWith("-pooler") ||
    !url.pathname ||
    url.pathname === "/" ||
    !/^[A-Za-z0-9_-]{1,63}$/.test(databaseName) ||
    !url.username ||
    !url.password ||
    [url.username, url.password].some((part) => /[\0\r\n]/.test(part)) ||
    (url.port !== "" &&
      (!/^\d{1,5}$/.test(url.port) || Number(url.port) < 1 || Number(url.port) > 65_535)) ||
    url.hash !== "" ||
    searchNames.some((name) => !allowedSearchNames.has(name)) ||
    [...allowedSearchNames].some((name) => url.searchParams.getAll(name).length > 1) ||
    (sslMode !== "require" && sslMode !== "verify-full") ||
    (channelBinding !== null && channelBinding !== "require")
  ) {
    stopSk104("SK104_ENV_INVALID");
  }
}

function assertStorageEndpoint(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    stopSk104("SK104_ENV_INVALID");
  }
  if (
    url.protocol !== "https:" ||
    !/^[0-9a-f]{32}\.r2\.cloudflarestorage\.com$/.test(url.hostname) ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    (url.pathname !== "" && url.pathname !== "/") ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    stopSk104("SK104_ENV_INVALID");
  }
}

function assertBucketName(value: string): void {
  if (
    !/^(?!\d{1,3}(?:\.\d{1,3}){3}$)[a-z0-9](?:[a-z0-9.-]{1,61}[a-z0-9])$/.test(value) ||
    value.includes("..") ||
    value.includes(".-") ||
    value.includes("-.")
  ) {
    stopSk104("SK104_ENV_INVALID");
  }
}

function recoveryPrefix(value: string): string {
  const normalized = value.replace(/^\/+/, "").replace(/\/+$/, "");
  if (
    !/^sk104-cutover\/[a-z0-9][a-z0-9-]{7,63}\/recovery$/.test(normalized) ||
    normalized.includes("..") ||
    normalized.includes("//")
  ) {
    stopSk104("SK104_ENV_INVALID");
  }
  return `${normalized}/`;
}

function absolutePrivatePath(value: string): string {
  if (!isAbsolute(value) || value.includes("\0")) stopSk104("SK104_ENV_INVALID");
  return resolve(value);
}

function contains(parent: string, candidate: string): boolean {
  const child = relative(parent, candidate);
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

function assertMode(mode: string): asserts mode is Sk104CutoverMode {
  if (
    mode !== "inspect" &&
    mode !== "prepare-backup" &&
    mode !== "plan" &&
    mode !== "authorize-execute" &&
    mode !== "authorize-restore" &&
    mode !== "execute" &&
    mode !== "resume" &&
    mode !== "restore"
  ) {
    stopSk104("SK104_ENV_INVALID");
  }
}

/** Parse only dedicated production-cutover names and perform no I/O. */
export function readSk104CutoverEnvironment(
  environment: EnvironmentMap,
  mode: Sk104CutoverMode,
): Sk104CutoverEnvironment {
  assertMode(mode);
  if (SK104_FORBIDDEN_AMBIENT_ENV_NAMES.some((name) => Boolean(environment[name]?.trim()))) {
    stopSk104("SK104_AMBIENT_ENV_FORBIDDEN");
  }

  const targetClass = required(environment, SK104_CUTOVER_ENV.targetClass);
  const operatorConfirmation = required(environment, SK104_CUTOVER_ENV.operatorConfirmation);
  if (
    targetClass !== "canonical_production" ||
    operatorConfirmation !== SK104_OPERATOR_CONFIRMATION
  ) {
    stopSk104("SK104_ENV_INVALID");
  }

  const targetDatabaseUrl = required(environment, SK104_CUTOVER_ENV.targetDatabaseUrl);
  const approvedDatabaseFingerprint = digest(
    environment,
    SK104_CUTOVER_ENV.approvedDatabaseFingerprint,
  );
  const forbiddenDatabaseFingerprint = digest(
    environment,
    SK104_CUTOVER_ENV.forbiddenDatabaseFingerprint,
  );
  const targetSchemaFingerprint = digest(environment, SK104_CUTOVER_ENV.targetSchemaFingerprint);
  const approvedStorageFingerprint = digest(
    environment,
    SK104_CUTOVER_ENV.approvedStorageFingerprint,
  );
  const forbiddenStorageFingerprint = digest(
    environment,
    SK104_CUTOVER_ENV.forbiddenStorageFingerprint,
  );
  const manifestHmacKey = required(environment, SK104_CUTOVER_ENV.manifestHmacKey);
  const approvalPolicyDigest = digest(environment, SK104_CUTOVER_ENV.approvalPolicyDigest);
  const endpoint = required(environment, SK104_CUTOVER_ENV.storageEndpoint);
  const accessKeyId = required(environment, SK104_CUTOVER_ENV.storageAccessKeyId);
  const secretAccessKey = required(environment, SK104_CUTOVER_ENV.storageSecretAccessKey);
  const audioBucket = required(environment, SK104_CUTOVER_ENV.storageAudioBucket);
  const docsBucket = required(environment, SK104_CUTOVER_ENV.storageDocsBucket);
  const storageRecoveryPrefix = recoveryPrefix(
    required(environment, SK104_CUTOVER_ENV.storageRecoveryPrefix),
  );
  const privateApprovalFile = absolutePrivatePath(
    required(environment, SK104_CUTOVER_ENV.privateApprovalFile),
  );
  const privateApprovalLedgerDirectory = absolutePrivatePath(
    required(environment, SK104_CUTOVER_ENV.privateApprovalLedgerDirectory),
  );
  const privateStateDirectory = absolutePrivatePath(
    required(environment, SK104_CUTOVER_ENV.privateStateDirectory),
  );
  const pgDumpBinary = absolutePrivatePath(required(environment, SK104_CUTOVER_ENV.pgDumpBinary));
  const pgRestoreBinary = absolutePrivatePath(
    required(environment, SK104_CUTOVER_ENV.pgRestoreBinary),
  );
  const psqlBinary = absolutePrivatePath(required(environment, SK104_CUTOVER_ENV.psqlBinary));
  const mockTestAttestation = required(environment, SK104_CUTOVER_ENV.mockTestAttestation);
  const releaseCommit = required(environment, SK104_CUTOVER_ENV.releaseCommit);
  const rawNoWriterConfirmation = environment[SK104_CUTOVER_ENV.noWriterConfirmation]?.trim() ?? "";
  if (
    mockTestAttestation !== SK104_MOCK_TEST_ATTESTATION ||
    !/^[0-9a-f]{40}$/.test(releaseCommit) ||
    (EXECUTION_MODES.has(mode)
      ? rawNoWriterConfirmation !== SK104_NO_WRITER_CONFIRMATION
      : rawNoWriterConfirmation !== "")
  ) {
    stopSk104("SK104_ENV_INVALID");
  }

  assertPostgresUrl(targetDatabaseUrl);
  assertStorageEndpoint(endpoint);
  assertBucketName(audioBucket);
  assertBucketName(docsBucket);
  if (
    !sameDigest(approvedDatabaseFingerprint, SK104_CANONICAL_DATABASE_FINGERPRINT) ||
    !sameDigest(forbiddenDatabaseFingerprint, SK104_FROZEN_DATABASE_FINGERPRINT) ||
    sameDigest(approvedDatabaseFingerprint, forbiddenDatabaseFingerprint) ||
    sameDigest(approvedStorageFingerprint, forbiddenStorageFingerprint) ||
    manifestHmacKey.length < 32 ||
    accessKeyId.length < 16 ||
    secretAccessKey.length < 32 ||
    audioBucket === docsBucket ||
    privateApprovalFile === privateStateDirectory ||
    contains(privateApprovalLedgerDirectory, privateApprovalFile) ||
    contains(privateStateDirectory, privateApprovalFile) ||
    contains(privateApprovalLedgerDirectory, privateStateDirectory) ||
    contains(privateStateDirectory, privateApprovalLedgerDirectory)
  ) {
    stopSk104("SK104_ENV_INVALID");
  }

  const rawApprovedExecutionDigest =
    environment[SK104_CUTOVER_ENV.approvedExecutionDigest]?.trim() ?? "";
  let approvedExecutionDigest: Sha256Digest | null = null;
  if (EXECUTION_MODES.has(mode)) {
    if (!rawApprovedExecutionDigest || !isSha256Digest(rawApprovedExecutionDigest)) {
      stopSk104("SK104_ENV_MISSING");
    }
    approvedExecutionDigest = rawApprovedExecutionDigest;
  } else if (rawApprovedExecutionDigest) {
    stopSk104("SK104_APPROVAL_INVALID");
  }
  const rawUserApprovedPlanDigest =
    environment[SK104_CUTOVER_ENV.userApprovedPlanDigest]?.trim() ?? "";
  let userApprovedPlanDigest: Sha256Digest | null = null;
  if (AUTHORIZATION_MODES.has(mode)) {
    if (!rawUserApprovedPlanDigest || !isSha256Digest(rawUserApprovedPlanDigest)) {
      stopSk104("SK104_ENV_MISSING");
    }
    userApprovedPlanDigest = rawUserApprovedPlanDigest;
  } else if (rawUserApprovedPlanDigest) {
    stopSk104("SK104_APPROVAL_INVALID");
  }

  return {
    targetClass: "canonical_production",
    targetDatabaseUrl,
    targetSchemaFingerprint,
    approvedDatabaseFingerprint,
    forbiddenDatabaseFingerprint,
    approvedStorageFingerprint,
    forbiddenStorageFingerprint,
    manifestHmacKey,
    approvalPolicyDigest,
    storage: {
      endpoint,
      accessKeyId,
      secretAccessKey,
      audioBucket,
      docsBucket,
      recoveryPrefix: storageRecoveryPrefix,
    },
    privateApprovalFile,
    privateApprovalLedgerDirectory,
    privateStateDirectory,
    pgDumpBinary,
    pgRestoreBinary,
    psqlBinary,
    releaseCommit,
    noWriterConfirmed: rawNoWriterConfirmation === SK104_NO_WRITER_CONFIRMATION,
    approvedExecutionDigest,
    userApprovedPlanDigest,
  };
}
