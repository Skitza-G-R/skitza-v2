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
import {
  assertFreshProofObservation,
  assertFreshProofWindow,
  assertFreshTargetAuthorization,
  type FreshTargetAuthorization,
  type TargetGatedResetAction,
} from "./policy";
import {
  assertApprovedResetArtifact,
  assertPostResetIntegrityProof,
  assertQuarantineProof,
  type ApprovedResetArtifact,
  type PostResetIntegrityProof,
  type QuarantineProof,
} from "./artifact";

export type ResetPhase =
  | "manifest_built"
  | "objects_quarantined"
  | "database_committed"
  | "storage_deleting"
  | "storage_deleted"
  | "verified"
  | "restored";

export type ResetPhaseJournal = Readonly<{
  artifactDigest: Sha256Digest;
  manifestDigest: Sha256Digest;
  phase: ResetPhase;
  quarantineSetFingerprint?: Sha256Digest;
}>;

export type ObservedResetState = Readonly<{
  database: "pre" | "post" | "mixed";
  storage: "pre" | "post" | "mixed";
}>;

export type NextResetAction =
  | "quarantine_objects"
  | "reset_database"
  | "delete_storage"
  | "verify"
  | "noop"
  | "restored";

const NEXT_PHASE: Readonly<Partial<Record<ResetPhase, ResetPhase>>> = {
  manifest_built: "objects_quarantined",
  objects_quarantined: "database_committed",
  database_committed: "storage_deleting",
  storage_deleting: "storage_deleted",
  storage_deleted: "verified",
};

const PHASE_ACTION: Readonly<Partial<Record<ResetPhase, TargetGatedResetAction>>> = {
  objects_quarantined: "quarantine_objects",
  database_committed: "reset_database",
  storage_deleting: "delete_storage",
  storage_deleted: "delete_storage",
  verified: "verify",
};

export type FreshTargetGate = Readonly<{
  authorization: FreshTargetAuthorization;
  currentChallengeToken: ProtectedToken;
  currentTargetObservationDigest: Sha256Digest;
  currentTime: string;
}>;

export type PostResetIntegrityGate = Readonly<{
  artifact: ApprovedResetArtifact;
  proof: PostResetIntegrityProof;
}>;

export type QuarantineProofGate = Readonly<{
  artifact: ApprovedResetArtifact;
  proof: QuarantineProof;
}>;

export type RollbackProofGate = Readonly<{
  artifact: ApprovedResetArtifact;
  proof: RollbackProof;
}>;

export type ResetPhaseProofs = Readonly<{
  integrity?: PostResetIntegrityGate;
  quarantine?: QuarantineProofGate;
  rollback?: RollbackProofGate;
}>;

export function assertFreshTargetGate(
  gate: FreshTargetGate,
  action: TargetGatedResetAction,
  artifactDigest: Sha256Digest,
): void {
  assertProtectedToken(gate.currentChallengeToken);
  assertSha256Digest(gate.currentTargetObservationDigest);
  assertFreshTargetAuthorization(gate.authorization, {
    action,
    artifactDigest,
    challengeToken: gate.currentChallengeToken,
    targetObservationDigest: gate.currentTargetObservationDigest,
    currentTime: gate.currentTime,
  });
}

function assertIntegrityGate(
  gate: PostResetIntegrityGate | undefined,
  expected: Readonly<{ artifactDigest: Sha256Digest; manifestDigest: Sha256Digest }>,
  freshTarget: FreshTargetGate,
): void {
  if (!gate) stop("POST_RESET_INTEGRITY_REQUIRED");
  const receipt = assertPostResetIntegrityProof(gate.artifact, gate.proof, {
    challengeToken: freshTarget.currentChallengeToken,
    targetObservationDigest: freshTarget.currentTargetObservationDigest,
    issuedAt: freshTarget.authorization.issuedAt,
    expiresAt: freshTarget.authorization.expiresAt,
    currentTime: freshTarget.currentTime,
  });
  if (
    !sameDigest(receipt.artifactDigest, expected.artifactDigest) ||
    !sameDigest(receipt.manifestDigest, expected.manifestDigest)
  ) {
    stop("POST_RESET_INTEGRITY_REQUIRED");
  }
}

