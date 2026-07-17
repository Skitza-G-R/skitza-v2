import {
  assertProtectedToken,
  assertSha256Digest,
  canonicalJson,
  sameDigest,
  sha256Digest,
  type ProtectedToken,
  type Sha256Digest,
} from "./canonical";
import { stop } from "./errors";
import { assertFreshProofObservation } from "./policy";

export const EXECUTABLE_RESET_APPROVAL_CONTRACT = "sk90-executable-reset-approval-v1" as const;
export const MAX_EXECUTABLE_RESET_APPROVAL_TTL_MS = 5 * 60 * 1000;

export type ExecutableResetApprovalBody = Readonly<{
  contract: typeof EXECUTABLE_RESET_APPROVAL_CONTRACT;
  artifactDigest: Sha256Digest;
  manifestDigest: Sha256Digest;
  policyDigest: Sha256Digest;
  targetDatabaseFingerprint: Sha256Digest;
  targetStorageFingerprint: Sha256Digest;
  resetPlanDigest: Sha256Digest;
  migrationDigest: Sha256Digest;
  privateEnvelopeDigest: Sha256Digest;
  approvalLedgerDirectoryFingerprint: Sha256Digest;
  evidenceObservationDigest: Sha256Digest;
  preStorageNamespaceFingerprint: Sha256Digest;
  postStorageNamespaceFingerprint: Sha256Digest;
  databaseRestorePointFingerprint: Sha256Digest;
  storageRestorePointFingerprint: Sha256Digest;
  approvalChallengeToken: ProtectedToken;
  approvedAt: string;
  expiresAt: string;
}>;

export type ExecutableResetApproval = ExecutableResetApprovalBody &
  Readonly<{ digest: Sha256Digest }>;

function exactIsoDate(value: string): number {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    stop("EXECUTION_APPROVAL_MISMATCH");
  }
  return milliseconds;
}

function approvalBody(input: ExecutableResetApprovalBody): ExecutableResetApprovalBody {
  const observedContract: unknown = input.contract;
  if (observedContract !== EXECUTABLE_RESET_APPROVAL_CONTRACT) {
    stop("EXECUTION_APPROVAL_MISMATCH");
  }
  for (const digest of [
    input.artifactDigest,
    input.manifestDigest,
    input.policyDigest,
    input.targetDatabaseFingerprint,
    input.targetStorageFingerprint,
    input.resetPlanDigest,
    input.migrationDigest,
    input.privateEnvelopeDigest,
    input.approvalLedgerDirectoryFingerprint,
    input.evidenceObservationDigest,
    input.preStorageNamespaceFingerprint,
    input.postStorageNamespaceFingerprint,
    input.databaseRestorePointFingerprint,
    input.storageRestorePointFingerprint,
  ]) {
    assertSha256Digest(digest);
  }
  assertProtectedToken(input.approvalChallengeToken);
  const approvedAt = exactIsoDate(input.approvedAt);
  const expiresAt = exactIsoDate(input.expiresAt);
  if (
    expiresAt <= approvedAt ||
    expiresAt - approvedAt > MAX_EXECUTABLE_RESET_APPROVAL_TTL_MS
  ) {
    stop("EXECUTION_APPROVAL_MISMATCH");
  }

  return {
    contract: EXECUTABLE_RESET_APPROVAL_CONTRACT,
    artifactDigest: input.artifactDigest,
    manifestDigest: input.manifestDigest,
    policyDigest: input.policyDigest,
    targetDatabaseFingerprint: input.targetDatabaseFingerprint,
    targetStorageFingerprint: input.targetStorageFingerprint,
    resetPlanDigest: input.resetPlanDigest,
    migrationDigest: input.migrationDigest,
    privateEnvelopeDigest: input.privateEnvelopeDigest,
    approvalLedgerDirectoryFingerprint: input.approvalLedgerDirectoryFingerprint,
    evidenceObservationDigest: input.evidenceObservationDigest,
    preStorageNamespaceFingerprint: input.preStorageNamespaceFingerprint,
    postStorageNamespaceFingerprint: input.postStorageNamespaceFingerprint,
    databaseRestorePointFingerprint: input.databaseRestorePointFingerprint,
    storageRestorePointFingerprint: input.storageRestorePointFingerprint,
    approvalChallengeToken: input.approvalChallengeToken,
    approvedAt: input.approvedAt,
    expiresAt: input.expiresAt,
  };
}

