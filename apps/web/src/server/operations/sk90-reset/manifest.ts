import {
  assertProtectedToken,
  assertSha256Digest,
  canonicalJson,
  compareUtf8Bytes,
  protectValue,
  sameDigest,
  sha256Digest,
  type JsonValue,
  type ProtectedToken,
  type Sha256Digest,
} from "./canonical";
import { stop } from "./errors";
import { assertMockEvidenceCoverageShape, type MockEvidenceCoverage } from "./policy";
import { deriveStorageDeletionPlan, type StorageReference } from "./storage";

export type ResetRowCandidate = Readonly<{
  category: string;
  table: string;
  id: string;
  payload: JsonValue;
}>;

export type RawStorageReference = Readonly<{
  bucketRole: "audio" | "docs";
  key: string;
  referencedBy: "reset" | "preserved";
  exists: boolean;
  ownershipVerified: boolean;
  contentFingerprint: Sha256Digest;
}>;

export type SanitizedManifestInput = Readonly<{
  artifactVersion: string;
  targetPolicyDigest: Sha256Digest;
  preSchemaFingerprint: Sha256Digest;
  reviewedTargetSchemaFingerprint: Sha256Digest;
  preservedRowCountsFingerprint: Sha256Digest;
  preservedBusinessFingerprint: Sha256Digest;
  mockEvidenceCoverage: MockEvidenceCoverage;
  storageReferenceCoverage: StorageReferenceCoverage;
  rows: readonly ResetRowCandidate[];
  storageReferences: readonly RawStorageReference[];
}>;

export type SanitizedManifestRow = Readonly<{
  category: string;
  table: string;
  protectedId: ProtectedToken;
  protectedContent: ProtectedToken;
}>;

export const SK90_APPROVED_RESET_INVENTORY = [
  { category: "agreement_acceptances", table: "agreement_acceptances", count: 4 },
  { category: "bookings", table: "bookings", count: 22 },
  { category: "invoices", table: "invoices", count: 3 },
  { category: "notifications", table: "notifications", count: 15 },
  { category: "payment_proofs", table: "payment_proofs", count: 1 },
  { category: "project_tracks", table: "project_tracks", count: 11 },
  { category: "projects", table: "projects", count: 19 },
  { category: "purchase_requests", table: "purchase_requests", count: 4 },
  { category: "store_purchase_intents", table: "store_purchase_intents", count: 0 },
  { category: "stripe_customers", table: "stripe_customers", count: 0 },
  { category: "track_comments", table: "track_comments", count: 14 },
  { category: "track_versions", table: "track_versions", count: 9 },
] as const;

export const SK90_APPROVED_RESET_STORAGE_REFERENCE_COUNT = 7;

export type StorageReferenceCoverage = Readonly<{
  resetReferenceCount: number;
  resetReferenceTokensFingerprint: Sha256Digest;
  preservedReferenceCount: number;
  preservedReferenceTokensFingerprint: Sha256Digest;
}>;

export type SanitizedResetInventory = Readonly<{
  category: (typeof SK90_APPROVED_RESET_INVENTORY)[number]["category"];
  table: (typeof SK90_APPROVED_RESET_INVENTORY)[number]["table"];
  count: number;
}>;

export type SanitizedManifestObject = Readonly<{
  bucketRole: "audio" | "docs";
  protectedKey: ProtectedToken;
  contentFingerprint: Sha256Digest;
  ownership: "reset_exclusive" | "preserved_only";
}>;

