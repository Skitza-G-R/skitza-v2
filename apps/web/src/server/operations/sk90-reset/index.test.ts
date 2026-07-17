import { describe, expect, it } from "vitest";

import {
  REQUIRED_PRE_RESET_TABLES,
  SK90_APPROVED_RESET_INVENTORY,
  SK90_REHEARSAL_ENV,
  Sk90ResetSafetyError,
  advancePhase,
  assertApprovedResetArtifact,
  assertArtifactLockedSnapshot,
  assertFinalLockedSnapshot,
  assertManifestDigest,
  assertMockOnlyEvidence,
  assertPostResetIntegrityProof,
  assertQuarantineProof,
  assertRehearsalTarget,
  assertRollbackProof,
  authorizeFreshTargetAction,
  buildMockEvidenceCoverage,
  buildSanitizedManifest,
  buildStorageReferenceCoverage,
  bindDiscoveryEvidence,
  bindPostResetIntegrityProof,
  bindQuarantineProof,
  bindRollbackProof,
  canonicalJson,
  deriveStorageDeletionPlan,
  fingerprintStorageReferences,
  mockEvidenceObservationDigest,
  protectValue,
  prepareResetRun,
  readRehearsalEnvironment,
  rehearsalTargetPolicyDigest,
  resolveNextAction,
  rollbackPlanFor,
  sha256Digest,
  targetObservationDigest,
  toSafeErrorReport,
  type ApprovedResetArtifact,
  type FreshTargetGate,
  type MockEvidence,
  type RehearsalTargetPolicy,
  type RollbackInterruptionPoint,
  type SanitizedResetManifest,
  type ResetFingerprintSnapshot,
  type ResetRowCandidate,
  type Sk90SafetyErrorCode,
} from "./index";

const HMAC_KEY = "test-only-manifest-key-with-at-least-32-bytes";
const IDENTITY_TOKENS = Array.from({ length: 4 }, (_, index) =>
  protectValue(HMAC_KEY, `identity-${String(index)}`),
);
const MONETARY_ROW_TOKENS = Array.from({ length: 3 }, (_, index) =>
  protectValue(HMAC_KEY, `monetary-row-${String(index)}`),
);
const PROVIDER_REFERENCE_TOKENS = Array.from({ length: 7 }, (_, index) =>
  protectValue(HMAC_KEY, `provider-reference-${String(index)}`),
);
const MOCK_EVIDENCE_COVERAGE = buildMockEvidenceCoverage({
  identityTokens: IDENTITY_TOKENS,
  monetaryRowTokens: MONETARY_ROW_TOKENS,
  providerReferenceTokens: PROVIDER_REFERENCE_TOKENS,
});
const APPROVED_MOCK_EVIDENCE: MockEvidence = {
  identities: IDENTITY_TOKENS.map((token) => ({
    token,
    classification: "approved_test",
    attested: true,
  })),
  monetaryRows: MONETARY_ROW_TOKENS.map((token) => ({
    token,
    classification: "approved_mock_test",
    attested: true,
  })),
  providerReferences: PROVIDER_REFERENCE_TOKENS.map((token) => ({
    token,
    provider: "stripe",
    mode: "test",
    attested: true,
    chargeEnabled: false,
    externalCharge: false,
    liveSchedule: false,
  })),
};

function exactApprovedResetRows(): ResetRowCandidate[] {
  return SK90_APPROVED_RESET_INVENTORY.flatMap((entry) =>
    Array.from({ length: entry.count }, (_, index) => {
      if (entry.table === "projects" && index === 0) {
        return {
          category: entry.category,
          table: entry.table,
          id: "raw-project-id",
          payload: { email: "private@example.com", stage: "lead" },
        };
      }
      if (entry.table === "notifications" && index === 0) {
        return {
          category: entry.category,
          table: entry.table,
          id: "raw-notification-id",
          payload: { body: "private activity", read: false },
        };
      }
      return {
        category: entry.category,
        table: entry.table,
        id: `approved-fixture-${entry.table}-${String(index)}`,
        payload: { ordinal: index },
      };
    }),
  );
}

function expectSafetyError(run: () => unknown, code: Sk90SafetyErrorCode): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(Sk90ResetSafetyError);
    expect((error as Sk90ResetSafetyError).code).toBe(code);
    return;
  }

  throw new Error(`Expected safety error ${code}`);
}

function requiredFixture<Value>(value: Value | undefined): Value {
  if (value === undefined) throw new Error("Required test fixture is missing");
  return value;
}

const RESET_STORAGE_REFERENCES = [
  ...Array.from({ length: 7 }, (_, index) => ({
    bucketRole: "audio" as const,
    key:
      index === 0
        ? "producers/raw/object-key.wav"
        : `producers/raw/object-key-${String(index)}.wav`,
    referencedBy: "reset" as const,
    exists: true,
    ownershipVerified: true,
    contentFingerprint: sha256Digest(`audio-bytes-${String(index)}`),
  })),
  {
    bucketRole: "docs" as const,
    key: "preserved/private-proof.pdf",
    referencedBy: "preserved" as const,
    exists: true,
    ownershipVerified: true,
    contentFingerprint: sha256Digest("proof-bytes"),
  },
] as const;

function protectedStorageReferences(
  references: readonly (typeof RESET_STORAGE_REFERENCES)[number][] = RESET_STORAGE_REFERENCES,
) {
  return references.map((reference) => ({
    ...reference,
    protectedKey: protectValue(HMAC_KEY, `storage-key\0${reference.bucketRole}\0${reference.key}`),
  }));
}

const STORAGE_REFERENCE_COVERAGE = buildStorageReferenceCoverage(protectedStorageReferences());

function manifestInput() {
  return {
    artifactVersion: "sk90-reset-v1",
    targetPolicyDigest: rehearsalTargetPolicyDigest(isolatedTargetPolicy()),
    preSchemaFingerprint: sha256Digest("pre-schema"),
    reviewedTargetSchemaFingerprint: sha256Digest("target-schema"),
    preservedRowCountsFingerprint: sha256Digest("preserved-row-counts"),
    preservedBusinessFingerprint: sha256Digest("preserved-business"),
    mockEvidenceCoverage: MOCK_EVIDENCE_COVERAGE,
    storageReferenceCoverage: STORAGE_REFERENCE_COVERAGE,
    rows: exactApprovedResetRows(),
    storageReferences: RESET_STORAGE_REFERENCES,
  } as const;
}

