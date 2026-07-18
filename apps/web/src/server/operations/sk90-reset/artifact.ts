import {
  assertProtectedToken,
  assertSha256Digest,
  canonicalJson,
  compareUtf8Bytes,
  sameDigest,
  sha256Digest,
  type ProtectedToken,
  type Sha256Digest,
} from "./canonical";
import { assertFinalLockedSnapshot, type ResetFingerprintSnapshot } from "./contract";
import { stop } from "./errors";
import {
  assertManifestDigest,
  assertStorageReferenceCoverageShape,
  SK90_RESET_ARTIFACT_VERSION,
  type SanitizedResetManifest,
} from "./manifest";
import {
  assertFreshProofObservation,
  assertFreshProofWindow,
  assertMockOnlyEvidence,
  assertMockEvidenceCoverageShape,
  mockEvidenceObservationDigest,
  targetObservationDigest,
  type MockEvidence,
  type MockEvidenceSummary,
  type FreshProofExpectation,
  type RehearsalTargetApproval,
} from "./policy";
import type { ResetPhaseJournal } from "./state";

export type ChallengeBoundDiscoveryEvidence = Readonly<{
  challengeToken: ProtectedToken;
  targetObservationDigest: Sha256Digest;
  resetRowsObservationDigest: Sha256Digest;
  mockEvidenceObservationDigest: Sha256Digest;
  storageReferencesObservationDigest: Sha256Digest;
  storageEnumerationDigest: Sha256Digest;
  bindingDigest: Sha256Digest;
}>;

export const SK90_APPROVED_RESET_ARTIFACT_CONTRACT = "sk90-approved-reset-artifact-v1" as const;

type ResetArtifactBody = Readonly<{
  contract: typeof SK90_APPROVED_RESET_ARTIFACT_CONTRACT;
  artifactVersion: string;
  target: RehearsalTargetApproval;
  manifestDigest: Sha256Digest;
  mockEvidenceSummary: MockEvidenceSummary;
  mockEvidenceCoverage: SanitizedResetManifest["mockEvidenceCoverage"];
  storageReferenceCoverage: SanitizedResetManifest["storageReferenceCoverage"];
  reviewedBaseline: ResetFingerprintSnapshot;
  discoveryEvidence: ChallengeBoundDiscoveryEvidence;
  postResetExpectations: PostResetExpectations;
}>;

export type PostResetExpectations = Readonly<{
  targetSchemaFingerprint: Sha256Digest;
  resetRowsFingerprint: Sha256Digest;
  resetRowCount: number;
  preservedRowCountsFingerprint: Sha256Digest;
  preservedBusinessFingerprint: Sha256Digest;
  resetStorageObjectsFingerprint: Sha256Digest;
  resetStorageObjectCount: number;
  preservedStorageContentFingerprint: Sha256Digest;
  preservedStorageObjectCount: number;
}>;

export type ApprovedResetArtifact = ResetArtifactBody &
  Readonly<{
    digest: Sha256Digest;
  }>;

export type PreparedResetRun = Readonly<{
  artifact: ApprovedResetArtifact;
  journal: ResetPhaseJournal & Readonly<{ phase: "manifest_built" }>;
}>;

const SAFE_ARTIFACT_VERSION = /^[a-z0-9][a-z0-9_-]{0,79}$/;

function discoveryBody(
  evidence: Omit<ChallengeBoundDiscoveryEvidence, "bindingDigest">,
): Omit<ChallengeBoundDiscoveryEvidence, "bindingDigest"> {
  return {
    challengeToken: evidence.challengeToken,
    targetObservationDigest: evidence.targetObservationDigest,
    resetRowsObservationDigest: evidence.resetRowsObservationDigest,
    mockEvidenceObservationDigest: evidence.mockEvidenceObservationDigest,
    storageReferencesObservationDigest: evidence.storageReferencesObservationDigest,
    storageEnumerationDigest: evidence.storageEnumerationDigest,
  };
}