export function bindExecutableResetApproval(
  input: ExecutableResetApprovalBody,
): ExecutableResetApproval {
  const body = approvalBody(input);
  return { ...body, digest: sha256Digest(canonicalJson(body)) };
}

function assertApprovalDigest(approval: ExecutableResetApproval): void {
  assertSha256Digest(approval.digest);
  const rebound = bindExecutableResetApproval(approval);
  if (!sameDigest(rebound.digest, approval.digest)) stop("EXECUTION_APPROVAL_MISMATCH");
}

export function assertExecutableResetApproval(
  approval: ExecutableResetApproval,
  expected: Readonly<{ approvedDigest: Sha256Digest; now: Date }>,
): true {
  assertApprovalDigest(approval);
  assertSha256Digest(expected.approvedDigest);
  const now = expected.now.getTime();
  if (
    Number.isNaN(now) ||
    !sameDigest(approval.digest, expected.approvedDigest) ||
    now < Date.parse(approval.approvedAt) ||
    now >= Date.parse(approval.expiresAt)
  ) {
    stop("EXECUTION_APPROVAL_MISMATCH");
  }
  return true;
}

export type ExecutedIntegritySnapshot = Readonly<{
  databaseStateFingerprint: Sha256Digest;
  schemaFingerprint: Sha256Digest;
  resetRowsFingerprint: Sha256Digest;
  preservedRowCountsFingerprint: Sha256Digest;
  preservedBusinessFingerprint: Sha256Digest;
  foreignKeyFingerprint: Sha256Digest;
  orphanFingerprint: Sha256Digest;
  ownershipFingerprint: Sha256Digest;
  storageNamespaceFingerprint: Sha256Digest;
}>;

function assertIntegritySnapshot(snapshot: ExecutedIntegritySnapshot): void {
  for (const digest of Object.values(snapshot)) assertSha256Digest(digest);
}

export type ExecutableRollbackProofBody = Readonly<{
  contract: "sk90-executable-rollback-proof-v1";
  approvalDigest: Sha256Digest;
  artifactDigest: Sha256Digest;
  action: "restore";
  challengeToken: ProtectedToken;
  targetObservationDigest: Sha256Digest;
  issuedAt: string;
  expiresAt: string;
  durableNonceConsumptionDigest: Sha256Digest;
  interruptionPoint:
    | "before_database_commit"
    | "after_database_commit_before_storage_delete"
    | "after_partial_storage_delete";
  before: ExecutedIntegritySnapshot;
  restored: ExecutedIntegritySnapshot;
  databaseRestoreExecuted: boolean;
  storageRestoreExecuted: boolean;
}>;

export type ExecutableRollbackProof = ExecutableRollbackProofBody &
  Readonly<{ digest: Sha256Digest }>;

function rollbackBody(proof: ExecutableRollbackProofBody): ExecutableRollbackProofBody {
  const contract: unknown = proof.contract;
  const action: unknown = proof.action;
  const interruptionPoint: unknown = proof.interruptionPoint;
  if (
    contract !== "sk90-executable-rollback-proof-v1" ||
    action !== "restore" ||
    (interruptionPoint !== "before_database_commit" &&
      interruptionPoint !== "after_database_commit_before_storage_delete" &&
      interruptionPoint !== "after_partial_storage_delete")
  ) {
    stop("RESTORE_PROOF_MISMATCH");
  }
  assertSha256Digest(proof.approvalDigest);
  assertSha256Digest(proof.artifactDigest);
  assertProtectedToken(proof.challengeToken);
  assertSha256Digest(proof.targetObservationDigest);
  assertSha256Digest(proof.durableNonceConsumptionDigest);
  assertIntegritySnapshot(proof.before);
  assertIntegritySnapshot(proof.restored);
  if (
    typeof proof.databaseRestoreExecuted !== "boolean" ||
    typeof proof.storageRestoreExecuted !== "boolean"
  ) {
    stop("RESTORE_PROOF_MISMATCH");
  }
  return {
    contract: "sk90-executable-rollback-proof-v1",
    approvalDigest: proof.approvalDigest,
    artifactDigest: proof.artifactDigest,
    action: proof.action,
    challengeToken: proof.challengeToken,
    targetObservationDigest: proof.targetObservationDigest,
    issuedAt: proof.issuedAt,
    expiresAt: proof.expiresAt,
    durableNonceConsumptionDigest: proof.durableNonceConsumptionDigest,
    interruptionPoint: proof.interruptionPoint,
    before: proof.before,
    restored: proof.restored,
    databaseRestoreExecuted: proof.databaseRestoreExecuted,
    storageRestoreExecuted: proof.storageRestoreExecuted,
  };
}