function assertQuarantineGate(
  gate: QuarantineProofGate | undefined,
  expected: Readonly<{
    artifactDigest: Sha256Digest;
    manifestDigest: Sha256Digest;
    challengeToken: ProtectedToken;
    targetObservationDigest: Sha256Digest;
    issuedAt: string;
    expiresAt: string;
    currentTime: string;
    setFingerprint?: Sha256Digest;
  }>,
): Sha256Digest {
  if (!gate) stop("QUARANTINE_PROOF_REQUIRED");
  const receipt = assertQuarantineProof(gate.artifact, gate.proof, {
    challengeToken: expected.challengeToken,
    targetObservationDigest: expected.targetObservationDigest,
    issuedAt: expected.issuedAt,
    expiresAt: expected.expiresAt,
    currentTime: expected.currentTime,
  });
  if (
    !sameDigest(receipt.artifactDigest, expected.artifactDigest) ||
    !sameDigest(receipt.manifestDigest, expected.manifestDigest) ||
    !sameDigest(gate.proof.observationChallengeToken, expected.challengeToken) ||
    (expected.setFingerprint !== undefined &&
      !sameDigest(receipt.quarantineSetFingerprint, expected.setFingerprint))
  ) {
    stop("QUARANTINE_PROOF_MISMATCH");
  }
  return receipt.quarantineSetFingerprint;
}

function validateJournal(journal: ResetPhaseJournal): void {
  assertSha256Digest(journal.artifactDigest);
  assertSha256Digest(journal.manifestDigest);
  if (journal.quarantineSetFingerprint !== undefined) {
    assertSha256Digest(journal.quarantineSetFingerprint);
  }
}

function phaseRequiresQuarantineProof(phase: ResetPhase): boolean {
  return phase !== "manifest_built" && phase !== "restored";
}

export function advancePhase(
  journal: ResetPhaseJournal,
  nextPhase: ResetPhase,
  freshTarget: FreshTargetGate,
  proofs: ResetPhaseProofs = {},
): ResetPhaseJournal {
  validateJournal(journal);
  if (nextPhase === "restored") {
    if (
      journal.phase !== "objects_quarantined" &&
      journal.phase !== "database_committed" &&
      journal.phase !== "storage_deleting" &&
      journal.phase !== "storage_deleted"
    ) {
      stop("PHASE_STATE_INVALID");
    }
    if (!proofs.rollback) stop("RESTORE_PROOF_MISMATCH");
    assertRollbackProof(
      proofs.rollback.proof,
      freshTarget,
      proofs.rollback.artifact,
    );
    return { ...journal, phase: "restored" };
  }
  if (NEXT_PHASE[journal.phase] !== nextPhase) stop("PHASE_STATE_INVALID");
  const action = PHASE_ACTION[nextPhase];
  if (!action) stop("PHASE_STATE_INVALID");
  assertFreshTargetGate(freshTarget, action, journal.artifactDigest);
  if (nextPhase === "objects_quarantined") {
    const quarantineSetFingerprint = assertQuarantineGate(proofs.quarantine, {
      ...journal,
      challengeToken: freshTarget.currentChallengeToken,
      targetObservationDigest: freshTarget.currentTargetObservationDigest,
      issuedAt: freshTarget.authorization.issuedAt,
      expiresAt: freshTarget.authorization.expiresAt,
      currentTime: freshTarget.currentTime,
    });
    return { ...journal, phase: nextPhase, quarantineSetFingerprint };
  }
  if (phaseRequiresQuarantineProof(journal.phase)) {
    if (!journal.quarantineSetFingerprint) stop("QUARANTINE_PROOF_REQUIRED");
    assertQuarantineGate(proofs.quarantine, {
      ...journal,
      challengeToken: freshTarget.currentChallengeToken,
      targetObservationDigest: freshTarget.currentTargetObservationDigest,
      issuedAt: freshTarget.authorization.issuedAt,
      expiresAt: freshTarget.authorization.expiresAt,
      currentTime: freshTarget.currentTime,
      setFingerprint: journal.quarantineSetFingerprint,
    });
  }
  if (nextPhase === "verified") {
    assertIntegrityGate(proofs.integrity, journal, freshTarget);
  }
  return { ...journal, phase: nextPhase };
}

