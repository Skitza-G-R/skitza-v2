import { describe, expect, it } from "vitest";

import { protectValue, sha256Digest } from "./canonical";
import {
  assertExecutableResetApproval,
  assertExecutableRollbackProof,
  assertSecondRunIdempotencyProof,
  bindExecutableResetApproval,
  bindExecutableRollbackProof,
  bindSecondRunIdempotencyProof,
} from "./execution";

const secret = "execution-test-secret-key-that-is-long-enough";
const digest = (label: string) => sha256Digest(label);
const token = (label: string) => protectValue(secret, label);
const targetObservation = digest("approved-target-observation");
const issuedAt = "2026-07-17T12:00:00.000Z";
const expiresAt = "2026-07-17T12:01:00.000Z";
const currentTime = "2026-07-17T12:00:01.000Z";

function proofExpectation(challengeToken: ReturnType<typeof token>) {
  return {
    artifactDigest: digest("artifact"),
    challengeToken,
    targetObservationDigest: targetObservation,
    issuedAt,
    expiresAt,
    currentTime,
    durableNonceConsumptionDigest: digest("consumed-nonce"),
  };
}

function approvalInput() {
  return {
    contract: "sk90-executable-reset-approval-v1" as const,
    artifactDigest: digest("artifact"),
    manifestDigest: digest("manifest"),
    policyDigest: digest("policy"),
    targetDatabaseFingerprint: digest("database"),
    targetStorageFingerprint: digest("storage"),
    resetPlanDigest: digest("reset-plan"),
    migrationDigest: digest("migration"),
    privateEnvelopeDigest: digest("private-envelope"),
    approvalLedgerDirectoryFingerprint: digest("approval-ledger-directory"),
    evidenceObservationDigest: digest("evidence"),
    preStorageNamespaceFingerprint: digest("storage-pre"),
    postStorageNamespaceFingerprint: digest("storage-post"),
    databaseRestorePointFingerprint: digest("database-restore"),
    storageRestorePointFingerprint: digest("storage-restore"),
    approvalChallengeToken: token("approval-challenge"),
    approvedAt: "2026-07-17T11:59:00.000Z",
    expiresAt: "2026-07-17T12:04:00.000Z",
  };
}

describe("SK-90 executable approval binding", () => {
  it("binds every target, artifact, plan, migration, envelope, namespace, and restore input", () => {
    const approval = bindExecutableResetApproval(approvalInput());

    expect(
      assertExecutableResetApproval(approval, {
        approvedDigest: approval.digest,
        now: new Date("2026-07-17T12:00:00.000Z"),
      }),
    ).toBe(true);

    expect(() =>
      assertExecutableResetApproval(
        { ...approval, migrationDigest: digest("substituted-migration") },
        { approvedDigest: approval.digest, now: new Date("2026-07-17T12:00:00.000Z") },
      ),
    ).toThrow(/approved executable reset inputs/i);
    expect(() =>
      assertExecutableResetApproval(
        {
          ...approval,
          approvalLedgerDirectoryFingerprint: digest("substituted-approval-ledger"),
        },
        { approvedDigest: approval.digest, now: new Date("2026-07-17T12:00:00.000Z") },
      ),
    ).toThrow(/approved executable reset inputs/i);
  });

  it("rejects an expired or externally unapproved execution envelope", () => {
    const approval = bindExecutableResetApproval(approvalInput());

    expect(() =>
      assertExecutableResetApproval(approval, {
        approvedDigest: digest("different-approval"),
        now: new Date("2026-07-17T12:00:00.000Z"),
      }),
    ).toThrow(/approved executable reset inputs/i);
    expect(() =>
      assertExecutableResetApproval(approval, {
        approvedDigest: approval.digest,
        now: new Date("2026-07-19T12:00:00.000Z"),
      }),
    ).toThrow(/approved executable reset inputs/i);
  });

  it("rejects an approval window longer than five minutes", () => {
    expect(() =>
      bindExecutableResetApproval({
        ...approvalInput(),
        expiresAt: "2026-07-17T12:04:00.001Z",
      }),
    ).toThrow(/approved executable reset inputs/i);
  });
});

describe("SK-90 executable rollback and real second-run proofs", () => {
  const integrity = {
    databaseStateFingerprint: digest("database-state"),
    schemaFingerprint: digest("schema"),
    resetRowsFingerprint: digest("reset-rows"),
    preservedRowCountsFingerprint: digest("preserved-counts"),
    preservedBusinessFingerprint: digest("preserved-business"),
    foreignKeyFingerprint: digest("foreign-keys"),
    orphanFingerprint: digest("orphans"),
    ownershipFingerprint: digest("ownership"),
    storageNamespaceFingerprint: digest("namespace"),
  };

  it("requires complete relational and storage equality after an executed restore", () => {
    const approval = bindExecutableResetApproval(approvalInput());
    const challengeToken = token("rollback-restore");
    const proof = bindExecutableRollbackProof({
      contract: "sk90-executable-rollback-proof-v1",
      approvalDigest: approval.digest,
      artifactDigest: approval.artifactDigest,
      action: "restore",
      challengeToken,
      targetObservationDigest: targetObservation,
      issuedAt,
      expiresAt,
      durableNonceConsumptionDigest: digest("consumed-nonce"),
      interruptionPoint: "after_partial_storage_delete",
      before: integrity,
      restored: integrity,
      databaseRestoreExecuted: true,
      storageRestoreExecuted: true,
    });

    expect(assertExecutableRollbackProof(approval, proof, proofExpectation(challengeToken))).toBe(
      true,
    );
    expect(() =>
      assertExecutableRollbackProof(
        approval,
        {
          ...proof,
          restored: { ...integrity, ownershipFingerprint: digest("wrong-ownership") },
        },
        proofExpectation(challengeToken),
      ),
    ).toThrow(/rollback verification/i);
  });

  it("requires a fresh second observation, identical post-state, and zero mutations", () => {
    const approval = bindExecutableResetApproval(approvalInput());
    const secondChallenge = token("second-observation");
    const proof = bindSecondRunIdempotencyProof({
      contract: "sk90-second-run-idempotency-proof-v1",
      approvalDigest: approval.digest,
      artifactDigest: approval.artifactDigest,
      action: "noop",
      firstObservationChallengeToken: token("first-observation"),
      secondObservationChallengeToken: secondChallenge,
      targetObservationDigest: targetObservation,
      issuedAt,
      expiresAt,
      durableNonceConsumptionDigest: digest("consumed-nonce"),
      before: integrity,
      after: integrity,
      databaseMutationCount: 0,
      storageCopyCount: 0,
      storageDeleteCount: 0,
      storageRestoreCount: 0,
    });

    expect(
      assertSecondRunIdempotencyProof(approval, proof, proofExpectation(secondChallenge)),
    ).toBe(true);
    expect(() =>
      assertSecondRunIdempotencyProof(
        approval,
        {
          ...proof,
          databaseMutationCount: 1,
        },
        proofExpectation(secondChallenge),
      ),
    ).toThrow(/second reset run/i);
    expect(() =>
      assertSecondRunIdempotencyProof(
        approval,
        {
          ...proof,
          secondObservationChallengeToken: proof.firstObservationChallengeToken,
        },
        proofExpectation(secondChallenge),
      ),
    ).toThrow(/phase proof/i);
  });
});