type ManifestBody = Readonly<{
  contract: "sk90-sanitized-private-manifest-v1";
  artifactVersion: string;
  targetPolicyDigest: Sha256Digest;
  preSchemaFingerprint: Sha256Digest;
  reviewedTargetSchemaFingerprint: Sha256Digest;
  preservedRowCountsFingerprint: Sha256Digest;
  preservedBusinessFingerprint: Sha256Digest;
  mockEvidenceCoverage: MockEvidenceCoverage;
  storageReferenceCoverage: StorageReferenceCoverage;
  resetInventory: readonly SanitizedResetInventory[];
  rows: readonly SanitizedManifestRow[];
  resetRowsFingerprint: Sha256Digest;
  storageReferences: readonly StorageReference[];
  storageReferencesFingerprint: Sha256Digest;
  storageObjects: readonly SanitizedManifestObject[];
  resetStorageObjectsFingerprint: Sha256Digest;
  preservedStorageContentFingerprint: Sha256Digest;
  aggregates: Readonly<{
    resetRowCount: number;
    resetStorageObjectCount: number;
    preservedStorageObjectCount: number;
  }>;
}>;

export type SanitizedResetManifest = ManifestBody &
  Readonly<{
    digest: Sha256Digest;
  }>;

const SAFE_LABEL = /^[a-z0-9][a-z0-9_-]{0,79}$/;

function assertSafeLabel(value: string): void {
  if (!SAFE_LABEL.test(value)) stop("MANIFEST_INPUT_INVALID");
}

function assertStorageReferenceShape(
  reference: Pick<
    RawStorageReference | StorageReference,
    "bucketRole" | "referencedBy" | "exists" | "ownershipVerified"
  >,
): void {
  const raw = reference as {
    bucketRole: unknown;
    referencedBy: unknown;
    exists: unknown;
    ownershipVerified: unknown;
  };
  if (
    (raw.bucketRole !== "audio" && raw.bucketRole !== "docs") ||
    (raw.referencedBy !== "reset" && raw.referencedBy !== "preserved") ||
    typeof raw.exists !== "boolean" ||
    typeof raw.ownershipVerified !== "boolean"
  ) {
    stop("MANIFEST_INPUT_INVALID");
  }
}

function assertApprovedResetInventory(
  rows: readonly Pick<ResetRowCandidate | SanitizedManifestRow, "category" | "table">[],
): readonly SanitizedResetInventory[] {
  const approvedByIdentity = new Map(
    SK90_APPROVED_RESET_INVENTORY.map((entry) => [
      `${entry.category}\0${entry.table}`,
      entry.count,
    ]),
  );
  const observed = new Map<string, number>();

  for (const row of rows) {
    const identity = `${row.category}\0${row.table}`;
    if (!approvedByIdentity.has(identity)) stop("MANIFEST_INPUT_INVALID");
    observed.set(identity, (observed.get(identity) ?? 0) + 1);
  }

  for (const entry of SK90_APPROVED_RESET_INVENTORY) {
    const identity = `${entry.category}\0${entry.table}`;
    if ((observed.get(identity) ?? 0) !== entry.count) {
      stop("MANIFEST_INPUT_INVALID");
    }
  }

  return SK90_APPROVED_RESET_INVENTORY.map((entry) => ({ ...entry }));
}

function sanitizedRows(
  candidates: readonly ResetRowCandidate[],
  hmacKey: string,
): SanitizedManifestRow[] {
  assertApprovedResetInventory(candidates);
  const rows = candidates.map((candidate) => {
    assertSafeLabel(candidate.category);
    assertSafeLabel(candidate.table);
    if (!candidate.id) stop("MANIFEST_INPUT_INVALID");

    return {
      category: candidate.category,
      table: candidate.table,
      protectedId: protectValue(hmacKey, `row-id\0${candidate.table}\0${candidate.id}`),
      protectedContent: protectValue(
        hmacKey,
        `row-content\0${candidate.table}\0${canonicalJson(candidate.payload)}`,
      ),
    };
  });

  rows.sort((left, right) =>
    compareUtf8Bytes(`${left.table}:${left.protectedId}`, `${right.table}:${right.protectedId}`),
  );
  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1];
    const current = rows[index];
    if (
      previous &&
      current &&
      previous.table === current.table &&
      previous.protectedId === current.protectedId
    ) {
      stop("MANIFEST_DUPLICATE_ENTRY");
    }
  }
  return rows;
}

