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
import { stop } from "./errors";

type FingerprintBoundary = Readonly<{
  observed: string;
  approved: string;
  forbidden: readonly string[];
}>;

export type RehearsalTargetPolicy = Readonly<{
  targetClass: string;
  database: FingerprintBoundary;
  storage: FingerprintBoundary;
  isolation: Readonly<{
    databaseRestorePointReady: boolean;
    storageRestorePointReady: boolean;
    exclusiveStorageNamespace: boolean;
    exclusiveStorageWriter: boolean;
  }>;
}>;

export type RehearsalTargetApproval = Readonly<{
  targetClass: "isolated_nonproduction";
  databaseFingerprint: Sha256Digest;
  storageFingerprint: Sha256Digest;
  policyDigest: Sha256Digest;
}>;

export function targetObservationDigest(target: RehearsalTargetApproval): Sha256Digest {
  return sha256Digest(
    canonicalJson({
      databaseFingerprint: target.databaseFingerprint,
      policyDigest: target.policyDigest,
      storageFingerprint: target.storageFingerprint,
      targetClass: target.targetClass,
    }),
  );
}

function validateBoundary(boundary: FingerprintBoundary): void {
  assertSha256Digest(boundary.observed);
  assertSha256Digest(boundary.approved);
  for (const forbidden of boundary.forbidden) assertSha256Digest(forbidden);
}

function isForbidden(observed: string, forbidden: readonly string[]): boolean {
  return forbidden.some((fingerprint) => sameDigest(observed, fingerprint));
}

export function rehearsalTargetPolicyDigest(policy: RehearsalTargetPolicy): Sha256Digest {
  return sha256Digest(
    canonicalJson({
      contract: "sk90-isolated-target-v1",
      targetClass: policy.targetClass,
      database: {
        approved: policy.database.approved,
        forbidden: [...policy.database.forbidden].sort(),
        observed: policy.database.observed,
      },
      storage: {
        approved: policy.storage.approved,
        forbidden: [...policy.storage.forbidden].sort(),
        observed: policy.storage.observed,
      },
      isolation: policy.isolation,
    }),
  );
}

/**
 * Approve only an exact, externally fingerprinted isolated target. This pure
 * function does not discover a target and cannot turn an operator assertion
 * into evidence; a future adapter must supply independently observed values.
 */
export function assertRehearsalTarget(
  policy: RehearsalTargetPolicy,
  approvalPolicyDigest: Sha256Digest,
): RehearsalTargetApproval {
  if (policy.targetClass !== "isolated_nonproduction") stop("TARGET_NOT_ISOLATED");

  validateBoundary(policy.database);
  validateBoundary(policy.storage);
  assertSha256Digest(approvalPolicyDigest);
  if (
    policy.database.forbidden.length !== 2 ||
    new Set(policy.database.forbidden).size !== 2 ||
    policy.storage.forbidden.length < 1 ||
    new Set(policy.storage.forbidden).size !== policy.storage.forbidden.length
  ) {
    stop("FINGERPRINT_INVALID");
  }

  const policyDigest = rehearsalTargetPolicyDigest(policy);
  if (!sameDigest(policyDigest, approvalPolicyDigest)) {
    stop("TARGET_POLICY_MISMATCH");
  }

  if (isForbidden(policy.database.observed, policy.database.forbidden)) {
    stop("DATABASE_TARGET_FORBIDDEN");
  }
  if (!sameDigest(policy.database.observed, policy.database.approved)) {
    stop("DATABASE_TARGET_MISMATCH");
  }
  if (isForbidden(policy.storage.observed, policy.storage.forbidden)) {
    stop("STORAGE_TARGET_FORBIDDEN");
  }
  if (!sameDigest(policy.storage.observed, policy.storage.approved)) {
    stop("STORAGE_TARGET_MISMATCH");
  }

  if (
    !isExactlyTrue(policy.isolation.databaseRestorePointReady) ||
    !isExactlyTrue(policy.isolation.storageRestorePointReady)
  ) {
    stop("RESTORE_POINT_NOT_READY");
  }
  if (
    !isExactlyTrue(policy.isolation.exclusiveStorageNamespace) ||
    !isExactlyTrue(policy.isolation.exclusiveStorageWriter)
  ) {
    stop("STORAGE_ISOLATION_NOT_PROVEN");
  }

  const databaseFingerprint = policy.database.observed;
  const storageFingerprint = policy.storage.observed;
  assertSha256Digest(databaseFingerprint);
  assertSha256Digest(storageFingerprint);

  return {
    targetClass: "isolated_nonproduction",
    databaseFingerprint,
    storageFingerprint,
    policyDigest,
  };
}