export function bindDiscoveryEvidence(
  evidence: Omit<ChallengeBoundDiscoveryEvidence, "bindingDigest">,
): ChallengeBoundDiscoveryEvidence {
  assertProtectedToken(evidence.challengeToken);
  assertSha256Digest(evidence.targetObservationDigest);
  assertSha256Digest(evidence.resetRowsObservationDigest);
  assertSha256Digest(evidence.mockEvidenceObservationDigest);
  assertSha256Digest(evidence.storageReferencesObservationDigest);
  assertSha256Digest(evidence.storageEnumerationDigest);
  const body = discoveryBody(evidence);
  return { ...body, bindingDigest: sha256Digest(canonicalJson(body)) };
}

function assertDiscoveryEvidence(evidence: ChallengeBoundDiscoveryEvidence): void {
  const observed = bindDiscoveryEvidence(evidence);
  assertSha256Digest(evidence.bindingDigest);
  if (!sameDigest(observed.bindingDigest, evidence.bindingDigest)) {
    stop("ARTIFACT_BINDING_MISMATCH");
  }
}

function artifactBody(artifact: ApprovedResetArtifact): ResetArtifactBody {
  return {
    contract: artifact.contract,
    artifactVersion: artifact.artifactVersion,
    target: artifact.target,
    manifestDigest: artifact.manifestDigest,
    mockEvidenceSummary: artifact.mockEvidenceSummary,
    mockEvidenceCoverage: artifact.mockEvidenceCoverage,
    storageReferenceCoverage: artifact.storageReferenceCoverage,
    reviewedBaseline: artifact.reviewedBaseline,
    discoveryEvidence: artifact.discoveryEvidence,
    postResetExpectations: artifact.postResetExpectations,
  };
}

function assertNonnegativeSafeInteger(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) stop("POST_RESET_INTEGRITY_MISMATCH");
}

function isExactlyTrue(value: unknown): value is true {
  return value === true;
}

function assertPostResetExpectations(expectations: PostResetExpectations): void {
  assertSha256Digest(expectations.targetSchemaFingerprint);
  assertSha256Digest(expectations.resetRowsFingerprint);
  assertSha256Digest(expectations.preservedRowCountsFingerprint);
  assertSha256Digest(expectations.preservedBusinessFingerprint);
  assertSha256Digest(expectations.resetStorageObjectsFingerprint);
  assertSha256Digest(expectations.preservedStorageContentFingerprint);
  assertNonnegativeSafeInteger(expectations.resetRowCount);
  assertNonnegativeSafeInteger(expectations.resetStorageObjectCount);
  assertNonnegativeSafeInteger(expectations.preservedStorageObjectCount);
}

function assertArtifactBody(body: ResetArtifactBody): void {
  const observedContract: unknown = body.contract;
  if (
    observedContract !== SK90_APPROVED_RESET_ARTIFACT_CONTRACT ||
    body.artifactVersion !== SK90_RESET_ARTIFACT_VERSION ||
    !SAFE_ARTIFACT_VERSION.test(body.artifactVersion)
  ) {
    stop("ARTIFACT_BINDING_MISMATCH");
  }
  const targetClass: string = body.target.targetClass;
  if (targetClass !== "isolated_nonproduction") {
    stop("ARTIFACT_BINDING_MISMATCH");
  }
  assertSha256Digest(body.target.databaseFingerprint);
  assertSha256Digest(body.target.storageFingerprint);
  assertSha256Digest(body.target.policyDigest);
  assertSha256Digest(body.manifestDigest);
  assertMockEvidenceCoverageShape(body.mockEvidenceCoverage);
  assertStorageReferenceCoverageShape(body.storageReferenceCoverage);
  assertDiscoveryEvidence(body.discoveryEvidence);
  assertPostResetExpectations(body.postResetExpectations);
  for (const digest of Object.values(body.reviewedBaseline)) assertSha256Digest(digest);
  if (
    !sameDigest(body.reviewedBaseline.manifestDigest, body.manifestDigest) ||
    body.mockEvidenceSummary.identityCount !== body.mockEvidenceCoverage.identityCount ||
    body.mockEvidenceSummary.monetaryRowCount !== body.mockEvidenceCoverage.monetaryRowCount ||
    body.mockEvidenceSummary.providerReferenceCount !==
      body.mockEvidenceCoverage.providerReferenceCount ||
    !sameDigest(
      body.discoveryEvidence.targetObservationDigest,
      targetObservationDigest(body.target),
    ) ||
    !sameDigest(
      body.discoveryEvidence.resetRowsObservationDigest,
      body.reviewedBaseline.resetRowsFingerprint,
    ) ||
    !sameDigest(
      body.discoveryEvidence.storageReferencesObservationDigest,
      body.reviewedBaseline.storageReferencesFingerprint,
    ) ||
    !sameDigest(
      body.reviewedBaseline.resetRowsFingerprint,
      body.postResetExpectations.resetRowsFingerprint,
    ) ||
    !sameDigest(
      body.reviewedBaseline.preservedRowCountsFingerprint,
      body.postResetExpectations.preservedRowCountsFingerprint,
    ) ||
    !sameDigest(
      body.reviewedBaseline.preservedBusinessFingerprint,
      body.postResetExpectations.preservedBusinessFingerprint,
    )
  ) {
    stop("ARTIFACT_BINDING_MISMATCH");
  }
}