export function fingerprintSanitizedResetRows(rows: readonly SanitizedManifestRow[]): Sha256Digest {
  const normalized = rows.map((row) => {
    assertSafeLabel(row.category);
    assertSafeLabel(row.table);
    assertProtectedToken(row.protectedId);
    assertProtectedToken(row.protectedContent);
    return { ...row };
  });
  normalized.sort((left, right) =>
    compareUtf8Bytes(`${left.table}:${left.protectedId}`, `${right.table}:${right.protectedId}`),
  );
  for (let index = 1; index < normalized.length; index += 1) {
    const previous = normalized[index - 1];
    const current = normalized[index];
    if (
      previous &&
      current &&
      previous.table === current.table &&
      previous.protectedId === current.protectedId
    ) {
      stop("MANIFEST_DUPLICATE_ENTRY");
    }
  }
  return sha256Digest(canonicalJson(normalized));
}

function sanitizedStorageReferences(
  references: readonly RawStorageReference[],
  hmacKey: string,
): StorageReference[] {
  const sanitized = references.map((reference) => {
    if (!reference.key) stop("MANIFEST_INPUT_INVALID");
    assertStorageReferenceShape(reference);
    assertSha256Digest(reference.contentFingerprint);
    return {
      bucketRole: reference.bucketRole,
      protectedKey: protectValue(hmacKey, `storage-key\0${reference.bucketRole}\0${reference.key}`),
      referencedBy: reference.referencedBy,
      exists: reference.exists,
      ownershipVerified: reference.ownershipVerified,
      contentFingerprint: reference.contentFingerprint,
    };
  });
  sanitized.sort((left, right) =>
    compareUtf8Bytes(
      `${left.bucketRole}:${left.protectedKey}:${left.referencedBy}`,
      `${right.bucketRole}:${right.protectedKey}:${right.referencedBy}`,
    ),
  );
  return sanitized;
}

/** Fingerprint the complete independently discovered reference set, including preserved links. */
export function fingerprintStorageReferences(
  references: readonly StorageReference[],
): Sha256Digest {
  const identities = new Set<string>();
  const normalized = references.map((reference) => {
    assertStorageReferenceShape(reference);
    assertProtectedToken(reference.protectedKey);
    assertSha256Digest(reference.contentFingerprint);
    const identity = `${reference.bucketRole}\0${reference.protectedKey}\0${reference.referencedBy}`;
    if (identities.has(identity)) stop("MANIFEST_DUPLICATE_ENTRY");
    identities.add(identity);
    return { ...reference };
  });
  normalized.sort((left, right) =>
    compareUtf8Bytes(
      `${left.bucketRole}:${left.protectedKey}:${left.referencedBy}`,
      `${right.bucketRole}:${right.protectedKey}:${right.referencedBy}`,
    ),
  );
  return sha256Digest(canonicalJson(normalized));
}

export function assertStorageReferenceCoverageShape(
  coverage: StorageReferenceCoverage | undefined,
): asserts coverage is StorageReferenceCoverage {
  if (
    !coverage ||
    coverage.resetReferenceCount !== SK90_APPROVED_RESET_STORAGE_REFERENCE_COUNT ||
    !Number.isSafeInteger(coverage.preservedReferenceCount) ||
    coverage.preservedReferenceCount < 1
  ) {
    stop("MANIFEST_INPUT_INVALID");
  }
  assertSha256Digest(coverage.resetReferenceTokensFingerprint);
  assertSha256Digest(coverage.preservedReferenceTokensFingerprint);
}