function isolatedTargetPolicy(): RehearsalTargetPolicy {
  const databaseFingerprint = sha256Digest("isolated-database");
  const storageFingerprint = sha256Digest("isolated-storage");
  return {
    targetClass: "isolated_nonproduction",
    database: {
      observed: databaseFingerprint,
      approved: databaseFingerprint,
      forbidden: [sha256Digest("canonical"), sha256Digest("frozen")],
    },
    storage: {
      observed: storageFingerprint,
      approved: storageFingerprint,
      forbidden: [sha256Digest("live-storage")],
    },
    isolation: {
      databaseRestorePointReady: true,
      storageRestorePointReady: true,
      exclusiveStorageNamespace: true,
      exclusiveStorageWriter: true,
    },
  };
}

function prepareApprovedRun() {
  const manifest = buildSanitizedManifest(manifestInput(), HMAC_KEY);
  const policy = isolatedTargetPolicy();
  const target = assertRehearsalTarget(policy, rehearsalTargetPolicyDigest(policy));
  const reviewedBaseline: ResetFingerprintSnapshot = {
    manifestDigest: manifest.digest,
    schemaFingerprint: manifest.preSchemaFingerprint,
    resetRowsFingerprint: manifest.resetRowsFingerprint,
    preservedRowCountsFingerprint: manifest.preservedRowCountsFingerprint,
    preservedBusinessFingerprint: manifest.preservedBusinessFingerprint,
    storageReferencesFingerprint: manifest.storageReferencesFingerprint,
  };
  const prepared = prepareResetRun({
    artifactVersion: "sk90-reset-v1",
    target,
    manifest,
    mockEvidence: APPROVED_MOCK_EVIDENCE,
    reviewedBaseline,
    discoveryEvidence: bindDiscoveryEvidence({
      challengeToken: protectValue(HMAC_KEY, "fresh-discovery-challenge"),
      targetObservationDigest: targetObservationDigest(target),
      resetRowsObservationDigest: manifest.resetRowsFingerprint,
      mockEvidenceObservationDigest: mockEvidenceObservationDigest(APPROVED_MOCK_EVIDENCE),
      storageEnumerationDigest: manifest.storageReferencesFingerprint,
    }),
  });
  return { manifest, policy, prepared, reviewedBaseline, target };
}

function exactPostResetProof(artifact: ApprovedResetArtifact) {
  const expected = artifact.postResetExpectations;
  return bindPostResetIntegrityProof({
    artifactDigest: artifact.digest,
    manifestDigest: artifact.manifestDigest,
    schemaFingerprint: expected.targetSchemaFingerprint,
    resetRows: {
      beforeCount: expected.resetRowCount,
      beforeFingerprint: expected.resetRowsFingerprint,
      deletedCount: expected.resetRowCount,
      deletedFingerprint: expected.resetRowsFingerprint,
      remainingCount: 0,
      remainingFingerprint: sha256Digest(canonicalJson([])),
    },
    preserved: {
      rowCountsFingerprint: expected.preservedRowCountsFingerprint,
      businessFingerprint: expected.preservedBusinessFingerprint,
    },
    relationalIntegrity: {
      foreignKeyViolationCount: 0,
      orphanRowCount: 0,
      ownershipViolationCount: 0,
    },
    prohibitedRows: {
      legacyCommercialRowCount: 0,
      syntheticPurchaseCount: 0,
    },
    storage: {
      deletedObjectCount: expected.resetStorageObjectCount,
      deletedObjectsFingerprint: expected.resetStorageObjectsFingerprint,
      preservedObjectCount: expected.preservedStorageObjectCount,
      preservedContentFingerprint: expected.preservedStorageContentFingerprint,
    },
  });
}

function exactQuarantineProof(
  artifact: ApprovedResetArtifact,
  manifest: SanitizedResetManifest,
  observationChallengeToken = protectValue(HMAC_KEY, "quarantine-proof-observation"),
) {
  return bindQuarantineProof({
    artifactDigest: artifact.digest,
    manifestDigest: artifact.manifestDigest,
    observationChallengeToken,
    copies: manifest.storageObjects
      .filter((object) => object.ownership === "reset_exclusive")
      .map((object) => ({
        bucketRole: object.bucketRole,
        protectedSourceKey: object.protectedKey,
        sourceContentFingerprint: object.contentFingerprint,
        protectedCopyKey: protectValue(
          HMAC_KEY,
          `quarantine-copy\0${object.bucketRole}\0${object.protectedKey}`,
        ),
        copyContentFingerprint: object.contentFingerprint,
        copyExists: true,
        restoreVerified: true,
      })),
  });
}

function exactRestoreBaseline(artifact: ApprovedResetArtifact) {
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
  } as const;
}

function exactRollbackProof(
  artifact: ApprovedResetArtifact,
  interruptionPoint: RollbackInterruptionPoint,
) {
  const baseline = exactRestoreBaseline(artifact);
  return bindRollbackProof({
    artifactDigest: artifact.digest,
    manifestDigest: artifact.manifestDigest,
    interruptionPoint,
    databaseRestoreCompleted: true,
    storageRestoreCompleted: true,
    storageContentVerified: true,
    before: baseline,
    restored: baseline,
  });
}

function freshAuthorization(
  artifact: ApprovedResetArtifact,
  action: FreshTargetGate["authorization"]["action"],
  freshPolicy: RehearsalTargetPolicy = isolatedTargetPolicy(),
  challengeLabel: string = action,
): FreshTargetGate {
  const challengeToken = protectValue(HMAC_KEY, `fresh-target-${challengeLabel}`);
  const authorization = authorizeFreshTargetAction({
    action,
    artifactDigest: artifact.digest,
    approvedTarget: artifact.target,
    freshPolicy,
    challengeToken,
  });
  return {
    authorization,
    currentChallengeToken: challengeToken,
    currentTargetObservationDigest: targetObservationDigest(artifact.target),
  };
}

function quarantineGateFor(
  artifact: ApprovedResetArtifact,
  manifest: SanitizedResetManifest,
  freshTarget: FreshTargetGate,
) {
  return {
    artifact,
    proof: exactQuarantineProof(artifact, manifest, freshTarget.currentChallengeToken),
  };
}

function exactEnvironment(): Record<string, string> {
  return {
    [SK90_REHEARSAL_ENV.targetDatabaseUrl]:
      "postgresql://private-user:private-password@isolated.invalid/rehearsal",
    [SK90_REHEARSAL_ENV.targetDatabaseFingerprint]: sha256Digest("isolated-database"),
    [SK90_REHEARSAL_ENV.targetStorageFingerprint]: sha256Digest("isolated-storage"),
    [SK90_REHEARSAL_ENV.targetStorageNamespace]: "sk90-rehearsal/approved-sandbox",
    [SK90_REHEARSAL_ENV.manifestHmacKey]: HMAC_KEY,
    [SK90_REHEARSAL_ENV.approvalPolicyDigest]: sha256Digest("reviewed-policy"),
  };
}