export function prepareResetRun(
  input: Readonly<{
    artifactVersion: string;
    target: RehearsalTargetApproval;
    manifest: SanitizedResetManifest;
    mockEvidence: MockEvidence;
    reviewedBaseline: ResetFingerprintSnapshot;
    discoveryEvidence: ChallengeBoundDiscoveryEvidence;
  }>,
): PreparedResetRun {
  assertManifestDigest(input.manifest);
  if (
    input.artifactVersion !== SK90_RESET_ARTIFACT_VERSION ||
    input.artifactVersion !== input.manifest.artifactVersion
  ) {
    stop("ARTIFACT_BINDING_MISMATCH");
  }
  const mockEvidenceSummary = assertMockOnlyEvidence(
    input.mockEvidence,
    input.manifest.mockEvidenceCoverage,
  );
  const observedMockEvidenceDigest = mockEvidenceObservationDigest(input.mockEvidence);
  if (
    !sameDigest(input.target.policyDigest, input.manifest.targetPolicyDigest) ||
    !sameDigest(input.reviewedBaseline.schemaFingerprint, input.manifest.preSchemaFingerprint) ||
    !sameDigest(input.reviewedBaseline.resetRowsFingerprint, input.manifest.resetRowsFingerprint) ||
    !sameDigest(
      input.reviewedBaseline.preservedRowCountsFingerprint,
      input.manifest.preservedRowCountsFingerprint,
    ) ||
    !sameDigest(
      input.reviewedBaseline.preservedBusinessFingerprint,
      input.manifest.preservedBusinessFingerprint,
    ) ||
    !sameDigest(
      input.reviewedBaseline.storageReferencesFingerprint,
      input.manifest.storageReferencesFingerprint,
    ) ||
    !sameDigest(
      input.discoveryEvidence.targetObservationDigest,
      targetObservationDigest(input.target),
    ) ||
    !sameDigest(
      input.discoveryEvidence.resetRowsObservationDigest,
      input.manifest.resetRowsFingerprint,
    ) ||
    !sameDigest(input.discoveryEvidence.mockEvidenceObservationDigest, observedMockEvidenceDigest)
  ) {
    stop("ARTIFACT_BINDING_MISMATCH");
  }

  const body: ResetArtifactBody = {
    contract: SK90_APPROVED_RESET_ARTIFACT_CONTRACT,
    artifactVersion: input.artifactVersion,
    target: input.target,
    manifestDigest: input.manifest.digest,
    mockEvidenceSummary,
    mockEvidenceCoverage: input.manifest.mockEvidenceCoverage,
    storageReferenceCoverage: input.manifest.storageReferenceCoverage,
    reviewedBaseline: input.reviewedBaseline,
    discoveryEvidence: input.discoveryEvidence,
    postResetExpectations: {
      targetSchemaFingerprint: input.manifest.reviewedTargetSchemaFingerprint,
      resetRowsFingerprint: input.manifest.resetRowsFingerprint,
      resetRowCount: input.manifest.aggregates.resetRowCount,
      preservedRowCountsFingerprint: input.manifest.preservedRowCountsFingerprint,
      preservedBusinessFingerprint: input.manifest.preservedBusinessFingerprint,
      resetStorageObjectsFingerprint: input.manifest.resetStorageObjectsFingerprint,
      resetStorageObjectCount: input.manifest.aggregates.resetStorageObjectCount,
      preservedStorageContentFingerprint: input.manifest.preservedStorageContentFingerprint,
      preservedStorageObjectCount: input.manifest.aggregates.preservedStorageObjectCount,
    },
  };
  assertArtifactBody(body);
  const artifact: ApprovedResetArtifact = {
    ...body,
    digest: sha256Digest(canonicalJson(body)),
  };
  return {
    artifact,
    journal: {
      artifactDigest: artifact.digest,
      manifestDigest: input.manifest.digest,
      phase: "manifest_built",
    },
  };
}