export function bindExecutableRollbackProof(
  proof: ExecutableRollbackProofBody,
): ExecutableRollbackProof {
  const body = rollbackBody(proof);
  return { ...body, digest: sha256Digest(canonicalJson(body)) };
}

export function assertExecutableRollbackProof(
  approval: ExecutableResetApproval,
  proof: ExecutableRollbackProof,
  expected: Readonly<{
    artifactDigest: Sha256Digest;
    challengeToken: ProtectedToken;
    targetObservationDigest: Sha256Digest;
    issuedAt: string;
    expiresAt: string;
    currentTime: string;
    durableNonceConsumptionDigest: Sha256Digest;
  }>,
): true {
  assertApprovalDigest(approval);
  assertSha256Digest(proof.digest);
  const rebound = bindExecutableRollbackProof(proof);
  assertFreshProofObservation(proof, {
    challengeToken: expected.challengeToken,
    targetObservationDigest: expected.targetObservationDigest,
    issuedAt: expected.issuedAt,
    expiresAt: expected.expiresAt,
    currentTime: expected.currentTime,
  });
  if (
    !sameDigest(proof.digest, rebound.digest) ||
    !sameDigest(proof.approvalDigest, approval.digest) ||
    !sameDigest(proof.artifactDigest, approval.artifactDigest) ||
    !sameDigest(proof.artifactDigest, expected.artifactDigest) ||
    !sameDigest(proof.challengeToken, expected.challengeToken) ||
    !sameDigest(proof.targetObservationDigest, expected.targetObservationDigest) ||
    proof.issuedAt !== expected.issuedAt ||
    proof.expiresAt !== expected.expiresAt ||
    !sameDigest(proof.durableNonceConsumptionDigest, expected.durableNonceConsumptionDigest) ||
    !proof.databaseRestoreExecuted ||
    !proof.storageRestoreExecuted ||
    canonicalJson(proof.before) !== canonicalJson(proof.restored)
  ) {
    stop("RESTORE_PROOF_MISMATCH");
  }
  return true;
}

export type SecondRunIdempotencyProofBody = Readonly<{
  contract: "sk90-second-run-idempotency-proof-v1";
  approvalDigest: Sha256Digest;
  artifactDigest: Sha256Digest;
  action: "noop";
  firstObservationChallengeToken: ProtectedToken;
  secondObservationChallengeToken: ProtectedToken;
  targetObservationDigest: Sha256Digest;
  issuedAt: string;
  expiresAt: string;
  durableNonceConsumptionDigest: Sha256Digest;
  before: ExecutedIntegritySnapshot;
  after: ExecutedIntegritySnapshot;
  databaseMutationCount: number;
  storageCopyCount: number;
  storageDeleteCount: number;
  storageRestoreCount: number;
}>;

export type SecondRunIdempotencyProof = SecondRunIdempotencyProofBody &
  Readonly<{ digest: Sha256Digest }>;

function assertMutationCount(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) stop("IDEMPOTENCY_PROOF_MISMATCH");
}