export const TARGET_GATED_RESET_ACTIONS = [
  "quarantine_objects",
  "reset_database",
  "delete_storage",
  "verify",
  "noop",
  "restore",
] as const;

export type TargetGatedResetAction = (typeof TARGET_GATED_RESET_ACTIONS)[number];

type FreshTargetAuthorizationBody = Readonly<{
  contract: "sk90-fresh-target-authorization-v1";
  action: TargetGatedResetAction;
  artifactDigest: Sha256Digest;
  challengeToken: ProtectedToken;
  targetObservationDigest: Sha256Digest;
}>;

export type FreshTargetAuthorization = FreshTargetAuthorizationBody &
  Readonly<{ authorizationDigest: Sha256Digest }>;

function freshTargetAuthorizationBody(
  authorization: FreshTargetAuthorizationBody,
): FreshTargetAuthorizationBody {
  return {
    contract: authorization.contract,
    action: authorization.action,
    artifactDigest: authorization.artifactDigest,
    challengeToken: authorization.challengeToken,
    targetObservationDigest: authorization.targetObservationDigest,
  };
}

function assertTargetGatedAction(action: string): asserts action is TargetGatedResetAction {
  if (!(TARGET_GATED_RESET_ACTIONS as readonly string[]).includes(action)) {
    stop("FRESH_TARGET_AUTHORIZATION_INVALID");
  }
}

/**
 * Bind one freshly observed target to one external phase. The adapter must use
 * a new discovery challenge and call this immediately before each phase.
 */
export function authorizeFreshTargetAction(
  input: Readonly<{
    action: TargetGatedResetAction;
    artifactDigest: Sha256Digest;
    approvedTarget: RehearsalTargetApproval;
    freshPolicy: RehearsalTargetPolicy;
    challengeToken: ProtectedToken;
  }>,
): FreshTargetAuthorization {
  assertTargetGatedAction(input.action);
  assertSha256Digest(input.artifactDigest);
  assertProtectedToken(input.challengeToken);
  assertSha256Digest(input.approvedTarget.databaseFingerprint);
  assertSha256Digest(input.approvedTarget.storageFingerprint);
  assertSha256Digest(input.approvedTarget.policyDigest);
  validateBoundary(input.freshPolicy.database);
  validateBoundary(input.freshPolicy.storage);

  if (isForbidden(input.freshPolicy.database.observed, input.freshPolicy.database.forbidden)) {
    stop("DATABASE_TARGET_FORBIDDEN");
  }
  if (!sameDigest(input.freshPolicy.database.observed, input.approvedTarget.databaseFingerprint)) {
    stop("DATABASE_TARGET_MISMATCH");
  }
  if (isForbidden(input.freshPolicy.storage.observed, input.freshPolicy.storage.forbidden)) {
    stop("STORAGE_TARGET_FORBIDDEN");
  }
  if (!sameDigest(input.freshPolicy.storage.observed, input.approvedTarget.storageFingerprint)) {
    stop("STORAGE_TARGET_MISMATCH");
  }

  const freshTarget = assertRehearsalTarget(input.freshPolicy, input.approvedTarget.policyDigest);
  if (
    !sameDigest(freshTarget.databaseFingerprint, input.approvedTarget.databaseFingerprint) ||
    !sameDigest(freshTarget.storageFingerprint, input.approvedTarget.storageFingerprint)
  ) {
    stop("FRESH_TARGET_AUTHORIZATION_INVALID");
  }

  const body: FreshTargetAuthorizationBody = {
    contract: "sk90-fresh-target-authorization-v1",
    action: input.action,
    artifactDigest: input.artifactDigest,
    challengeToken: input.challengeToken,
    targetObservationDigest: targetObservationDigest(freshTarget),
  };
  return { ...body, authorizationDigest: sha256Digest(canonicalJson(body)) };
}

