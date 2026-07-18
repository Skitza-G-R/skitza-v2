import {
  canonicalJson,
  isSha256Digest,
  sameDigest,
  sha256Digest,
  type Sha256Digest,
} from "../../../operations/sk90-reset/canonical";

export const PURCHASE_REAL_DB_TEST_ENV = {
  targetClass: "SK90_PURCHASE_TEST_TARGET_CLASS",
  targetDatabaseUrl: "SK90_PURCHASE_TEST_DATABASE_URL",
  observedProjectBranchFingerprint:
    "SK90_PURCHASE_TEST_OBSERVED_PROJECT_BRANCH_FINGERPRINT",
  approvedProjectBranchFingerprint:
    "SK90_PURCHASE_TEST_APPROVED_PROJECT_BRANCH_FINGERPRINT",
  forbiddenProjectBranchFingerprints:
    "SK90_PURCHASE_TEST_FORBIDDEN_PROJECT_BRANCH_FINGERPRINTS",
  approvedEndpointFingerprint: "SK90_PURCHASE_TEST_APPROVED_ENDPOINT_FINGERPRINT",
  disposableConfirmation: "SK90_PURCHASE_TEST_DISPOSABLE_CONFIRMATION",
} as const;

export const FORBIDDEN_PURCHASE_REAL_DB_AMBIENT_ENV = [
  "DATABASE_URL",
  "DATABASE_URL_TEST",
  "DATABASE_URL_NEON",
  "DATABASE_URL_UNPOOLED",
  "POSTGRES_URL",
  "POSTGRES_URL_NON_POOLING",
] as const;

type EnvironmentMap = Readonly<Record<string, string | undefined>>;

export type PurchaseRealDbEndpointDescriptor = Readonly<{
  databaseName: string;
  endpointFingerprint: Sha256Digest;
}>;

export type ApprovedPurchaseRealDbTarget = Readonly<{
  targetDatabaseUrl: string;
  databaseName: string;
  projectBranchFingerprint: Sha256Digest;
  endpointFingerprint: Sha256Digest;
}>;

/**
 * Derive only a sanitized endpoint identity from connection metadata. User
 * info, credentials, query parameters, and the raw URL never enter the digest.
 */
export function describePurchaseRealDbEndpoint(
  value: string | undefined,
): PurchaseRealDbEndpointDescriptor | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    if (
      (url.protocol !== "postgres:" && url.protocol !== "postgresql:") ||
      !url.hostname ||
      !url.pathname ||
      url.pathname === "/"
    ) {
      return null;
    }

    const databaseName = decodeURIComponent(url.pathname.slice(1));
    if (!databaseName || databaseName.includes("/")) return null;

    return {
      databaseName,
      endpointFingerprint: sha256Digest(
        canonicalJson({
          contract: "sk90-purchase-real-db-endpoint-v1",
          databaseName,
          hostname: url.hostname.toLowerCase(),
          port: url.port || "5432",
          protocol: "postgresql:",
        }),
      ),
    };
  } catch {
    return null;
  }
}

function required(environment: EnvironmentMap, name: string): string | null {
  return environment[name]?.trim() || null;
}

function commaSeparatedFingerprints(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim());
}

/**
 * Pure fail-closed opt-in. The observed project+branch fingerprint must come
 * from an independent read-only discovery step; this contract never derives
 * that higher-level identity from an operator-supplied connection URL.
 */
export function approvedPurchaseRealDbTarget(
  environment: EnvironmentMap,
): ApprovedPurchaseRealDbTarget | null {
  if (
    environment.NODE_ENV?.trim() !== "test" ||
    required(environment, PURCHASE_REAL_DB_TEST_ENV.targetClass) !==
      "isolated_nonproduction" ||
    required(environment, PURCHASE_REAL_DB_TEST_ENV.disposableConfirmation) !==
      "isolated-disposable" ||
    FORBIDDEN_PURCHASE_REAL_DB_AMBIENT_ENV.some((name) =>
      Boolean(environment[name]?.trim()),
    )
  ) {
    return null;
  }

  const targetDatabaseUrl = required(
    environment,
    PURCHASE_REAL_DB_TEST_ENV.targetDatabaseUrl,
  );
  const observedProjectBranchFingerprint = required(
    environment,
    PURCHASE_REAL_DB_TEST_ENV.observedProjectBranchFingerprint,
  );
  const approvedProjectBranchFingerprint = required(
    environment,
    PURCHASE_REAL_DB_TEST_ENV.approvedProjectBranchFingerprint,
  );
  const forbiddenRaw = required(
    environment,
    PURCHASE_REAL_DB_TEST_ENV.forbiddenProjectBranchFingerprints,
  );
  const approvedEndpointFingerprint = required(
    environment,
    PURCHASE_REAL_DB_TEST_ENV.approvedEndpointFingerprint,
  );
  if (
    !targetDatabaseUrl ||
    !observedProjectBranchFingerprint ||
    !approvedProjectBranchFingerprint ||
    !forbiddenRaw ||
    !approvedEndpointFingerprint
  ) {
    return null;
  }

  const endpoint = describePurchaseRealDbEndpoint(targetDatabaseUrl);
  const forbidden = commaSeparatedFingerprints(forbiddenRaw);
  if (
    !endpoint ||
    !isSha256Digest(observedProjectBranchFingerprint) ||
    !isSha256Digest(approvedProjectBranchFingerprint) ||
    !isSha256Digest(approvedEndpointFingerprint) ||
    forbidden.length !== 2 ||
    new Set(forbidden).size !== 2 ||
    !forbidden.every(isSha256Digest) ||
    !sameDigest(observedProjectBranchFingerprint, approvedProjectBranchFingerprint) ||
    forbidden.some((fingerprint) =>
      sameDigest(observedProjectBranchFingerprint, fingerprint),
    ) ||
    !sameDigest(endpoint.endpointFingerprint, approvedEndpointFingerprint)
  ) {
    return null;
  }

  return {
    targetDatabaseUrl,
    databaseName: endpoint.databaseName,
    projectBranchFingerprint: observedProjectBranchFingerprint,
    endpointFingerprint: endpoint.endpointFingerprint,
  };
}