function idempotencyBody(proof: SecondRunIdempotencyProofBody): SecondRunIdempotencyProofBody {
  const contract: unknown = proof.contract;
  const action: unknown = proof.action;
  if (contract !== "sk90-second-run-idempotency-proof-v1" || action !== "noop") {
    stop("IDEMPOTENCY_PROOF_MISMATCH");
  }
  assertSha256Digest(proof.approvalDigest);
  assertSha256Digest(proof.artifactDigest);
  assertProtectedToken(proof.firstObservationChallengeToken);
  assertProtectedToken(proof.secondObservationChallengeToken);
  assertSha256Digest(proof.targetObservationDigest);
  assertSha256Digest(proof.durableNonceConsumptionDigest);
  assertIntegritySnapshot(proof.before);
  assertIntegritySnapshot(proof.after);
  assertMutationCount(proof.databaseMutationCount);
  assertMutationCount(proof.storageCopyCount);
  assertMutationCount(proof.storageDeleteCount);
  assertMutationCount(proof.storageRestoreCount);
  return {
    contract: "sk90-second-run-idempotency-proof-v1",
    approvalDigest: proof.approvalDigest,
    artifactDigest: proof.artifactDigest,
    action: proof.action,
    firstObservationChallengeToken: proof.firstObservationChallengeToken,
    secondObservationChallengeToken: proof.secondObservationChallengeToken,
    targetObservationDigest: proof.targetObservationDigest,
    issuedAt: proof.issuedAt,
    expiresAt: proof.expiresAt,
    durableNonceConsumptionDigest: proof.durableNonceConsumptionDigest,
    before: proof.before,
    after: proof.after,
    databaseMutationCount: proof.databaseMutationCount,
    storageCopyCount: proof.storageCopyCount,
    storageDeleteCount: proof.storageDeleteCount,
    storageRestoreCount: proof.storageRestoreCount,
  };
}

export function bindSecondRunIdempotencyProof(
  proof: SecondRunIdempotencyProofBody,
): SecondRunIdempotencyProof {
  const body = idempotencyBody(proof);
  return { ...body, digest: sha256Digest(canonicalJson(body)) };
}

export function assertSecondRunIdempotencyProof(
  approval: ExecutableResetApproval,
  proof: SecondRunIdempotencyProof,
  expected: Readonly<{
    artifactDigest: Sha256Digest;
    challengeToken: ProtectedToken;
    targetObservationDigest: Sha256Digest;
    issuedAt: string;
    expiresAt: string;
    currentTime: string;
    durableNonceConsumptionDigest: Sha256Digest;
  }>,
): true {
  assertApprovalDigest(approval);
  assertSha256Digest(proof.digest);
  const rebound = bindSecondRunIdempotencyProof(proof);
  assertFreshProofObservation(
    {
      challengeToken: proof.secondObservationChallengeToken,
      targetObservationDigest: proof.targetObservationDigest,
      issuedAt: proof.issuedAt,
      expiresAt: proof.expiresAt,
    },
    {
      challengeToken: expected.challengeToken,
      targetObservationDigest: expected.targetObservationDigest,
      issuedAt: expected.issuedAt,
      expiresAt: expected.expiresAt,
      currentTime: expected.currentTime,
    },
  );
  if (
    !sameDigest(proof.digest, rebound.digest) ||
    !sameDigest(proof.approvalDigest, approval.digest) ||
    !sameDigest(proof.artifactDigest, approval.artifactDigest) ||
    !sameDigest(proof.artifactDigest, expected.artifactDigest) ||
    !sameDigest(proof.secondObservationChallengeToken, expected.challengeToken) ||
    !sameDigest(proof.targetObservationDigest, expected.targetObservationDigest) ||
    proof.issuedAt !== expected.issuedAt ||
    proof.expiresAt !== expected.expiresAt ||
    !sameDigest(proof.durableNonceConsumptionDigest, expected.durableNonceConsumptionDigest) ||
    sameDigest(proof.firstObservationChallengeToken, proof.secondObservationChallengeToken) ||
    canonicalJson(proof.before) !== canonicalJson(proof.after) ||
    proof.databaseMutationCount !== 0 ||
    proof.storageCopyCount !== 0 ||
    proof.storageDeleteCount !== 0 ||
    proof.storageRestoreCount !== 0
  ) {
    stop("IDEMPOTENCY_PROOF_MISMATCH");
  }
  return true;
}