export function assertApprovedResetArtifact(artifact: ApprovedResetArtifact): true {
  assertArtifactBody(artifact);
  assertSha256Digest(artifact.digest);
  if (!sameDigest(artifact.digest, sha256Digest(canonicalJson(artifactBody(artifact))))) {
    stop("ARTIFACT_DIGEST_MISMATCH");
  }
  return true;
}

/**
 * Compose the final mutation gate from one artifact-bound baseline. The
 * external adapter still has to collect the under-lock snapshot in the same
 * serializable transaction; this function performs no I/O.
 */
export function assertArtifactLockedSnapshot(
  artifact: ApprovedResetArtifact,
  evidence: Parameters<typeof assertFinalLockedSnapshot>[0],
): ResetFingerprintSnapshot {
  assertApprovedResetArtifact(artifact);
  if (
    !sameDigest(evidence.reviewed.manifestDigest, artifact.manifestDigest) ||
    canonicalJson(evidence.reviewed) !== canonicalJson(artifact.reviewedBaseline)
  ) {
    stop("ARTIFACT_BINDING_MISMATCH");
  }
  return assertFinalLockedSnapshot(evidence);
}

type PostResetIntegrityBody = Readonly<{
  contract: "sk90-post-reset-integrity-proof-v1";
  artifactDigest: Sha256Digest;
  manifestDigest: Sha256Digest;
  challengeToken: ProtectedToken;
  targetObservationDigest: Sha256Digest;
  issuedAt: string;
  expiresAt: string;
  schemaFingerprint: Sha256Digest;
  resetRows: Readonly<{
    beforeCount: number;
    beforeFingerprint: Sha256Digest;
    deletedCount: number;
    deletedFingerprint: Sha256Digest;
    remainingCount: number;
    remainingFingerprint: Sha256Digest;
  }>;
  preserved: Readonly<{
    rowCountsFingerprint: Sha256Digest;
    businessFingerprint: Sha256Digest;
  }>;
  relationalIntegrity: Readonly<{
    foreignKeyViolationCount: number;
    orphanRowCount: number;
    ownershipViolationCount: number;
  }>;
  prohibitedRows: Readonly<{
    legacyCommercialRowCount: number;
    syntheticPurchaseCount: number;
  }>;
  storage: Readonly<{
    deletedObjectCount: number;
    deletedObjectsFingerprint: Sha256Digest;
    preservedObjectCount: number;
    preservedContentFingerprint: Sha256Digest;
  }>;
}>;

export type PostResetIntegrityProof = PostResetIntegrityBody &
  Readonly<{ bindingDigest: Sha256Digest }>;

export type PostResetIntegrityReceipt = Readonly<{
  artifactDigest: Sha256Digest;
  manifestDigest: Sha256Digest;
  proofDigest: Sha256Digest;
  verified: true;
}>;