describe("SK-90 fail-closed environment contract", () => {
  it("accepts only the dedicated rehearsal names", () => {
    const config = readRehearsalEnvironment(exactEnvironment());

    expect(config.targetStorageNamespace).toBe("sk90-rehearsal/approved-sandbox");
    expect(config.targetDatabaseFingerprint).toBe(sha256Digest("isolated-database"));
  });

  it("does not fall back to DATABASE_URL", () => {
    expectSafetyError(
      () =>
        readRehearsalEnvironment({
          DATABASE_URL: "postgresql://production.invalid/live",
        }),
      "AMBIENT_ENV_FORBIDDEN",
    );
  });

  it("refuses ambient generic connection or storage variables even when exact names exist", () => {
    expectSafetyError(
      () => readRehearsalEnvironment({ ...exactEnvironment(), DATABASE_URL: "secret" }),
      "AMBIENT_ENV_FORBIDDEN",
    );
    expectSafetyError(
      () => readRehearsalEnvironment({ ...exactEnvironment(), R2_BUCKET_DOCS: "live-bucket" }),
      "AMBIENT_ENV_FORBIDDEN",
    );
  });
});

describe("SK-90 canonical evidence encoding", () => {
  it("rejects sparse arrays instead of encoding a hole like an explicit value", () => {
    const sparse: unknown[] = [];
    sparse.length = 2;
    sparse[1] = "present";

    expectSafetyError(() => canonicalJson(sparse), "MANIFEST_INPUT_INVALID");
  });
});