/** Resolve only exact resumable states. Mixed storage is restored, never guessed. */
export function resolveNextAction(
  journal: ResetPhaseJournal,
  observed: ObservedResetState,
  expected: Readonly<{
    artifactDigest: Sha256Digest;
    manifestDigest: Sha256Digest;
  }>,
  freshTarget: FreshTargetGate,
  proofs: ResetPhaseProofs = {},
): NextResetAction {
  validateJournal(journal);
  assertSha256Digest(expected.artifactDigest);
  assertSha256Digest(expected.manifestDigest);
  if (
    !sameDigest(journal.artifactDigest, expected.artifactDigest) ||
    !sameDigest(journal.manifestDigest, expected.manifestDigest)
  ) {
    stop("PHASE_STATE_INVALID");
  }

  if (observed.database === "mixed" || observed.storage === "mixed") {
    stop("RESTORE_REQUIRED");
  }

  let action: NextResetAction | undefined;
  switch (journal.phase) {
    case "manifest_built":
      if (observed.database === "pre" && observed.storage === "pre") {
        action = "quarantine_objects";
      }
      break;
    case "objects_quarantined":
      if (observed.database === "pre" && observed.storage === "pre") {
        action = "reset_database";
      }
      break;
    case "database_committed":
    case "storage_deleting":
      if (observed.database === "post" && observed.storage === "pre") {
        action = "delete_storage";
      }
      break;
    case "storage_deleted":
      if (observed.database === "post" && observed.storage === "post") {
        action = "verify";
      }
      break;
    case "verified":
      if (observed.database === "post" && observed.storage === "post") {
        action = "noop";
      }
      break;
    case "restored":
      if (observed.database === "pre" && observed.storage === "pre") {
        action = "restored";
      }
      break;
  }

  if (action) {
    const gatedAction = action === "restored" ? "restore" : action;
    assertFreshTargetGate(freshTarget, gatedAction, expected.artifactDigest);
    if (phaseRequiresQuarantineProof(journal.phase)) {
      if (!journal.quarantineSetFingerprint) stop("QUARANTINE_PROOF_REQUIRED");
      assertQuarantineGate(proofs.quarantine, {
        ...expected,
        challengeToken: freshTarget.currentChallengeToken,
        targetObservationDigest: freshTarget.currentTargetObservationDigest,
        issuedAt: freshTarget.authorization.issuedAt,
        expiresAt: freshTarget.authorization.expiresAt,
        currentTime: freshTarget.currentTime,
        setFingerprint: journal.quarantineSetFingerprint,
      });
    }
    if (action === "noop") assertIntegrityGate(proofs.integrity, expected, freshTarget);
    return action;
  }

  if (
    journal.phase === "objects_quarantined" ||
    journal.phase === "database_committed" ||
    journal.phase === "storage_deleting" ||
    journal.phase === "storage_deleted" ||
    journal.phase === "verified"
  ) {
    stop("RESTORE_REQUIRED");
  }
  stop("PHASE_STATE_INVALID");
}

export type RollbackInterruptionPoint =
  | "before_database_commit"
  | "after_database_commit_before_storage_delete"
  | "after_partial_storage_delete";

export type RollbackPlan = Readonly<{
  interruptionPoint: RollbackInterruptionPoint;
  restoreDatabase: true;
  restoreStorage: true;
  verifySchemaAndData: true;
  verifyStorageReferences: true;
  verifyStorageContent: true;
}>;

export function rollbackPlanFor(interruptionPoint: RollbackInterruptionPoint): RollbackPlan {
  return {
    interruptionPoint,
    restoreDatabase: true,
    restoreStorage: true,
    verifySchemaAndData: true,
    verifyStorageReferences: true,
    verifyStorageContent: true,
  };
}

export type RestoreBaseline = Readonly<{
  schemaFingerprint: Sha256Digest;
  resetRows: Readonly<{
    count: number;
    fingerprint: Sha256Digest;
  }>;
  preserved: Readonly<{
    rowCountsFingerprint: Sha256Digest;
    businessFingerprint: Sha256Digest;
  }>;
  storage: Readonly<{
    referencesFingerprint: Sha256Digest;
    resetObjectCount: number;
    resetContentFingerprint: Sha256Digest;
    preservedObjectCount: number;
    preservedContentFingerprint: Sha256Digest;
  }>;
}>;

type RollbackProofBody = Readonly<{
  contract: "sk90-rollback-proof-v1";
  artifactDigest: Sha256Digest;
  manifestDigest: Sha256Digest;
  challengeToken: ProtectedToken;
  targetObservationDigest: Sha256Digest;
  issuedAt: string;
  expiresAt: string;
  interruptionPoint: RollbackInterruptionPoint;
  databaseRestoreCompleted: boolean;
  storageRestoreCompleted: boolean;
  storageContentVerified: boolean;
  before: RestoreBaseline;
  restored: RestoreBaseline;
}>;

export type RollbackProof = RollbackProofBody & Readonly<{ bindingDigest: Sha256Digest }>;

function assertNonnegativeSafeInteger(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) stop("RESTORE_PROOF_MISMATCH");
}

function isExactlyTrue(value: unknown): value is true {
  return value === true;
}