function postResetIntegrityBody(proof: PostResetIntegrityBody): PostResetIntegrityBody {
  return {
    contract: proof.contract,
    artifactDigest: proof.artifactDigest,
    manifestDigest: proof.manifestDigest,
    challengeToken: proof.challengeToken,
    targetObservationDigest: proof.targetObservationDigest,
    issuedAt: proof.issuedAt,
    expiresAt: proof.expiresAt,
    schemaFingerprint: proof.schemaFingerprint,
    resetRows: proof.resetRows,
    preserved: proof.preserved,
    relationalIntegrity: proof.relationalIntegrity,
    prohibitedRows: proof.prohibitedRows,
    storage: proof.storage,
  };
}

function assertPostResetIntegrityShape(proof: PostResetIntegrityBody): void {
  const contract: unknown = proof.contract;
  if (contract !== "sk90-post-reset-integrity-proof-v1") {
    stop("POST_RESET_INTEGRITY_MISMATCH");
  }
  assertFreshProofWindow(proof);
  assertSha256Digest(proof.artifactDigest);
  assertSha256Digest(proof.manifestDigest);
  assertSha256Digest(proof.schemaFingerprint);
  assertSha256Digest(proof.resetRows.beforeFingerprint);
  assertSha256Digest(proof.resetRows.deletedFingerprint);
  assertSha256Digest(proof.resetRows.remainingFingerprint);
  assertSha256Digest(proof.preserved.rowCountsFingerprint);
  assertSha256Digest(proof.preserved.businessFingerprint);
  assertSha256Digest(proof.storage.deletedObjectsFingerprint);
  assertSha256Digest(proof.storage.preservedContentFingerprint);
  for (const count of [
    proof.resetRows.beforeCount,
    proof.resetRows.deletedCount,
    proof.resetRows.remainingCount,
    proof.relationalIntegrity.foreignKeyViolationCount,
    proof.relationalIntegrity.orphanRowCount,
    proof.relationalIntegrity.ownershipViolationCount,
    proof.prohibitedRows.legacyCommercialRowCount,
    proof.prohibitedRows.syntheticPurchaseCount,
    proof.storage.deletedObjectCount,
    proof.storage.preservedObjectCount,
  ]) {
    assertNonnegativeSafeInteger(count);
  }
}

export function bindPostResetIntegrityProof(
  proof: PostResetIntegrityBody,
): PostResetIntegrityProof {
  const body = postResetIntegrityBody(proof);
  assertPostResetIntegrityShape(body);
  return { ...body, bindingDigest: sha256Digest(canonicalJson(body)) };
}

export function assertPostResetIntegrityProof(
  artifact: ApprovedResetArtifact,
  proof: PostResetIntegrityProof,
  freshExpectation: FreshProofExpectation,
): PostResetIntegrityReceipt {
  assertApprovedResetArtifact(artifact);
  const rebound = bindPostResetIntegrityProof(proof);
  assertSha256Digest(proof.bindingDigest);
  assertFreshProofObservation(proof, freshExpectation);
  const expected = artifact.postResetExpectations;
  const emptyRowsFingerprint = sha256Digest(canonicalJson([]));
  if (
    !sameDigest(proof.bindingDigest, rebound.bindingDigest) ||
    !sameDigest(proof.artifactDigest, artifact.digest) ||
    !sameDigest(proof.manifestDigest, artifact.manifestDigest) ||
    !sameDigest(proof.targetObservationDigest, targetObservationDigest(artifact.target)) ||
    !sameDigest(proof.schemaFingerprint, expected.targetSchemaFingerprint) ||
    proof.resetRows.beforeCount !== expected.resetRowCount ||
    !sameDigest(proof.resetRows.beforeFingerprint, expected.resetRowsFingerprint) ||
    proof.resetRows.deletedCount !== expected.resetRowCount ||
    !sameDigest(proof.resetRows.deletedFingerprint, expected.resetRowsFingerprint) ||
    proof.resetRows.remainingCount !== 0 ||
    !sameDigest(proof.resetRows.remainingFingerprint, emptyRowsFingerprint) ||
    !sameDigest(proof.preserved.rowCountsFingerprint, expected.preservedRowCountsFingerprint) ||
    !sameDigest(proof.preserved.businessFingerprint, expected.preservedBusinessFingerprint) ||
    proof.relationalIntegrity.foreignKeyViolationCount !== 0 ||
    proof.relationalIntegrity.orphanRowCount !== 0 ||
    proof.relationalIntegrity.ownershipViolationCount !== 0 ||
    proof.prohibitedRows.legacyCommercialRowCount !== 0 ||
    proof.prohibitedRows.syntheticPurchaseCount !== 0 ||
    proof.storage.deletedObjectCount !== expected.resetStorageObjectCount ||
    !sameDigest(proof.storage.deletedObjectsFingerprint, expected.resetStorageObjectsFingerprint) ||
    proof.storage.preservedObjectCount !== expected.preservedStorageObjectCount ||
    !sameDigest(
      proof.storage.preservedContentFingerprint,
      expected.preservedStorageContentFingerprint,
    )
  ) {
    stop("POST_RESET_INTEGRITY_MISMATCH");
  }
  return {
    artifactDigest: artifact.digest,
    manifestDigest: artifact.manifestDigest,
    proofDigest: proof.bindingDigest,
    verified: true,
  };
}