export function buildStorageReferenceCoverage(
  references: readonly StorageReference[],
): StorageReferenceCoverage {
  const resetTokens: string[] = [];
  const preservedTokens: string[] = [];
  const identities = new Set<string>();

  for (const reference of references) {
    assertStorageReferenceShape(reference);
    assertProtectedToken(reference.protectedKey);
    assertSha256Digest(reference.contentFingerprint);
    const identity = `${reference.bucketRole}\0${reference.protectedKey}\0${reference.referencedBy}`;
    if (identities.has(identity)) stop("MANIFEST_DUPLICATE_ENTRY");
    identities.add(identity);
    if (reference.referencedBy === "reset") resetTokens.push(identity);
    else preservedTokens.push(identity);
  }

  resetTokens.sort();
  preservedTokens.sort();
  if (
    resetTokens.length !== SK90_APPROVED_RESET_STORAGE_REFERENCE_COUNT ||
    preservedTokens.length < 1
  ) {
    stop("MANIFEST_INPUT_INVALID");
  }

  return {
    resetReferenceCount: SK90_APPROVED_RESET_STORAGE_REFERENCE_COUNT,
    resetReferenceTokensFingerprint: sha256Digest(canonicalJson(resetTokens)),
    preservedReferenceCount: preservedTokens.length,
    preservedReferenceTokensFingerprint: sha256Digest(canonicalJson(preservedTokens)),
  };
}

function sanitizedStorageObjects(
  references: readonly StorageReference[],
): SanitizedManifestObject[] {
  const plan = deriveStorageDeletionPlan(references);
  const resetKeys = new Set(
    plan.candidates.map((candidate) => `${candidate.bucketRole}\0${candidate.protectedKey}`),
  );
  const groups = new Map<string, SanitizedManifestObject>();

  for (const reference of references) {
    const identity = `${reference.bucketRole}\0${reference.protectedKey}`;
    const existing = groups.get(identity);
    if (existing) {
      if (!sameDigest(existing.contentFingerprint, reference.contentFingerprint)) {
        stop("STORAGE_OBJECT_DRIFT");
      }
      continue;
    }
    groups.set(identity, {
      bucketRole: reference.bucketRole,
      protectedKey: reference.protectedKey,
      contentFingerprint: reference.contentFingerprint,
      ownership: resetKeys.has(identity) ? "reset_exclusive" : "preserved_only",
    });
  }

  return [...groups.values()].sort((left, right) =>
    compareUtf8Bytes(
      `${left.bucketRole}:${left.protectedKey}`,
      `${right.bucketRole}:${right.protectedKey}`,
    ),
  );
}

function fingerprintStorageObjects(
  objects: readonly SanitizedManifestObject[],
  ownership: SanitizedManifestObject["ownership"],
): Sha256Digest {
  const selected = objects
    .filter((object) => object.ownership === ownership)
    .map((object) => ({
      bucketRole: object.bucketRole,
      protectedKey: object.protectedKey,
      contentFingerprint: object.contentFingerprint,
    }))
    .sort((left, right) =>
      compareUtf8Bytes(
        `${left.bucketRole}:${left.protectedKey}`,
        `${right.bucketRole}:${right.protectedKey}`,
      ),
    );
  return sha256Digest(canonicalJson(selected));
}

function bodyOf(manifest: SanitizedResetManifest): ManifestBody {
  return {
    contract: manifest.contract,
    artifactVersion: manifest.artifactVersion,
    targetPolicyDigest: manifest.targetPolicyDigest,
    preSchemaFingerprint: manifest.preSchemaFingerprint,
    reviewedTargetSchemaFingerprint: manifest.reviewedTargetSchemaFingerprint,
    preservedRowCountsFingerprint: manifest.preservedRowCountsFingerprint,
    preservedBusinessFingerprint: manifest.preservedBusinessFingerprint,
    mockEvidenceCoverage: manifest.mockEvidenceCoverage,
    storageReferenceCoverage: manifest.storageReferenceCoverage,
    resetInventory: manifest.resetInventory,
    rows: manifest.rows,
    resetRowsFingerprint: manifest.resetRowsFingerprint,
    storageReferences: manifest.storageReferences,
    storageReferencesFingerprint: manifest.storageReferencesFingerprint,
    storageObjects: manifest.storageObjects,
    resetStorageObjectsFingerprint: manifest.resetStorageObjectsFingerprint,
    preservedStorageContentFingerprint: manifest.preservedStorageContentFingerprint,
    aggregates: manifest.aggregates,
  };
}

