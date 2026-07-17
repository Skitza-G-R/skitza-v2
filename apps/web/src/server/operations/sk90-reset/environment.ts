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
] as const;

export type RehearsalEnvironment = Readonly<{
  targetDatabaseUrl: string;
  targetDatabaseFingerprint: Sha256Digest;
  targetStorageFingerprint: Sha256Digest;
  targetStorageNamespace: string;
  manifestHmacKey: string;
  approvalPolicyDigest: Sha256Digest;
}>;

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