export type QuarantineCopyEvidence = Readonly<{
  bucketRole: "audio" | "docs";
  protectedSourceKey: ProtectedToken;
  sourceContentFingerprint: Sha256Digest;
  protectedCopyKey: ProtectedToken;
  copyContentFingerprint: Sha256Digest;
  copyExists: boolean;
  restoreVerified: boolean;
}>;

type QuarantineProofBody = Readonly<{
  contract: "sk90-quarantine-proof-v1";
  artifactDigest: Sha256Digest;
  manifestDigest: Sha256Digest;
  observationChallengeToken: ProtectedToken;
  targetObservationDigest: Sha256Digest;
  issuedAt: string;
  expiresAt: string;
  copies: readonly QuarantineCopyEvidence[];
}>;

export type QuarantineProof = QuarantineProofBody & Readonly<{ bindingDigest: Sha256Digest }>;

export type QuarantineProofReceipt = Readonly<{
  artifactDigest: Sha256Digest;
  manifestDigest: Sha256Digest;
  proofDigest: Sha256Digest;
  quarantineSetFingerprint: Sha256Digest;
  verified: true;
}>;

function normalizeQuarantineCopies(
  copies: readonly QuarantineCopyEvidence[],
): QuarantineCopyEvidence[] {
  const observedCopies: unknown = copies;
  if (!Array.isArray(observedCopies)) stop("QUARANTINE_PROOF_MISMATCH");
  const sources = new Set<string>();
  const targets = new Set<string>();
  const normalized = copies.map((copy) => {
    const bucketRole: unknown = copy.bucketRole;
    if (bucketRole !== "audio" && bucketRole !== "docs") {
      stop("QUARANTINE_PROOF_MISMATCH");
    }
    assertProtectedToken(copy.protectedSourceKey);
    assertProtectedToken(copy.protectedCopyKey);
    assertSha256Digest(copy.sourceContentFingerprint);
    assertSha256Digest(copy.copyContentFingerprint);
    if (typeof copy.copyExists !== "boolean" || typeof copy.restoreVerified !== "boolean") {
      stop("QUARANTINE_PROOF_MISMATCH");
    }
    const sourceIdentity = `${copy.bucketRole}\0${copy.protectedSourceKey}`;
    const targetIdentity = `${copy.bucketRole}\0${copy.protectedCopyKey}`;
    if (sources.has(sourceIdentity) || targets.has(targetIdentity)) {
      stop("QUARANTINE_PROOF_MISMATCH");
    }
    sources.add(sourceIdentity);
    targets.add(targetIdentity);
    return {
      bucketRole: copy.bucketRole,
      protectedSourceKey: copy.protectedSourceKey,
      sourceContentFingerprint: copy.sourceContentFingerprint,
      protectedCopyKey: copy.protectedCopyKey,
      copyContentFingerprint: copy.copyContentFingerprint,
      copyExists: copy.copyExists,
      restoreVerified: copy.restoreVerified,
    };
  });
  for (const target of targets) {
    if (sources.has(target)) stop("QUARANTINE_PROOF_MISMATCH");
  }
  normalized.sort((left, right) =>
    compareUtf8Bytes(
      `${left.bucketRole}:${left.protectedSourceKey}`,
      `${right.bucketRole}:${right.protectedSourceKey}`,
    ),
  );
  return normalized;
}