function assertManifestShape(manifest: SanitizedResetManifest): void {
  assertSafeLabel(manifest.artifactVersion);
  assertSha256Digest(manifest.targetPolicyDigest);
  assertSha256Digest(manifest.preSchemaFingerprint);
  assertSha256Digest(manifest.reviewedTargetSchemaFingerprint);
  assertSha256Digest(manifest.preservedRowCountsFingerprint);
  assertSha256Digest(manifest.preservedBusinessFingerprint);
  assertMockEvidenceCoverageShape(manifest.mockEvidenceCoverage);
  assertStorageReferenceCoverageShape(manifest.storageReferenceCoverage);
  const expectedInventory = assertApprovedResetInventory(manifest.rows);
  if (canonicalJson(manifest.resetInventory) !== canonicalJson(expectedInventory)) {
    stop("MANIFEST_DIGEST_MISMATCH");
  }

  const rowIdentities = new Set<string>();
  for (const row of manifest.rows) {
    assertSafeLabel(row.category);
    assertSafeLabel(row.table);
    assertProtectedToken(row.protectedId);
    assertProtectedToken(row.protectedContent);
    const identity = `${row.table}\0${row.protectedId}`;
    if (rowIdentities.has(identity)) stop("MANIFEST_DUPLICATE_ENTRY");
    rowIdentities.add(identity);
  }
  assertSha256Digest(manifest.resetRowsFingerprint);
  if (!sameDigest(manifest.resetRowsFingerprint, fingerprintSanitizedResetRows(manifest.rows))) {
    stop("MANIFEST_DIGEST_MISMATCH");
  }

  assertSha256Digest(manifest.storageReferencesFingerprint);
  const observedStorageReferencesFingerprint = fingerprintStorageReferences(
    manifest.storageReferences,
  );
  if (!sameDigest(manifest.storageReferencesFingerprint, observedStorageReferencesFingerprint)) {
    stop("MANIFEST_DIGEST_MISMATCH");
  }
  const observedStorageCoverage = buildStorageReferenceCoverage(manifest.storageReferences);
  if (canonicalJson(observedStorageCoverage) !== canonicalJson(manifest.storageReferenceCoverage)) {
    stop("MANIFEST_DIGEST_MISMATCH");
  }
  deriveStorageDeletionPlan(manifest.storageReferences);
  const expectedStorageObjects = sanitizedStorageObjects(manifest.storageReferences);
  if (canonicalJson(expectedStorageObjects) !== canonicalJson(manifest.storageObjects)) {
    stop("MANIFEST_DIGEST_MISMATCH");
  }

  const objectIdentities = new Set<string>();
  let resetStorageObjectCount = 0;
  let preservedStorageObjectCount = 0;
  for (const object of manifest.storageObjects) {
    assertProtectedToken(object.protectedKey);
    assertSha256Digest(object.contentFingerprint);
    const identity = `${object.bucketRole}\0${object.protectedKey}`;
    if (objectIdentities.has(identity)) stop("MANIFEST_DUPLICATE_ENTRY");
    objectIdentities.add(identity);
    if (object.ownership === "reset_exclusive") resetStorageObjectCount += 1;
    else preservedStorageObjectCount += 1;
  }

  assertSha256Digest(manifest.resetStorageObjectsFingerprint);
  assertSha256Digest(manifest.preservedStorageContentFingerprint);
  if (
    !sameDigest(
      manifest.resetStorageObjectsFingerprint,
      fingerprintStorageObjects(manifest.storageObjects, "reset_exclusive"),
    ) ||
    !sameDigest(
      manifest.preservedStorageContentFingerprint,
      fingerprintStorageObjects(manifest.storageObjects, "preserved_only"),
    )
  ) {
    stop("MANIFEST_DIGEST_MISMATCH");
  }

  if (
    manifest.aggregates.resetRowCount !== manifest.rows.length ||
    manifest.aggregates.resetStorageObjectCount !== resetStorageObjectCount ||
    manifest.aggregates.preservedStorageObjectCount !== preservedStorageObjectCount ||
    manifest.storageReferenceCoverage.resetReferenceCount !== resetStorageObjectCount ||
    manifest.storageReferenceCoverage.preservedReferenceCount !== preservedStorageObjectCount
  ) {
    stop("MANIFEST_DIGEST_MISMATCH");
  }
}