export function assertFreshTargetAuthorization(
  authorization: FreshTargetAuthorization,
  expected: Readonly<{
    action: TargetGatedResetAction;
    artifactDigest: Sha256Digest;
    challengeToken: ProtectedToken;
    targetObservationDigest: Sha256Digest;
  }>,
): true {
  assertTargetGatedAction(authorization.action);
  assertTargetGatedAction(expected.action);
  assertSha256Digest(expected.artifactDigest);
  assertProtectedToken(expected.challengeToken);
  assertSha256Digest(expected.targetObservationDigest);
  assertSha256Digest(authorization.artifactDigest);
  assertProtectedToken(authorization.challengeToken);
  assertSha256Digest(authorization.targetObservationDigest);
  assertSha256Digest(authorization.authorizationDigest);
  const observedContract: unknown = authorization.contract;
  if (
    observedContract !== "sk90-fresh-target-authorization-v1" ||
    authorization.action !== expected.action ||
    !sameDigest(authorization.artifactDigest, expected.artifactDigest) ||
    !sameDigest(authorization.challengeToken, expected.challengeToken) ||
    !sameDigest(authorization.targetObservationDigest, expected.targetObservationDigest) ||
    !sameDigest(
      authorization.authorizationDigest,
      sha256Digest(canonicalJson(freshTargetAuthorizationBody(authorization))),
    )
  ) {
    stop("FRESH_TARGET_AUTHORIZATION_INVALID");
  }
  return true;
}

export type ClassifiedIdentity = Readonly<{
  token: ProtectedToken;
  classification: "approved_test" | "real" | "unknown";
  attested: boolean;
}>;

export type ClassifiedMonetaryRow = Readonly<{
  token: ProtectedToken;
  classification: "approved_mock_test" | "live" | "unknown";
  attested: boolean;
}>;

export type ClassifiedProviderReference = Readonly<{
  token: ProtectedToken;
  provider: "stripe" | "tranzila" | "other";
  mode: "test" | "live" | "unknown";
  attested: boolean;
  chargeEnabled: boolean;
  externalCharge: boolean;
  liveSchedule: boolean;
}>;

export type MockEvidence = Readonly<{
  identities: readonly ClassifiedIdentity[];
  monetaryRows: readonly ClassifiedMonetaryRow[];
  providerReferences: readonly ClassifiedProviderReference[];
}>;

export const SK90_APPROVED_MOCK_EVIDENCE_COUNTS = {
  identityCount: 4,
  monetaryRowCount: 3,
  providerReferenceCount: 7,
} as const;

export type MockEvidenceCoverage = Readonly<{
  identityCount: number;
  identityTokensFingerprint: Sha256Digest;
  monetaryRowCount: number;
  monetaryRowTokensFingerprint: Sha256Digest;
  providerReferenceCount: number;
  providerReferenceTokensFingerprint: Sha256Digest;
}>;

function tokenFingerprint(tokens: readonly ProtectedToken[]): Sha256Digest {
  const unique = new Set<string>();
  for (const token of tokens) {
    assertProtectedToken(token);
    if (unique.has(token)) stop("MOCK_EVIDENCE_COVERAGE_MISMATCH");
    unique.add(token);
  }
  return sha256Digest(canonicalJson([...tokens].sort()));
}

export function assertMockEvidenceCoverageShape(
  coverage: MockEvidenceCoverage,
): MockEvidenceCoverage {
  if (
    coverage.identityCount !== SK90_APPROVED_MOCK_EVIDENCE_COUNTS.identityCount ||
    coverage.monetaryRowCount !== SK90_APPROVED_MOCK_EVIDENCE_COUNTS.monetaryRowCount ||
    coverage.providerReferenceCount !== SK90_APPROVED_MOCK_EVIDENCE_COUNTS.providerReferenceCount
  ) {
    stop("MOCK_EVIDENCE_COVERAGE_MISMATCH");
  }
  assertSha256Digest(coverage.identityTokensFingerprint);
  assertSha256Digest(coverage.monetaryRowTokensFingerprint);
  assertSha256Digest(coverage.providerReferenceTokensFingerprint);
  return coverage;
}

export function buildMockEvidenceCoverage(
  input: Readonly<{
    identityTokens: readonly ProtectedToken[];
    monetaryRowTokens: readonly ProtectedToken[];
    providerReferenceTokens: readonly ProtectedToken[];
  }>,
): MockEvidenceCoverage {
  return assertMockEvidenceCoverageShape({
    identityCount: input.identityTokens.length,
    identityTokensFingerprint: tokenFingerprint(input.identityTokens),
    monetaryRowCount: input.monetaryRowTokens.length,
    monetaryRowTokensFingerprint: tokenFingerprint(input.monetaryRowTokens),
    providerReferenceCount: input.providerReferenceTokens.length,
    providerReferenceTokensFingerprint: tokenFingerprint(input.providerReferenceTokens),
  });
}

export type MockEvidenceSummary = Readonly<{
  identityCount: number;
  monetaryRowCount: number;
  providerReferenceCount: number;
}>;

function assertMockEvidenceShape(
  evidence: MockEvidence | undefined,
): asserts evidence is MockEvidence {
  if (
    !evidence ||
    !Array.isArray(evidence.identities) ||
    !Array.isArray(evidence.monetaryRows) ||
    !Array.isArray(evidence.providerReferences)
  ) {
    stop("MOCK_EVIDENCE_COVERAGE_MISMATCH");
  }
}