function quarantineProofBody(proof: QuarantineProofBody): QuarantineProofBody {
  const contract: unknown = proof.contract;
  if (contract !== "sk90-quarantine-proof-v1") stop("QUARANTINE_PROOF_MISMATCH");
  assertSha256Digest(proof.artifactDigest);
  assertSha256Digest(proof.manifestDigest);
  assertProtectedToken(proof.observationChallengeToken);
  assertFreshProofWindow({
    challengeToken: proof.observationChallengeToken,
    targetObservationDigest: proof.targetObservationDigest,
    issuedAt: proof.issuedAt,
    expiresAt: proof.expiresAt,
  });
  return {
    contract: proof.contract,
    artifactDigest: proof.artifactDigest,
    manifestDigest: proof.manifestDigest,
    observationChallengeToken: proof.observationChallengeToken,
    targetObservationDigest: proof.targetObservationDigest,
    issuedAt: proof.issuedAt,
    expiresAt: proof.expiresAt,
    copies: normalizeQuarantineCopies(proof.copies),
  };
}

function quarantineSetFingerprint(copies: readonly QuarantineCopyEvidence[]): Sha256Digest {
  return sha256Digest(canonicalJson(copies));
}

function quarantineSourceFingerprint(copies: readonly QuarantineCopyEvidence[]): Sha256Digest {
  return sha256Digest(
    canonicalJson(
      copies.map((copy) => ({
        bucketRole: copy.bucketRole,
        protectedKey: copy.protectedSourceKey,
        contentFingerprint: copy.sourceContentFingerprint,
      })),
    ),
  );
}

export function bindQuarantineProof(proof: QuarantineProofBody): QuarantineProof {
  const body = quarantineProofBody(proof);
  return { ...body, bindingDigest: sha256Digest(canonicalJson(body)) };
}

export function assertQuarantineProof(
  artifact: ApprovedResetArtifact,
  proof: QuarantineProof,
  freshExpectation: FreshProofExpectation,
): QuarantineProofReceipt {
  assertApprovedResetArtifact(artifact);
  const rebound = bindQuarantineProof(proof);
  assertSha256Digest(proof.bindingDigest);
  assertFreshProofObservation(
    {
      challengeToken: proof.observationChallengeToken,
      targetObservationDigest: proof.targetObservationDigest,
      issuedAt: proof.issuedAt,
      expiresAt: proof.expiresAt,
    },
    freshExpectation,
  );
  if (
    !sameDigest(proof.bindingDigest, rebound.bindingDigest) ||
    !sameDigest(proof.artifactDigest, artifact.digest) ||
    !sameDigest(proof.manifestDigest, artifact.manifestDigest) ||
    !sameDigest(proof.targetObservationDigest, targetObservationDigest(artifact.target)) ||
    proof.copies.length !== artifact.postResetExpectations.resetStorageObjectCount ||
    !sameDigest(
      quarantineSourceFingerprint(rebound.copies),
      artifact.postResetExpectations.resetStorageObjectsFingerprint,
    )
  ) {
    stop("QUARANTINE_PROOF_MISMATCH");
  }
  for (const copy of rebound.copies) {
    if (
      !isExactlyTrue(copy.copyExists) ||
      !isExactlyTrue(copy.restoreVerified) ||
      sameDigest(copy.protectedSourceKey, copy.protectedCopyKey) ||
      !sameDigest(copy.sourceContentFingerprint, copy.copyContentFingerprint)
    ) {
      stop("QUARANTINE_PROOF_MISMATCH");
    }
  }
  return {
    artifactDigest: artifact.digest,
    manifestDigest: artifact.manifestDigest,
    proofDigest: proof.bindingDigest,
    quarantineSetFingerprint: quarantineSetFingerprint(rebound.copies),
    verified: true,
  };
}