export function buildSanitizedManifest(
  input: SanitizedManifestInput,
  hmacKey: string,
): SanitizedResetManifest {
  assertSafeLabel(input.artifactVersion);
  assertSha256Digest(input.targetPolicyDigest);
  assertSha256Digest(input.preSchemaFingerprint);
  assertSha256Digest(input.reviewedTargetSchemaFingerprint);
  assertSha256Digest(input.preservedRowCountsFingerprint);
  assertSha256Digest(input.preservedBusinessFingerprint);
  assertMockEvidenceCoverageShape(input.mockEvidenceCoverage);
  assertStorageReferenceCoverageShape(input.storageReferenceCoverage);

  const rows = sanitizedRows(input.rows, hmacKey);
  const resetRowsFingerprint = fingerprintSanitizedResetRows(rows);
  const references = sanitizedStorageReferences(input.storageReferences, hmacKey);
  const storageReferencesFingerprint = fingerprintStorageReferences(references);
  const observedStorageCoverage = buildStorageReferenceCoverage(references);
  if (canonicalJson(observedStorageCoverage) !== canonicalJson(input.storageReferenceCoverage)) {
    stop("MANIFEST_INPUT_INVALID");
  }
  const storagePlan = deriveStorageDeletionPlan(references);
  const storageObjects = sanitizedStorageObjects(references);
  const resetStorageObjectsFingerprint = fingerprintStorageObjects(
    storageObjects,
    "reset_exclusive",
  );
  const preservedStorageContentFingerprint = fingerprintStorageObjects(
    storageObjects,
    "preserved_only",
  );
  const body: ManifestBody = {
    contract: "sk90-sanitized-private-manifest-v1",
    artifactVersion: input.artifactVersion,
    targetPolicyDigest: input.targetPolicyDigest,
    preSchemaFingerprint: input.preSchemaFingerprint,
    reviewedTargetSchemaFingerprint: input.reviewedTargetSchemaFingerprint,
    preservedRowCountsFingerprint: input.preservedRowCountsFingerprint,
    preservedBusinessFingerprint: input.preservedBusinessFingerprint,
    mockEvidenceCoverage: input.mockEvidenceCoverage,
    storageReferenceCoverage: input.storageReferenceCoverage,
    resetInventory: SK90_APPROVED_RESET_INVENTORY.map((entry) => ({ ...entry })),
    rows,
    resetRowsFingerprint,
    storageReferences: references,
    storageReferencesFingerprint,
    storageObjects,
    resetStorageObjectsFingerprint,
    preservedStorageContentFingerprint,
    aggregates: {
      resetRowCount: rows.length,
      resetStorageObjectCount: storagePlan.candidates.length,
      preservedStorageObjectCount: storagePlan.preservedObjectCount,
    },
  };

  return { ...body, digest: sha256Digest(canonicalJson(body)) };
}

export function assertManifestDigest(manifest: SanitizedResetManifest): true {
  assertManifestShape(manifest);
  assertSha256Digest(manifest.digest);
  const observed = sha256Digest(canonicalJson(bodyOf(manifest)));
  if (!sameDigest(observed, manifest.digest)) stop("MANIFEST_DIGEST_MISMATCH");
  return true;
}