function isExactlyTrue(value: unknown): value is true {
  return value === true;
}

function isExactlyFalse(value: unknown): value is false {
  return value === false;
}

/** Digest every classified field, not merely aggregate counts or token coverage. */
export function mockEvidenceObservationDigest(evidence: MockEvidence): Sha256Digest {
  assertMockEvidenceShape(evidence);
  const identities = evidence.identities
    .map((entry) => {
      assertProtectedToken(entry.token);
      return {
        attested: entry.attested,
        classification: entry.classification,
        token: entry.token,
      };
    })
    .sort((left, right) => compareUtf8Bytes(left.token, right.token));
  const monetaryRows = evidence.monetaryRows
    .map((entry) => {
      assertProtectedToken(entry.token);
      return {
        attested: entry.attested,
        classification: entry.classification,
        token: entry.token,
      };
    })
    .sort((left, right) => compareUtf8Bytes(left.token, right.token));
  const providerReferences = evidence.providerReferences
    .map((entry) => {
      assertProtectedToken(entry.token);
      return {
        attested: entry.attested,
        chargeEnabled: entry.chargeEnabled,
        externalCharge: entry.externalCharge,
        liveSchedule: entry.liveSchedule,
        mode: entry.mode,
        provider: entry.provider,
        token: entry.token,
      };
    })
    .sort((left, right) => compareUtf8Bytes(left.token, right.token));
  return sha256Digest(canonicalJson({ identities, monetaryRows, providerReferences }));
}

/** Reject any identity/payment/provider indicator that is not affirmatively test-only. */
export function assertMockOnlyEvidence(
  evidence: MockEvidence,
  expectedCoverage: MockEvidenceCoverage,
): MockEvidenceSummary {
  assertMockEvidenceShape(evidence);
  assertMockEvidenceCoverageShape(expectedCoverage);
  const observedCoverage = buildMockEvidenceCoverage({
    identityTokens: evidence.identities.map((entry) => entry.token),
    monetaryRowTokens: evidence.monetaryRows.map((entry) => entry.token),
    providerReferenceTokens: evidence.providerReferences.map((entry) => entry.token),
  });
  if (
    !sameDigest(
      observedCoverage.identityTokensFingerprint,
      expectedCoverage.identityTokensFingerprint,
    ) ||
    !sameDigest(
      observedCoverage.monetaryRowTokensFingerprint,
      expectedCoverage.monetaryRowTokensFingerprint,
    ) ||
    !sameDigest(
      observedCoverage.providerReferenceTokensFingerprint,
      expectedCoverage.providerReferenceTokensFingerprint,
    )
  ) {
    stop("MOCK_EVIDENCE_COVERAGE_MISMATCH");
  }

  for (const identity of evidence.identities) {
    assertProtectedToken(identity.token);
    if (identity.classification !== "approved_test" || !isExactlyTrue(identity.attested)) {
      stop("IDENTITY_NOT_APPROVED_TEST");
    }
  }

  for (const monetaryRow of evidence.monetaryRows) {
    assertProtectedToken(monetaryRow.token);
    if (monetaryRow.classification === "live") stop("LIVE_PAYMENT_ACTIVITY");
    if (
      monetaryRow.classification !== "approved_mock_test" ||
      !isExactlyTrue(monetaryRow.attested)
    ) {
      stop("MONETARY_ROW_NOT_APPROVED_TEST");
    }
  }

  for (const providerReference of evidence.providerReferences) {
    assertProtectedToken(providerReference.token);
    const observedProvider: unknown = providerReference.provider;
    if (
      providerReference.mode === "live" ||
      !isExactlyFalse(providerReference.chargeEnabled) ||
      !isExactlyFalse(providerReference.externalCharge) ||
      !isExactlyFalse(providerReference.liveSchedule)
    ) {
      stop("LIVE_PAYMENT_ACTIVITY");
    }
    if (providerReference.mode !== "test" || !isExactlyTrue(providerReference.attested)) {
      stop("PROVIDER_REFERENCE_NOT_APPROVED_TEST");
    }
    if (
      observedProvider !== "stripe" &&
      observedProvider !== "tranzila" &&
      observedProvider !== "other"
    ) {
      stop("PROVIDER_REFERENCE_NOT_APPROVED_TEST");
    }
  }

  return {
    identityCount: evidence.identities.length,
    monetaryRowCount: evidence.monetaryRows.length,
    providerReferenceCount: evidence.providerReferences.length,
  };
}
