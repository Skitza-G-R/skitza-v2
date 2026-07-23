import { createHash } from "node:crypto";

import type { NeonPoolClientLike } from "../sk90-reset/database-adapter";
import { assertSha256Digest, sameDigest, type Sha256Digest } from "../sk90-reset/canonical";
import { stop } from "../sk90-reset/errors";

export const SK104_CANONICAL_DATABASE_FINGERPRINT =
  "sha256:fc7d5987ba12e0eea387d8ebb36b733ab1b246d949075ec194f1ef40ab1b43b2" as const;

export const SK104_FROZEN_DATABASE_FINGERPRINT =
  "sha256:bd49f0b3bb80fa36b3be74c74053f786b17ba15afe0cba8928721310b3093226" as const;

const TARGET_FINGERPRINT_CONTRACT = "sk104-production-target-v1";

type ProductionTargetIdentityRow = Readonly<{
  projectId: unknown;
  branchId: unknown;
  endpointId: unknown;
  databaseName: unknown;
  inRecovery: unknown;
  transactionReadOnly: unknown;
}>;

export type ProductionTargetObservation = Readonly<{
  databaseFingerprint: Sha256Digest;
  primary: true;
  writable: true;
}>;

export type ApprovedProductionTargetBoundary = Readonly<{
  targetClass: "canonical_production";
  approvedDatabaseFingerprint: Sha256Digest;
  forbiddenDatabaseFingerprint: Sha256Digest;
}>;

function privateIdentityText(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    stop("DATABASE_TARGET_MISMATCH");
  }
  return value;
}

export function productionDatabaseTargetFingerprint(
  input: Readonly<{
    projectId: string;
    branchId: string;
    endpointId: string;
    databaseName: string;
  }>,
): Sha256Digest {
  const source = [
    TARGET_FINGERPRINT_CONTRACT,
    privateIdentityText(input.projectId),
    privateIdentityText(input.branchId),
    privateIdentityText(input.endpointId),
    privateIdentityText(input.databaseName),
  ].join("\n");
  return `sha256:${createHash("sha256").update(source, "utf8").digest("hex")}`;
}

/**
 * Read the provider-owned target identity from the same database connection.
 * Raw identifiers are discarded before this function returns.
 */
export async function observeProductionDatabaseTarget(
  client: Pick<NeonPoolClientLike, "query">,
): Promise<ProductionTargetObservation> {
  const result = await client.query<ProductionTargetIdentityRow>(`SELECT
    current_setting('neon.project_id', true) AS "projectId",
    current_setting('neon.branch_id', true) AS "branchId",
    current_setting('neon.endpoint_id', true) AS "endpointId",
    current_database() AS "databaseName",
    pg_is_in_recovery() AS "inRecovery",
    current_setting('transaction_read_only') AS "transactionReadOnly"`);
  if (result.rows.length !== 1) stop("DATABASE_TARGET_MISMATCH");
  const row = result.rows[0];
  if (!row || row.inRecovery !== false || row.transactionReadOnly !== "off") {
    stop("DATABASE_TARGET_MISMATCH");
  }
  return {
    databaseFingerprint: productionDatabaseTargetFingerprint({
      projectId: privateIdentityText(row.projectId),
      branchId: privateIdentityText(row.branchId),
      endpointId: privateIdentityText(row.endpointId),
      databaseName: privateIdentityText(row.databaseName),
    }),
    primary: true,
    writable: true,
  };
}

/** Fail closed unless both the private approval and live observation are exact. */
export function assertCanonicalProductionTarget(
  observation: ProductionTargetObservation,
  boundary: ApprovedProductionTargetBoundary,
): ProductionTargetObservation {
  assertSha256Digest(observation.databaseFingerprint);
  assertSha256Digest(boundary.approvedDatabaseFingerprint);
  assertSha256Digest(boundary.forbiddenDatabaseFingerprint);
  const untrustedTargetClass: unknown = boundary.targetClass;
  const untrustedPrimary: unknown = observation.primary;
  const untrustedWritable: unknown = observation.writable;
  if (
    untrustedTargetClass !== "canonical_production" ||
    untrustedPrimary !== true ||
    untrustedWritable !== true ||
    !sameDigest(boundary.approvedDatabaseFingerprint, SK104_CANONICAL_DATABASE_FINGERPRINT) ||
    !sameDigest(boundary.forbiddenDatabaseFingerprint, SK104_FROZEN_DATABASE_FINGERPRINT) ||
    sameDigest(boundary.approvedDatabaseFingerprint, boundary.forbiddenDatabaseFingerprint) ||
    sameDigest(observation.databaseFingerprint, boundary.forbiddenDatabaseFingerprint) ||
    !sameDigest(observation.databaseFingerprint, boundary.approvedDatabaseFingerprint)
  ) {
    stop("DATABASE_TARGET_MISMATCH");
  }
  return observation;
}