describe("SK-90 isolated-target fingerprint policy", () => {
  const databaseFingerprint = sha256Digest("isolated-database");
  const storageFingerprint = sha256Digest("isolated-storage");

  function policy() {
    return {
      targetClass: "isolated_nonproduction",
      database: {
        observed: databaseFingerprint,
        approved: databaseFingerprint,
        forbidden: [sha256Digest("canonical"), sha256Digest("frozen")],
      },
      storage: {
        observed: storageFingerprint,
        approved: storageFingerprint,
        forbidden: [sha256Digest("live-storage")],
      },
      isolation: {
        databaseRestorePointReady: true,
        storageRestorePointReady: true,
        exclusiveStorageNamespace: true,
        exclusiveStorageWriter: true,
      },
    } as const;
  }

  it("approves an exact isolated database and storage namespace", () => {
    const evidence = policy();
    const approval = assertRehearsalTarget(evidence, rehearsalTargetPolicyDigest(evidence));

    expect(approval.targetClass).toBe("isolated_nonproduction");
    expect(approval.policyDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("hard-stops forbidden or mismatched targets", () => {
    const forbiddenDatabase = {
      ...policy(),
      database: {
        ...policy().database,
        observed: policy().database.forbidden[0],
      },
    } as const;
    expectSafetyError(
      () =>
        assertRehearsalTarget(forbiddenDatabase, rehearsalTargetPolicyDigest(forbiddenDatabase)),
      "DATABASE_TARGET_FORBIDDEN",
    );

    const wrongStorage = {
      ...policy(),
      storage: { ...policy().storage, observed: sha256Digest("wrong-storage") },
    } as const;
    expectSafetyError(
      () => assertRehearsalTarget(wrongStorage, rehearsalTargetPolicyDigest(wrongStorage)),
      "STORAGE_TARGET_MISMATCH",
    );

    const forbiddenStorage = {
      ...policy(),
      storage: {
        ...policy().storage,
        observed: policy().storage.forbidden[0],
      },
    } as const;
    expectSafetyError(
      () => assertRehearsalTarget(forbiddenStorage, rehearsalTargetPolicyDigest(forbiddenStorage)),
      "STORAGE_TARGET_FORBIDDEN",
    );
  });

  it("requires both restore points and exclusive storage control", () => {
    const missingRestore = {
      ...policy(),
      isolation: { ...policy().isolation, storageRestorePointReady: false },
    } as const;
    expectSafetyError(
      () => assertRehearsalTarget(missingRestore, rehearsalTargetPolicyDigest(missingRestore)),
      "RESTORE_POINT_NOT_READY",
    );
  });

  it("requires both audited database forbiddens and the approved policy digest", () => {
    const approved = policy();
    const missingForbiddens = {
      ...approved,
      database: { ...approved.database, forbidden: [] },
    } as const;
    expectSafetyError(
      () =>
        assertRehearsalTarget(missingForbiddens, rehearsalTargetPolicyDigest(missingForbiddens)),
      "FINGERPRINT_INVALID",
    );
    expectSafetyError(
      () => assertRehearsalTarget(approved, sha256Digest("different-policy")),
      "TARGET_POLICY_MISMATCH",
    );
  });
});

describe("SK-90 deterministic sanitized manifest", () => {
  const baseInput = manifestInput();

  it("is stable across input ordering and contains no raw identifiers or personal data", () => {
    const first = buildSanitizedManifest(baseInput, HMAC_KEY);
    const second = buildSanitizedManifest(
      {
        ...baseInput,
        rows: [...baseInput.rows].reverse(),
        storageReferences: [...baseInput.storageReferences].reverse(),
      },
      HMAC_KEY,
    );

    expect(second).toEqual(first);
    expect(assertManifestDigest(first)).toBe(true);

    const serialized = JSON.stringify(first);
    for (const secret of [
      "raw-project-id",
      "raw-notification-id",
      "private@example.com",
      "private activity",
      "producers/raw/object-key.wav",
      "preserved/private-proof.pdf",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("detects manifest drift", () => {
    const manifest = buildSanitizedManifest(baseInput, HMAC_KEY);
    const changed = { ...manifest, preservedBusinessFingerprint: sha256Digest("changed") };

    expectSafetyError(() => assertManifestDigest(changed), "MANIFEST_DIGEST_MISMATCH");
  });

  it("requires the exact approved row allowlist and counts", () => {
    expectSafetyError(
      () => buildSanitizedManifest({ ...baseInput, rows: baseInput.rows.slice(1) }, HMAC_KEY),
      "MANIFEST_INPUT_INVALID",
    );
    expectSafetyError(
      () =>
        buildSanitizedManifest(
          {
            ...baseInput,
            rows: [
              ...baseInput.rows,
              {
                category: "producers",
                table: "producers",
                id: "must-stay-preserved",
                payload: {},
              },
            ],
          },
          HMAC_KEY,
        ),
      "MANIFEST_INPUT_INVALID",
    );
  });

  it("requires the exact reviewed storage-reference coverage", () => {
    expectSafetyError(
      () => buildSanitizedManifest({ ...baseInput, storageReferences: [] }, HMAC_KEY),
      "MANIFEST_INPUT_INVALID",
    );
    expectSafetyError(
      () =>
        buildSanitizedManifest(
          { ...baseInput, storageReferences: baseInput.storageReferences.slice(1) },
          HMAC_KEY,
        ),
      "MANIFEST_INPUT_INVALID",
    );
    expectSafetyError(
      () =>
        buildSanitizedManifest(
          {
            ...baseInput,
            storageReferences: baseInput.storageReferences.map((reference, index) =>
              index === 0 ? { ...reference, key: "substituted/reset-object.wav" } : reference,
            ),
          },
          HMAC_KEY,
        ),
      "MANIFEST_INPUT_INVALID",
    );
  });

  it("binds target, manifest, evidence, baseline, and journal into one artifact", () => {
    const { manifest, prepared, reviewedBaseline } = prepareApprovedRun();

    expect(assertApprovedResetArtifact(prepared.artifact)).toBe(true);
    expect(prepared.journal).toEqual({
      artifactDigest: prepared.artifact.digest,
      manifestDigest: manifest.digest,
      phase: "manifest_built",
    });
    expect(
      assertArtifactLockedSnapshot(prepared.artifact, {
        isolationLevel: "serializable",
        advisoryLockAcquired: true,
        mutationStarted: false,
        storageDeletionStarted: false,
        locks: REQUIRED_PRE_RESET_TABLES.map((table) => ({
          table,
          mode: "share_row_exclusive",
        })),
        reviewed: reviewedBaseline,
        underLock: reviewedBaseline,
      }),
    ).toEqual(reviewedBaseline);

    expectSafetyError(
      () =>
        assertApprovedResetArtifact({
          ...prepared.artifact,
          digest: sha256Digest("tampered-artifact"),
        }),
      "ARTIFACT_DIGEST_MISMATCH",
    );
  });

  it("rejects substituted reset rows against the independently reviewed discovery", () => {
    const { manifest: reviewedManifest, prepared } = prepareApprovedRun();
    const substitutedRows = manifestInput().rows.map((row, index) =>
      index === 0 ? { ...row, id: "substituted-reset-row" } : row,
    );
    const substitutedManifest = buildSanitizedManifest(
      { ...manifestInput(), rows: substitutedRows },
      HMAC_KEY,
    );
    const substitutedBaseline: ResetFingerprintSnapshot = {
      ...prepared.artifact.reviewedBaseline,
      manifestDigest: substitutedManifest.digest,
      resetRowsFingerprint: substitutedManifest.resetRowsFingerprint,
    };

    expectSafetyError(
      () =>
        prepareResetRun({
          artifactVersion: "sk90-reset-v1",
          target: prepared.artifact.target,
          manifest: substitutedManifest,
          mockEvidence: APPROVED_MOCK_EVIDENCE,
          reviewedBaseline: substitutedBaseline,
          discoveryEvidence: bindDiscoveryEvidence({
            ...prepared.artifact.discoveryEvidence,
            resetRowsObservationDigest: reviewedManifest.resetRowsFingerprint,
          }),
        }),
      "ARTIFACT_BINDING_MISMATCH",
    );
  });

  it("rejects a manifest that omitted a preserved reference to a reset object", () => {
    const { manifest, prepared } = prepareApprovedRun();
    const firstResetReference = requiredFixture(protectedStorageReferences()[0]);
    const fullDiscoveryReferences = [
      ...protectedStorageReferences(),
      { ...firstResetReference, referencedBy: "preserved" as const },
    ];

    expectSafetyError(
      () =>
        prepareResetRun({
          artifactVersion: "sk90-reset-v1",
          target: prepared.artifact.target,
          manifest,
          mockEvidence: APPROVED_MOCK_EVIDENCE,
          reviewedBaseline: prepared.artifact.reviewedBaseline,
          discoveryEvidence: bindDiscoveryEvidence({
            ...prepared.artifact.discoveryEvidence,
            storageEnumerationDigest: fingerprintStorageReferences(fullDiscoveryReferences),
          }),
        }),
      "ARTIFACT_BINDING_MISMATCH",
    );
  });

  it("requires exact classified evidence during preparation; counts cannot substitute", () => {
    const { manifest, prepared } = prepareApprovedRun();
    const countsOnly = {
      artifactVersion: "sk90-reset-v1",
      target: prepared.artifact.target,
      manifest,
      mockEvidenceSummary: prepared.artifact.mockEvidenceSummary,
      reviewedBaseline: prepared.artifact.reviewedBaseline,
      discoveryEvidence: prepared.artifact.discoveryEvidence,
    };

    expectSafetyError(
      () => prepareResetRun(countsOnly as never),
      "MOCK_EVIDENCE_COVERAGE_MISMATCH",
    );
  });
});

describe("SK-90 identity, payment, and provider stops", () => {
  const approvedEvidence = {
    identities: IDENTITY_TOKENS.map((token) => ({
      token,
      classification: "approved_test" as const,
      attested: true,
    })),
    monetaryRows: MONETARY_ROW_TOKENS.map((token) => ({
      token,
      classification: "approved_mock_test" as const,
      attested: true,
    })),
    providerReferences: PROVIDER_REFERENCE_TOKENS.map(
      (token, index) =>
        ({
          token,
          provider: "stripe",
          mode: "test",
          attested: true,
          chargeEnabled: false,
          externalCharge: false,
          liveSchedule: false,
          index,
        }) as const,
    ),
  } as const;

  it("returns aggregate-only approval for fully classified test evidence", () => {
    expect(assertMockOnlyEvidence(approvedEvidence, MOCK_EVIDENCE_COVERAGE)).toEqual({
      identityCount: 4,
      monetaryRowCount: 3,
      providerReferenceCount: 7,
    });
  });

  it("hard-stops an unknown identity or live provider activity", () => {
    expectSafetyError(
      () =>
        assertMockOnlyEvidence(
          {
            ...approvedEvidence,
            identities: [
              {
                ...requiredFixture(approvedEvidence.identities[0]),
                classification: "unknown",
                attested: false,
              },
              ...approvedEvidence.identities.slice(1),
            ],
          },
          MOCK_EVIDENCE_COVERAGE,
        ),
      "IDENTITY_NOT_APPROVED_TEST",
    );

    expectSafetyError(
      () =>
        assertMockOnlyEvidence(
          {
            ...approvedEvidence,
            providerReferences: [
              {
                ...requiredFixture(approvedEvidence.providerReferences[0]),
                mode: "live",
                externalCharge: true,
              },
              ...approvedEvidence.providerReferences.slice(1),
            ],
          },
          MOCK_EVIDENCE_COVERAGE,
        ),
      "LIVE_PAYMENT_ACTIVITY",
    );
  });

  it("hard-stops unclassified paid rows and unattested provider references", () => {
    expectSafetyError(
      () =>
        assertMockOnlyEvidence(
          {
            ...approvedEvidence,
            monetaryRows: [
              {
                ...requiredFixture(approvedEvidence.monetaryRows[0]),
                classification: "unknown",
                attested: false,
              },
              ...approvedEvidence.monetaryRows.slice(1),
            ],
          },
          MOCK_EVIDENCE_COVERAGE,
        ),
      "MONETARY_ROW_NOT_APPROVED_TEST",
    );

    expectSafetyError(
      () =>
        assertMockOnlyEvidence(
          {
            ...approvedEvidence,
            providerReferences: [
              {
                ...requiredFixture(approvedEvidence.providerReferences[0]),
                mode: "unknown",
                attested: false,
              },
              ...approvedEvidence.providerReferences.slice(1),
            ],
          },
          MOCK_EVIDENCE_COVERAGE,
        ),
      "PROVIDER_REFERENCE_NOT_APPROVED_TEST",
    );
  });

  it("rejects missing, duplicate, or extra classification coverage", () => {
    expectSafetyError(
      () =>
        assertMockOnlyEvidence(
          { identities: [], monetaryRows: [], providerReferences: [] },
          MOCK_EVIDENCE_COVERAGE,
        ),
      "MOCK_EVIDENCE_COVERAGE_MISMATCH",
    );
    expectSafetyError(
      () =>
        assertMockOnlyEvidence(
          {
            ...approvedEvidence,
            identities: [
              requiredFixture(approvedEvidence.identities[0]),
              ...approvedEvidence.identities,
            ],
          },
          MOCK_EVIDENCE_COVERAGE,
        ),
      "MOCK_EVIDENCE_COVERAGE_MISMATCH",
    );
  });
});

describe("SK-90 artifact-bound post-reset integrity", () => {
  it("proves exact row deletion, preserved data, schema, relational checks, and storage", () => {
    const { prepared } = prepareApprovedRun();
    const proof = exactPostResetProof(prepared.artifact);

    expect(assertPostResetIntegrityProof(prepared.artifact, proof)).toMatchObject({
      artifactDigest: prepared.artifact.digest,
      manifestDigest: prepared.artifact.manifestDigest,
      verified: true,
    });
  });

  it("rejects any incomplete row delta, ownership failure, prohibited row, or object drift", () => {
    const { prepared } = prepareApprovedRun();
    const proof = exactPostResetProof(prepared.artifact);
    const rejected = [
      bindPostResetIntegrityProof({
        ...proof,
        schemaFingerprint: sha256Digest("wrong-target-schema"),
      }),
      bindPostResetIntegrityProof({
        ...proof,
        resetRows: { ...proof.resetRows, deletedCount: proof.resetRows.deletedCount - 1 },
      }),
      bindPostResetIntegrityProof({
        ...proof,
        resetRows: { ...proof.resetRows, remainingCount: 1 },
      }),
      bindPostResetIntegrityProof({
        ...proof,
        preserved: {
          ...proof.preserved,
          rowCountsFingerprint: sha256Digest("changed-preserved-counts"),
        },
      }),
      bindPostResetIntegrityProof({
        ...proof,
        preserved: {
          ...proof.preserved,
          businessFingerprint: sha256Digest("changed-preserved-business"),
        },
      }),
      bindPostResetIntegrityProof({
        ...proof,
        relationalIntegrity: { ...proof.relationalIntegrity, foreignKeyViolationCount: 1 },
      }),
      bindPostResetIntegrityProof({
        ...proof,
        relationalIntegrity: { ...proof.relationalIntegrity, orphanRowCount: 1 },
      }),
      bindPostResetIntegrityProof({
        ...proof,
        relationalIntegrity: { ...proof.relationalIntegrity, ownershipViolationCount: 1 },
      }),
      bindPostResetIntegrityProof({
        ...proof,
        prohibitedRows: { ...proof.prohibitedRows, legacyCommercialRowCount: 1 },
      }),
      bindPostResetIntegrityProof({
        ...proof,
        prohibitedRows: { ...proof.prohibitedRows, syntheticPurchaseCount: 1 },
      }),
      bindPostResetIntegrityProof({
        ...proof,
        storage: {
          ...proof.storage,
          deletedObjectsFingerprint: sha256Digest("changed-deleted-objects"),
        },
      }),
      bindPostResetIntegrityProof({
        ...proof,
        storage: { ...proof.storage, preservedObjectCount: proof.storage.preservedObjectCount + 1 },
      }),
      bindPostResetIntegrityProof({
        ...proof,
        storage: {
          ...proof.storage,
          preservedContentFingerprint: sha256Digest("changed-preserved-content"),
        },
      }),
    ];

    for (const candidate of rejected) {
      expectSafetyError(
        () => assertPostResetIntegrityProof(prepared.artifact, candidate),
        "POST_RESET_INTEGRITY_MISMATCH",
      );
    }
  });
});

describe("SK-90 artifact-bound quarantine proof", () => {
  it("proves every reset-exclusive object has one verified content-matching copy", () => {
    const { manifest, prepared } = prepareApprovedRun();
    const proof = exactQuarantineProof(prepared.artifact, manifest);

    expect(assertQuarantineProof(prepared.artifact, proof)).toMatchObject({
      artifactDigest: prepared.artifact.digest,
      manifestDigest: prepared.artifact.manifestDigest,
      proofDigest: proof.bindingDigest,
      verified: true,
    });
  });

  it("rejects missing, extra, drifted, or unrestorable quarantine copies", () => {
    const { manifest, prepared } = prepareApprovedRun();
    const proof = exactQuarantineProof(prepared.artifact, manifest);
    const first = requiredFixture(proof.copies[0]);
    const rejected = [
      bindQuarantineProof({ ...proof, copies: proof.copies.slice(1) }),
      bindQuarantineProof({
        ...proof,
        copies: [
          ...proof.copies,
          {
            ...first,
            protectedSourceKey: protectValue(HMAC_KEY, "extra-source"),
            protectedCopyKey: protectValue(HMAC_KEY, "extra-copy"),
          },
        ],
      }),
      bindQuarantineProof({
        ...proof,
        copies: proof.copies.map((copy, index) =>
          index === 0 ? { ...copy, copyContentFingerprint: sha256Digest("drifted-copy") } : copy,
        ),
      }),
      bindQuarantineProof({
        ...proof,
        copies: proof.copies.map((copy, index) =>
          index === 0 ? { ...copy, restoreVerified: false } : copy,
        ),
      }),
    ];

    for (const candidate of rejected) {
      expectSafetyError(
        () => assertQuarantineProof(prepared.artifact, candidate),
        "QUARANTINE_PROOF_MISMATCH",
      );
    }

    const second = requiredFixture(proof.copies[1]);
    expectSafetyError(
      () =>
        bindQuarantineProof({
          ...proof,
          copies: proof.copies.map((copy, index) =>
            index === 0 ? { ...copy, protectedCopyKey: second.protectedSourceKey } : copy,
          ),
        }),
      "QUARANTINE_PROOF_MISMATCH",
    );
  });

  it("cannot enter or resume the database-reset phase without the bound proof", () => {
    const { manifest, prepared } = prepareApprovedRun();
    const freshQuarantine = freshAuthorization(prepared.artifact, "quarantine_objects");
    const quarantineGate = quarantineGateFor(prepared.artifact, manifest, freshQuarantine);
    const proof = quarantineGate.proof;

    expectSafetyError(
      () => advancePhase(prepared.journal, "objects_quarantined", freshQuarantine),
      "QUARANTINE_PROOF_REQUIRED",
    );

    const quarantined = advancePhase(prepared.journal, "objects_quarantined", freshQuarantine, {
      quarantine: quarantineGate,
    });
    const quarantineSetFingerprint = assertQuarantineProof(
      prepared.artifact,
      proof,
    ).quarantineSetFingerprint;
    expect(quarantined.quarantineSetFingerprint).toBe(quarantineSetFingerprint);

    const substitutedFresh = freshAuthorization(
      prepared.artifact,
      "reset_database",
      undefined,
      "substituted",
    );
    const substitutedProof = bindQuarantineProof({
      ...proof,
      observationChallengeToken: substitutedFresh.currentChallengeToken,
      copies: proof.copies.map((copy, index) => ({
        ...copy,
        protectedCopyKey: protectValue(HMAC_KEY, `substituted-copy-${String(index)}`),
      })),
    });
    expectSafetyError(
      () =>
        resolveNextAction(
          quarantined,
          { database: "pre", storage: "pre" },
          {
            artifactDigest: prepared.artifact.digest,
            manifestDigest: prepared.artifact.manifestDigest,
          },
          substitutedFresh,
          { quarantine: { artifact: prepared.artifact, proof: substitutedProof } },
        ),
      "QUARANTINE_PROOF_MISMATCH",
    );

    expectSafetyError(
      () =>
        resolveNextAction(
          quarantined,
          { database: "pre", storage: "pre" },
          {
            artifactDigest: prepared.artifact.digest,
            manifestDigest: prepared.artifact.manifestDigest,
          },
          freshAuthorization(prepared.artifact, "reset_database"),
        ),
      "QUARANTINE_PROOF_REQUIRED",
    );
    const resetFresh = freshAuthorization(
      prepared.artifact,
      "reset_database",
      undefined,
      "reset-resume",
    );
    expectSafetyError(
      () =>
        resolveNextAction(
          quarantined,
          { database: "pre", storage: "pre" },
          {
            artifactDigest: prepared.artifact.digest,
            manifestDigest: prepared.artifact.manifestDigest,
          },
          resetFresh,
          { quarantine: quarantineGate },
        ),
      "QUARANTINE_PROOF_MISMATCH",
    );
    const resetQuarantineGate = quarantineGateFor(prepared.artifact, manifest, resetFresh);
    expect(
      resolveNextAction(
        quarantined,
        { database: "pre", storage: "pre" },
        {
          artifactDigest: prepared.artifact.digest,
          manifestDigest: prepared.artifact.manifestDigest,
        },
        resetFresh,
        { quarantine: resetQuarantineGate },
      ),
    ).toBe("reset_database");

    expectSafetyError(
      () =>
        advancePhase(
          quarantined,
          "database_committed",
          freshAuthorization(prepared.artifact, "reset_database", undefined, "commit-missing"),
        ),
      "QUARANTINE_PROOF_REQUIRED",
    );
    const commitFresh = freshAuthorization(
      prepared.artifact,
      "reset_database",
      undefined,
      "commit-proven",
    );
    expect(
      advancePhase(quarantined, "database_committed", commitFresh, {
        quarantine: quarantineGateFor(prepared.artifact, manifest, commitFresh),
      }).phase,
    ).toBe("database_committed");
  });
});

describe("SK-90 fresh target gate for every external phase", () => {
  it.each([
    "quarantine_objects",
    "reset_database",
    "delete_storage",
    "verify",
    "noop",
    "restore",
  ] as const)("freshly authorizes %s against the artifact target", (action) => {
    const { prepared } = prepareApprovedRun();

    expect(freshAuthorization(prepared.artifact, action).authorization).toMatchObject({
      action,
      artifactDigest: prepared.artifact.digest,
    });
  });

  it("rejects a fresh target mismatch or forbidden target before the phase", () => {
    const { prepared } = prepareApprovedRun();
    const approved = isolatedTargetPolicy();
    const mismatched: RehearsalTargetPolicy = {
      ...approved,
      database: {
        ...approved.database,
        observed: sha256Digest("different-isolated-database"),
      },
    };
    expectSafetyError(
      () => freshAuthorization(prepared.artifact, "reset_database", mismatched),
      "DATABASE_TARGET_MISMATCH",
    );

    const forbidden: RehearsalTargetPolicy = {
      ...approved,
      storage: {
        ...approved.storage,
        observed: requiredFixture(approved.storage.forbidden[0]),
      },
    };
    expectSafetyError(
      () => freshAuthorization(prepared.artifact, "delete_storage", forbidden),
      "STORAGE_TARGET_FORBIDDEN",
    );

    const forbiddenDatabase: RehearsalTargetPolicy = {
      ...approved,
      database: {
        ...approved.database,
        observed: requiredFixture(approved.database.forbidden[0]),
      },
    };
    expectSafetyError(
      () => freshAuthorization(prepared.artifact, "restore", forbiddenDatabase),
      "DATABASE_TARGET_FORBIDDEN",
    );

    const mismatchedStorage: RehearsalTargetPolicy = {
      ...approved,
      storage: {
        ...approved.storage,
        observed: sha256Digest("different-isolated-storage"),
      },
    };
    expectSafetyError(
      () => freshAuthorization(prepared.artifact, "restore", mismatchedStorage),
      "STORAGE_TARGET_MISMATCH",
    );
  });

  it("rejects replaying an old authorization for the same action", () => {
    const { prepared } = prepareApprovedRun();
    const stale = freshAuthorization(prepared.artifact, "delete_storage", undefined, "old");
    const current = freshAuthorization(prepared.artifact, "delete_storage", undefined, "current");

    expectSafetyError(
      () =>
        resolveNextAction(
          {
            artifactDigest: prepared.artifact.digest,
            manifestDigest: prepared.artifact.manifestDigest,
            phase: "database_committed",
          },
          { database: "post", storage: "pre" },
          {
            artifactDigest: prepared.artifact.digest,
            manifestDigest: prepared.artifact.manifestDigest,
          },
          {
            ...stale,
            currentChallengeToken: current.currentChallengeToken,
            currentTargetObservationDigest: current.currentTargetObservationDigest,
          },
        ),
      "FRESH_TARGET_AUTHORIZATION_INVALID",
    );

    expectSafetyError(
      () =>
        resolveNextAction(
          {
            artifactDigest: prepared.artifact.digest,
            manifestDigest: prepared.artifact.manifestDigest,
            phase: "database_committed",
          },
          { database: "post", storage: "pre" },
          {
            artifactDigest: prepared.artifact.digest,
            manifestDigest: prepared.artifact.manifestDigest,
          },
          {
            ...current,
            authorization: stale.authorization,
            currentTargetObservationDigest: sha256Digest("repointed-current-target"),
          },
        ),
      "FRESH_TARGET_AUTHORIZATION_INVALID",
    );
  });
});

describe("SK-90 preserved-object ownership stop", () => {
  const objectToken = protectValue(HMAC_KEY, "shared-object");

  it("deduplicates reset-only references", () => {
    const reference = {
      bucketRole: "audio",
      protectedKey: objectToken,
      referencedBy: "reset",
      exists: true,
      ownershipVerified: true,
      contentFingerprint: sha256Digest("content"),
    } as const;

    expect(deriveStorageDeletionPlan([reference, reference])).toEqual({
      candidates: [
        {
          bucketRole: "audio",
          protectedKey: objectToken,
          contentFingerprint: sha256Digest("content"),
        },
      ],
      preservedObjectCount: 0,
    });
  });

  it("hard-stops an object referenced by both reset and preserved rows", () => {
    expectSafetyError(
      () =>
        deriveStorageDeletionPlan([
          {
            bucketRole: "audio",
            protectedKey: objectToken,
            referencedBy: "reset",
            exists: true,
            ownershipVerified: true,
            contentFingerprint: sha256Digest("content"),
          },
          {
            bucketRole: "audio",
            protectedKey: objectToken,
            referencedBy: "preserved",
            exists: true,
            ownershipVerified: true,
            contentFingerprint: sha256Digest("content"),
          },
        ]),
      "STORAGE_OBJECT_SHARED",
    );
  });
});

describe("SK-90 final drift and lock contract", () => {
  const reviewed: ResetFingerprintSnapshot = {
    manifestDigest: sha256Digest("manifest"),
    schemaFingerprint: sha256Digest("schema"),
    resetRowsFingerprint: sha256Digest("reset-rows"),
    preservedRowCountsFingerprint: sha256Digest("preserved-row-counts"),
    preservedBusinessFingerprint: sha256Digest("preserved"),
    storageReferencesFingerprint: sha256Digest("storage"),
  };

  const evidence = {
    isolationLevel: "serializable",
    advisoryLockAcquired: true,
    mutationStarted: false,
    storageDeletionStarted: false,
    locks: REQUIRED_PRE_RESET_TABLES.map((table) => ({
      table,
      mode: "share_row_exclusive" as const,
    })),
    reviewed,
    underLock: reviewed,
  } as const;

  it("accepts the exact all-table lock and in-transaction fingerprint", () => {
    expect(assertFinalLockedSnapshot(evidence)).toEqual(reviewed);
  });

  it("stops when a required table is unlocked or the manifest drifts", () => {
    expectSafetyError(
      () => assertFinalLockedSnapshot({ ...evidence, locks: evidence.locks.slice(1) }),
      "LOCK_CONTRACT_INVALID",
    );
    expectSafetyError(
      () =>
        assertFinalLockedSnapshot({
          ...evidence,
          underLock: { ...reviewed, resetRowsFingerprint: sha256Digest("changed") },
        }),
      "FINAL_DRIFT_DETECTED",
    );
  });
});

describe("SK-90 idempotent phase and rollback contracts", () => {
  it("resumes only from exact phase/state pairs and makes a verified second run a no-op", () => {
    const { manifest, prepared } = prepareApprovedRun();
    const artifactDigest = prepared.artifact.digest;
    const manifestDigest = prepared.artifact.manifestDigest;
    const quarantineSetFingerprint = assertQuarantineProof(
      prepared.artifact,
      exactQuarantineProof(prepared.artifact, manifest),
    ).quarantineSetFingerprint;
    const journalBoundary = {
      artifactDigest,
      manifestDigest,
      quarantineSetFingerprint,
    };
    const integrity = {
      artifact: prepared.artifact,
      proof: exactPostResetProof(prepared.artifact),
    };
    const missingJournalFresh = freshAuthorization(
      prepared.artifact,
      "delete_storage",
      undefined,
      "missing-journal-proof",
    );
    expectSafetyError(
      () =>
        resolveNextAction(
          { artifactDigest, manifestDigest, phase: "database_committed" },
          { database: "post", storage: "pre" },
          { artifactDigest, manifestDigest },
          missingJournalFresh,
          { quarantine: quarantineGateFor(prepared.artifact, manifest, missingJournalFresh) },
        ),
      "QUARANTINE_PROOF_REQUIRED",
    );
    const deleteFresh = freshAuthorization(
      prepared.artifact,
      "delete_storage",
      undefined,
      "delete",
    );
    expect(
      resolveNextAction(
        { ...journalBoundary, phase: "database_committed" },
        { database: "post", storage: "pre" },
        { artifactDigest, manifestDigest },
        deleteFresh,
        { quarantine: quarantineGateFor(prepared.artifact, manifest, deleteFresh) },
      ),
    ).toBe("delete_storage");

    const noopFresh = freshAuthorization(prepared.artifact, "noop", undefined, "noop-resume");
    expect(
      resolveNextAction(
        { ...journalBoundary, phase: "verified" },
        { database: "post", storage: "post" },
        { artifactDigest, manifestDigest },
        noopFresh,
        {
          integrity,
          quarantine: quarantineGateFor(prepared.artifact, manifest, noopFresh),
        },
      ),
    ).toBe("noop");

    expectSafetyError(
      () =>
        resolveNextAction(
          { ...journalBoundary, phase: "storage_deleting" },
          { database: "post", storage: "mixed" },
          { artifactDigest, manifestDigest },
          freshAuthorization(prepared.artifact, "delete_storage"),
        ),
      "RESTORE_REQUIRED",
    );
  });

  it("rejects skipped or backwards phase transitions", () => {
    const { prepared } = prepareApprovedRun();
    expectSafetyError(
      () =>
        advancePhase(
          {
            artifactDigest: prepared.artifact.digest,
            manifestDigest: prepared.artifact.manifestDigest,
            phase: "objects_quarantined",
          },
          "storage_deleted",
          freshAuthorization(prepared.artifact, "delete_storage"),
        ),
      "PHASE_STATE_INVALID",
    );
  });

  it("requires the artifact-bound integrity receipt before verified or noop", () => {
    const { manifest, prepared } = prepareApprovedRun();
    const artifactDigest = prepared.artifact.digest;
    const manifestDigest = prepared.artifact.manifestDigest;
    const quarantineSetFingerprint = assertQuarantineProof(
      prepared.artifact,
      exactQuarantineProof(prepared.artifact, manifest),
    ).quarantineSetFingerprint;
    const journalBoundary = {
      artifactDigest,
      manifestDigest,
      quarantineSetFingerprint,
    };
    const verifyAuthorization = freshAuthorization(prepared.artifact, "verify");

    expectSafetyError(
      () =>
        advancePhase(
          { ...journalBoundary, phase: "storage_deleted" },
          "verified",
          verifyAuthorization,
          {
            quarantine: quarantineGateFor(prepared.artifact, manifest, verifyAuthorization),
          },
        ),
      "POST_RESET_INTEGRITY_REQUIRED",
    );
    const noopFresh = freshAuthorization(
      prepared.artifact,
      "noop",
      undefined,
      "noop-missing-integrity",
    );
    expectSafetyError(
      () =>
        resolveNextAction(
          { ...journalBoundary, phase: "verified" },
          { database: "post", storage: "post" },
          { artifactDigest, manifestDigest },
          noopFresh,
          { quarantine: quarantineGateFor(prepared.artifact, manifest, noopFresh) },
        ),
      "POST_RESET_INTEGRITY_REQUIRED",
    );

    const integrity = {
      artifact: prepared.artifact,
      proof: exactPostResetProof(prepared.artifact),
    };
    const verifiedFresh = freshAuthorization(prepared.artifact, "verify", undefined, "verified");
    expect(
      advancePhase({ ...journalBoundary, phase: "storage_deleted" }, "verified", verifiedFresh, {
        integrity,
        quarantine: quarantineGateFor(prepared.artifact, manifest, verifiedFresh),
      }).phase,
    ).toBe("verified");
  });

  it.each([
    "before_database_commit",
    "after_database_commit_before_storage_delete",
    "after_partial_storage_delete",
  ] as const)("requires database and storage restore proof at %s", (point) => {
    const { prepared } = prepareApprovedRun();
    expect(rollbackPlanFor(point)).toMatchObject({
      interruptionPoint: point,
      restoreDatabase: true,
      restoreStorage: true,
      verifyStorageContent: true,
    });

    expect(
      assertRollbackProof(
        exactRollbackProof(prepared.artifact, point),
        freshAuthorization(prepared.artifact, "restore"),
        prepared.artifact,
      ),
    ).toEqual({ interruptionPoint: point, restored: true });
  });

  it("stops on incomplete or unequal restore evidence", () => {
    const { prepared } = prepareApprovedRun();
    const exact = exactRollbackProof(prepared.artifact, "after_partial_storage_delete");
    expectSafetyError(
      () =>
        assertRollbackProof(
          bindRollbackProof({
            ...exact,
            restored: {
              ...exact.restored,
              storage: {
                ...exact.restored.storage,
                preservedContentFingerprint: sha256Digest("wrong"),
              },
            },
          }),
          freshAuthorization(prepared.artifact, "restore"),
          prepared.artifact,
        ),
      "RESTORE_PROOF_MISMATCH",
    );
  });

  it("rejects wrong but internally equal restore fingerprints", () => {
    const { prepared } = prepareApprovedRun();
    const exact = exactRollbackProof(
      prepared.artifact,
      "after_database_commit_before_storage_delete",
    );
    const wrong = {
      ...exact.before,
      schemaFingerprint: sha256Digest("wrong-but-equal-schema"),
      resetRows: {
        ...exact.before.resetRows,
        fingerprint: sha256Digest("wrong-but-equal-reset-rows"),
      },
      preserved: {
        rowCountsFingerprint: sha256Digest("wrong-but-equal-preserved-counts"),
        businessFingerprint: sha256Digest("wrong-but-equal-preserved-business"),
      },
      storage: {
        ...exact.before.storage,
        referencesFingerprint: sha256Digest("wrong-but-equal-storage-references"),
        resetContentFingerprint: sha256Digest("wrong-but-equal-reset-content"),
        preservedContentFingerprint: sha256Digest("wrong-but-equal-preserved-content"),
      },
    };

    expectSafetyError(
      () =>
        assertRollbackProof(
          bindRollbackProof({ ...exact, before: wrong, restored: wrong }),
          freshAuthorization(prepared.artifact, "restore"),
          prepared.artifact,
        ),
      "RESTORE_PROOF_MISMATCH",
    );
  });
});

describe("SK-90 secret-redacted errors", () => {
  it("never forwards an unknown exception message", () => {
    const secret = "private@example.com/producers/raw-secret-object-key";
    const report = toSafeErrorReport(new Error(secret));

    expect(report.code).toBe("UNEXPECTED_FAILURE");
    expect(JSON.stringify(report)).not.toContain(secret);
  });

  it("renders known failures from the immutable code lookup", () => {
    const secret = "private@example.com/raw-object-key";
    const error = new Sk90ResetSafetyError("MANIFEST_INPUT_INVALID");
    error.message = secret;

    const report = toSafeErrorReport(error);
    expect(report.code).toBe("MANIFEST_INPUT_INVALID");
    expect(report.message).toBe("The private reset manifest input is invalid.");
    expect(JSON.stringify(report)).not.toContain(secret);
  });
});