function validateRestoreBaseline(baseline: RestoreBaseline): void {
  assertSha256Digest(baseline.schemaFingerprint);
  assertSha256Digest(baseline.resetRows.fingerprint);
  assertNonnegativeSafeInteger(baseline.resetRows.count);
  assertSha256Digest(baseline.preserved.rowCountsFingerprint);
  assertSha256Digest(baseline.preserved.businessFingerprint);
  assertSha256Digest(baseline.storage.referencesFingerprint);
  assertNonnegativeSafeInteger(baseline.storage.resetObjectCount);
  assertSha256Digest(baseline.storage.resetContentFingerprint);
  assertNonnegativeSafeInteger(baseline.storage.preservedObjectCount);
  assertSha256Digest(baseline.storage.preservedContentFingerprint);
}

function rollbackProofBody(proof: RollbackProofBody): RollbackProofBody {
  const contract: unknown = proof.contract;
  if (contract !== "sk90-rollback-proof-v1") stop("RESTORE_PROOF_MISMATCH");
  assertSha256Digest(proof.artifactDigest);
  assertSha256Digest(proof.manifestDigest);
  assertFreshProofWindow(proof);
  const interruptionPoint: unknown = proof.interruptionPoint;
  if (
    interruptionPoint !== "before_database_commit" &&
    interruptionPoint !== "after_database_commit_before_storage_delete" &&
    interruptionPoint !== "after_partial_storage_delete"
  ) {
    stop("RESTORE_PROOF_MISMATCH");
  }
  validateRestoreBaseline(proof.before);
  validateRestoreBaseline(proof.restored);
  return {
    contract: proof.contract,
    artifactDigest: proof.artifactDigest,
    manifestDigest: proof.manifestDigest,
    challengeToken: proof.challengeToken,
    targetObservationDigest: proof.targetObservationDigest,
    issuedAt: proof.issuedAt,
    expiresAt: proof.expiresAt,
    interruptionPoint: proof.interruptionPoint,
    databaseRestoreCompleted: proof.databaseRestoreCompleted,
    storageRestoreCompleted: proof.storageRestoreCompleted,
    storageContentVerified: proof.storageContentVerified,
    before: proof.before,
    restored: proof.restored,
  };
}

export function bindRollbackProof(proof: RollbackProofBody): RollbackProof {
  const body = rollbackProofBody(proof);
  return { ...body, bindingDigest: sha256Digest(canonicalJson(body)) };
}

function expectedRestoreBaseline(artifact: ApprovedResetArtifact): RestoreBaseline {
  const expected = artifact.postResetExpectations;
  return {
    schemaFingerprint: artifact.reviewedBaseline.schemaFingerprint,
    resetRows: {
      count: expected.resetRowCount,
      fingerprint: expected.resetRowsFingerprint,
    },
    preserved: {
      rowCountsFingerprint: expected.preservedRowCountsFingerprint,
      businessFingerprint: expected.preservedBusinessFingerprint,
    },
    storage: {
      referencesFingerprint: artifact.reviewedBaseline.storageReferencesFingerprint,
      resetObjectCount: expected.resetStorageObjectCount,
      resetContentFingerprint: expected.resetStorageObjectsFingerprint,
      preservedObjectCount: expected.preservedStorageObjectCount,
      preservedContentFingerprint: expected.preservedStorageContentFingerprint,
    },
  };
}

export function assertRollbackProof(
  proof: RollbackProof,
  freshTarget: FreshTargetGate,
  artifact: ApprovedResetArtifact,
): Readonly<{ interruptionPoint: RollbackInterruptionPoint; restored: true }> {
  assertApprovedResetArtifact(artifact);
  assertFreshTargetGate(freshTarget, "restore", artifact.digest);
  const rebound = bindRollbackProof(proof);
  assertSha256Digest(proof.bindingDigest);
  assertFreshProofObservation(proof, {
    challengeToken: freshTarget.currentChallengeToken,
    targetObservationDigest: freshTarget.currentTargetObservationDigest,
    issuedAt: freshTarget.authorization.issuedAt,
    expiresAt: freshTarget.authorization.expiresAt,
    currentTime: freshTarget.currentTime,
  });
  const expected = expectedRestoreBaseline(artifact);

  if (
    !sameDigest(proof.bindingDigest, rebound.bindingDigest) ||
    !sameDigest(proof.artifactDigest, artifact.digest) ||
    !sameDigest(proof.manifestDigest, artifact.manifestDigest) ||
    !sameDigest(proof.targetObservationDigest, freshTarget.currentTargetObservationDigest) ||
    !isExactlyTrue(proof.databaseRestoreCompleted) ||
    !isExactlyTrue(proof.storageRestoreCompleted) ||
    !isExactlyTrue(proof.storageContentVerified) ||
    canonicalJson(proof.before) !== canonicalJson(expected) ||
    canonicalJson(proof.restored) !== canonicalJson(expected)
  ) {
    stop("RESTORE_PROOF_MISMATCH");
  }

  return { interruptionPoint: proof.interruptionPoint, restored: true };
}
