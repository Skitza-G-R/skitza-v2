import {
  canonicalJson,
  isProtectedToken,
  isSha256Digest,
  sameDigest,
  sha256Digest,
  type ProtectedToken,
  type Sha256Digest,
} from "../sk90-reset/canonical";
import { stopSk104 } from "./environment";
import {
  SK104_CANONICAL_DATABASE_FINGERPRINT,
  SK104_FROZEN_DATABASE_FINGERPRINT,
  type ApprovedProductionTargetBoundary,
} from "./target-observer";

export const SK104_PRODUCTION_MANIFEST_CONTRACT = "sk104-production-cutover-manifest-v1" as const;
export const SK104_PRODUCTION_APPROVAL_CONTRACT = "sk104-production-cutover-approval-v1" as const;
export const SK104_PRODUCTION_TARGET_POLICY_CONTRACT =
  "sk104-canonical-production-target-v1" as const;

export const SK104_RESET_INVENTORY = [
  { category: "agreement_acceptances", table: "agreement_acceptances", count: 5 },
  { category: "bookings", table: "bookings", count: 23 },
  { category: "invoices", table: "invoices", count: 4 },
  { category: "notifications", table: "notifications", count: 19 },
  { category: "payment_proofs", table: "payment_proofs", count: 2 },
  { category: "project_tracks", table: "project_tracks", count: 12 },
  { category: "projects", table: "projects", count: 20 },
  { category: "purchase_requests", table: "purchase_requests", count: 5 },
  { category: "store_purchase_intents", table: "store_purchase_intents", count: 0 },
  { category: "stripe_customers", table: "stripe_customers", count: 0 },
  { category: "track_comments", table: "track_comments", count: 14 },
  { category: "track_versions", table: "track_versions", count: 10 },
] as const;

export const SK104_PRESERVED_INVENTORY = [
  { category: "availability_blackouts", table: "availability_blackouts", count: 1 },
  { category: "availability_blocks", table: "availability_blocks", count: 117 },
  { category: "client_contacts", table: "client_contacts", count: 12 },
  { category: "portfolio_tracks", table: "portfolio_tracks", count: 5 },
  { category: "producer_external_links", table: "producer_external_links", count: 5 },
  { category: "producer_notes", table: "producer_notes", count: 0 },
  { category: "producers", table: "producers", count: 29 },
  { category: "products", table: "products", count: 46 },
] as const;

export const SK104_MOCK_EVIDENCE_COUNTS = {
  identityCount: 5,
  monetaryRowCount: 5,
  providerReferenceCount: 7,
} as const;

export const SK104_RESET_STORAGE_REFERENCE_COUNT = 9 as const;
export const SK104_RESET_ROW_COUNT = 114 as const;
export const SK104_PRESERVED_ROW_COUNT = 215 as const;
export const MAX_SK104_APPROVAL_TTL_MS = 5 * 60 * 1000;

type InventoryEntry = Readonly<{
  category: string;
  table: string;
  count: number;
}>;

export type Sk104ProductionTargetApproval = ApprovedProductionTargetBoundary &
  Readonly<{
    approvedStorageFingerprint: Sha256Digest;
    forbiddenStorageFingerprint: Sha256Digest;
    policyDigest: Sha256Digest;
  }>;

export type Sk104ProductionManifestBody = Readonly<{
  contract: typeof SK104_PRODUCTION_MANIFEST_CONTRACT;
  target: Sk104ProductionTargetApproval;
  sourceSchemaFingerprint: Sha256Digest;
  targetSchemaFingerprint: Sha256Digest;
  resetRowsFingerprint: Sha256Digest;
  preservedRowCountsFingerprint: Sha256Digest;
  preservedBusinessFingerprint: Sha256Digest;
  storageReferencesFingerprint: Sha256Digest;
  storageEnumerationFingerprint: Sha256Digest;
  mockEvidenceFingerprint: Sha256Digest;
  resetInventory: readonly InventoryEntry[];
  preservedInventory: readonly InventoryEntry[];
  mockEvidenceCounts: Readonly<{
    identityCount: number;
    monetaryRowCount: number;
    providerReferenceCount: number;
  }>;
  resetStorageReferenceCount: number;
  resetRowCount: number;
  preservedRowCount: number;
}>;

export type Sk104ProductionManifest = Sk104ProductionManifestBody &
  Readonly<{ digest: Sha256Digest }>;

export type Sk104CutoverApprovalBody = Readonly<{
  contract: typeof SK104_PRODUCTION_APPROVAL_CONTRACT;
  targetClass: "canonical_production";
  action: "execute" | "restore";
  manifestDigest: Sha256Digest;
  targetDatabaseFingerprint: Sha256Digest;
  targetStorageFingerprint: Sha256Digest;
  targetPolicyDigest: Sha256Digest;
  databaseRestorePointFingerprint: Sha256Digest;
  storageRestorePointFingerprint: Sha256Digest;
  migrationBundleDigest: Sha256Digest;
  executionPlanDigest: Sha256Digest;
  approvalChallengeToken: ProtectedToken;
  approvedAt: string;
  expiresAt: string;
}>;

export type Sk104CutoverApproval = Sk104CutoverApprovalBody & Readonly<{ digest: Sha256Digest }>;

function assertDigest(value: unknown): asserts value is Sha256Digest {
  if (typeof value !== "string" || !isSha256Digest(value)) {
    stopSk104("SK104_CONTRACT_INVALID");
  }
}

function inventoryCount(inventory: readonly InventoryEntry[]): number {
  let count = 0;
  for (const entry of inventory) {
    if (
      !/^[a-z][a-z0-9_]*$/.test(entry.category) ||
      !/^[a-z][a-z0-9_]*$/.test(entry.table) ||
      !Number.isSafeInteger(entry.count) ||
      entry.count < 0
    ) {
      stopSk104("SK104_CONTRACT_INVALID");
    }
    count += entry.count;
    if (!Number.isSafeInteger(count)) stopSk104("SK104_CONTRACT_INVALID");
  }
  return count;
}

function exactInventory(
  observed: readonly InventoryEntry[],
  expected: readonly InventoryEntry[],
): boolean {
  return canonicalJson(observed) === canonicalJson(expected);
}

function exactIsoTimestamp(value: string): number {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    stopSk104("SK104_APPROVAL_INVALID");
  }
  return milliseconds;
}

function targetPolicyBody(
  target: Omit<Sk104ProductionTargetApproval, "policyDigest">,
): Omit<Sk104ProductionTargetApproval, "policyDigest"> &
  Readonly<{ contract: typeof SK104_PRODUCTION_TARGET_POLICY_CONTRACT }> {
  return {
    contract: SK104_PRODUCTION_TARGET_POLICY_CONTRACT,
    targetClass: target.targetClass,
    approvedDatabaseFingerprint: target.approvedDatabaseFingerprint,
    forbiddenDatabaseFingerprint: target.forbiddenDatabaseFingerprint,
    approvedStorageFingerprint: target.approvedStorageFingerprint,
    forbiddenStorageFingerprint: target.forbiddenStorageFingerprint,
  };
}

export function sk104ProductionTargetPolicyDigest(
  target: Omit<Sk104ProductionTargetApproval, "policyDigest">,
): Sha256Digest {
  const untrustedTargetClass: unknown = target.targetClass;
  if (untrustedTargetClass !== "canonical_production") {
    stopSk104("SK104_TARGET_INVALID");
  }
  assertDigest(target.approvedDatabaseFingerprint);
  assertDigest(target.forbiddenDatabaseFingerprint);
  assertDigest(target.approvedStorageFingerprint);
  assertDigest(target.forbiddenStorageFingerprint);
  if (
    !sameDigest(target.approvedDatabaseFingerprint, SK104_CANONICAL_DATABASE_FINGERPRINT) ||
    !sameDigest(target.forbiddenDatabaseFingerprint, SK104_FROZEN_DATABASE_FINGERPRINT) ||
    sameDigest(target.approvedDatabaseFingerprint, target.forbiddenDatabaseFingerprint) ||
    sameDigest(target.approvedStorageFingerprint, target.forbiddenStorageFingerprint)
  ) {
    stopSk104("SK104_TARGET_INVALID");
  }
  return sha256Digest(canonicalJson(targetPolicyBody(target)));
}

export function bindSk104ProductionTarget(
  input: Omit<Sk104ProductionTargetApproval, "policyDigest">,
  approvedPolicyDigest: Sha256Digest,
): Sk104ProductionTargetApproval {
  assertDigest(approvedPolicyDigest);
  const observedPolicyDigest = sk104ProductionTargetPolicyDigest(input);
  if (!sameDigest(observedPolicyDigest, approvedPolicyDigest)) {
    stopSk104("SK104_TARGET_INVALID");
  }
  return { ...input, policyDigest: approvedPolicyDigest };
}

function assertTarget(target: Sk104ProductionTargetApproval): void {
  const untrustedTargetClass: unknown = target.targetClass;
  if (untrustedTargetClass !== "canonical_production") {
    stopSk104("SK104_TARGET_INVALID");
  }
  assertDigest(target.policyDigest);
  const rebound = sk104ProductionTargetPolicyDigest(target);
  if (!sameDigest(rebound, target.policyDigest)) stopSk104("SK104_TARGET_INVALID");
}

function manifestBody(manifest: Sk104ProductionManifestBody): Sk104ProductionManifestBody {
  return {
    contract: manifest.contract,
    target: manifest.target,
    sourceSchemaFingerprint: manifest.sourceSchemaFingerprint,
    targetSchemaFingerprint: manifest.targetSchemaFingerprint,
    resetRowsFingerprint: manifest.resetRowsFingerprint,
    preservedRowCountsFingerprint: manifest.preservedRowCountsFingerprint,
    preservedBusinessFingerprint: manifest.preservedBusinessFingerprint,
    storageReferencesFingerprint: manifest.storageReferencesFingerprint,
    storageEnumerationFingerprint: manifest.storageEnumerationFingerprint,
    mockEvidenceFingerprint: manifest.mockEvidenceFingerprint,
    resetInventory: manifest.resetInventory,
    preservedInventory: manifest.preservedInventory,
    mockEvidenceCounts: manifest.mockEvidenceCounts,
    resetStorageReferenceCount: manifest.resetStorageReferenceCount,
    resetRowCount: manifest.resetRowCount,
    preservedRowCount: manifest.preservedRowCount,
  };
}

function assertManifestBody(manifest: Sk104ProductionManifestBody): void {
  const untrustedContract: unknown = manifest.contract;
  if (untrustedContract !== SK104_PRODUCTION_MANIFEST_CONTRACT) {
    stopSk104("SK104_CONTRACT_INVALID");
  }
  assertTarget(manifest.target);
  for (const value of [
    manifest.sourceSchemaFingerprint,
    manifest.targetSchemaFingerprint,
    manifest.resetRowsFingerprint,
    manifest.preservedRowCountsFingerprint,
    manifest.preservedBusinessFingerprint,
    manifest.storageReferencesFingerprint,
    manifest.storageEnumerationFingerprint,
    manifest.mockEvidenceFingerprint,
  ]) {
    assertDigest(value);
  }
  if (
    !exactInventory(manifest.resetInventory, SK104_RESET_INVENTORY) ||
    !exactInventory(manifest.preservedInventory, SK104_PRESERVED_INVENTORY) ||
    canonicalJson(manifest.mockEvidenceCounts) !== canonicalJson(SK104_MOCK_EVIDENCE_COUNTS) ||
    manifest.resetStorageReferenceCount !== SK104_RESET_STORAGE_REFERENCE_COUNT ||
    manifest.resetRowCount !== SK104_RESET_ROW_COUNT ||
    manifest.preservedRowCount !== SK104_PRESERVED_ROW_COUNT ||
    inventoryCount(manifest.resetInventory) !== SK104_RESET_ROW_COUNT ||
    inventoryCount(manifest.preservedInventory) !== SK104_PRESERVED_ROW_COUNT
  ) {
    stopSk104("SK104_CONTRACT_INVALID");
  }
}

export function buildSk104ProductionManifest(
  input: Readonly<{
    target: Sk104ProductionTargetApproval;
    sourceSchemaFingerprint: Sha256Digest;
    targetSchemaFingerprint: Sha256Digest;
    resetRowsFingerprint: Sha256Digest;
    preservedRowCountsFingerprint: Sha256Digest;
    preservedBusinessFingerprint: Sha256Digest;
    storageReferencesFingerprint: Sha256Digest;
    storageEnumerationFingerprint: Sha256Digest;
    mockEvidenceFingerprint: Sha256Digest;
  }>,
): Sk104ProductionManifest {
  const body: Sk104ProductionManifestBody = {
    contract: SK104_PRODUCTION_MANIFEST_CONTRACT,
    target: input.target,
    sourceSchemaFingerprint: input.sourceSchemaFingerprint,
    targetSchemaFingerprint: input.targetSchemaFingerprint,
    resetRowsFingerprint: input.resetRowsFingerprint,
    preservedRowCountsFingerprint: input.preservedRowCountsFingerprint,
    preservedBusinessFingerprint: input.preservedBusinessFingerprint,
    storageReferencesFingerprint: input.storageReferencesFingerprint,
    storageEnumerationFingerprint: input.storageEnumerationFingerprint,
    mockEvidenceFingerprint: input.mockEvidenceFingerprint,
    resetInventory: SK104_RESET_INVENTORY.map((entry) => ({ ...entry })),
    preservedInventory: SK104_PRESERVED_INVENTORY.map((entry) => ({ ...entry })),
    mockEvidenceCounts: { ...SK104_MOCK_EVIDENCE_COUNTS },
    resetStorageReferenceCount: SK104_RESET_STORAGE_REFERENCE_COUNT,
    resetRowCount: SK104_RESET_ROW_COUNT,
    preservedRowCount: SK104_PRESERVED_ROW_COUNT,
  };
  assertManifestBody(body);
  return { ...body, digest: sha256Digest(canonicalJson(body)) };
}

export function assertSk104ProductionManifest(
  manifest: Sk104ProductionManifest,
): Sk104ProductionManifest {
  assertManifestBody(manifest);
  assertDigest(manifest.digest);
  const observed = sha256Digest(canonicalJson(manifestBody(manifest)));
  if (!sameDigest(observed, manifest.digest)) stopSk104("SK104_DIGEST_MISMATCH");
  return manifest;
}

function approvalBody(approval: Sk104CutoverApprovalBody): Sk104CutoverApprovalBody {
  return {
    contract: approval.contract,
    targetClass: approval.targetClass,
    action: approval.action,
    manifestDigest: approval.manifestDigest,
    targetDatabaseFingerprint: approval.targetDatabaseFingerprint,
    targetStorageFingerprint: approval.targetStorageFingerprint,
    targetPolicyDigest: approval.targetPolicyDigest,
    databaseRestorePointFingerprint: approval.databaseRestorePointFingerprint,
    storageRestorePointFingerprint: approval.storageRestorePointFingerprint,
    migrationBundleDigest: approval.migrationBundleDigest,
    executionPlanDigest: approval.executionPlanDigest,
    approvalChallengeToken: approval.approvalChallengeToken,
    approvedAt: approval.approvedAt,
    expiresAt: approval.expiresAt,
  };
}

function assertApprovalBody(
  approval: Sk104CutoverApprovalBody,
  manifest: Sk104ProductionManifest,
): void {
  const untrustedContract: unknown = approval.contract;
  const untrustedTargetClass: unknown = approval.targetClass;
  const untrustedAction: unknown = approval.action;
  if (
    untrustedContract !== SK104_PRODUCTION_APPROVAL_CONTRACT ||
    untrustedTargetClass !== "canonical_production" ||
    (untrustedAction !== "execute" && untrustedAction !== "restore")
  ) {
    stopSk104("SK104_APPROVAL_INVALID");
  }
  for (const value of [
    approval.manifestDigest,
    approval.targetDatabaseFingerprint,
    approval.targetStorageFingerprint,
    approval.targetPolicyDigest,
    approval.databaseRestorePointFingerprint,
    approval.storageRestorePointFingerprint,
    approval.migrationBundleDigest,
    approval.executionPlanDigest,
  ]) {
    assertDigest(value);
  }
  if (!isProtectedToken(approval.approvalChallengeToken)) {
    stopSk104("SK104_APPROVAL_INVALID");
  }
  const approvedAt = exactIsoTimestamp(approval.approvedAt);
  const expiresAt = exactIsoTimestamp(approval.expiresAt);
  if (
    expiresAt <= approvedAt ||
    expiresAt - approvedAt > MAX_SK104_APPROVAL_TTL_MS ||
    !sameDigest(approval.manifestDigest, manifest.digest) ||
    !sameDigest(approval.targetDatabaseFingerprint, manifest.target.approvedDatabaseFingerprint) ||
    !sameDigest(approval.targetStorageFingerprint, manifest.target.approvedStorageFingerprint) ||
    !sameDigest(approval.targetPolicyDigest, manifest.target.policyDigest)
  ) {
    stopSk104("SK104_APPROVAL_INVALID");
  }
}

export function bindSk104CutoverApproval(
  input: Omit<Sk104CutoverApprovalBody, "contract" | "targetClass"> &
    Readonly<{ manifest: Sk104ProductionManifest }>,
): Sk104CutoverApproval {
  assertSk104ProductionManifest(input.manifest);
  const body: Sk104CutoverApprovalBody = {
    contract: SK104_PRODUCTION_APPROVAL_CONTRACT,
    targetClass: "canonical_production",
    action: input.action,
    manifestDigest: input.manifestDigest,
    targetDatabaseFingerprint: input.targetDatabaseFingerprint,
    targetStorageFingerprint: input.targetStorageFingerprint,
    targetPolicyDigest: input.targetPolicyDigest,
    databaseRestorePointFingerprint: input.databaseRestorePointFingerprint,
    storageRestorePointFingerprint: input.storageRestorePointFingerprint,
    migrationBundleDigest: input.migrationBundleDigest,
    executionPlanDigest: input.executionPlanDigest,
    approvalChallengeToken: input.approvalChallengeToken,
    approvedAt: input.approvedAt,
    expiresAt: input.expiresAt,
  };
  assertApprovalBody(body, input.manifest);
  return { ...body, digest: sha256Digest(canonicalJson(body)) };
}

export function assertSk104CutoverApproval(
  approval: Sk104CutoverApproval,
  manifest: Sk104ProductionManifest,
  currentTime: string,
): Sk104CutoverApproval {
  assertSk104ProductionManifest(manifest);
  assertApprovalBody(approval, manifest);
  assertDigest(approval.digest);
  if (!sameDigest(approval.digest, sha256Digest(canonicalJson(approvalBody(approval))))) {
    stopSk104("SK104_DIGEST_MISMATCH");
  }
  const current = exactIsoTimestamp(currentTime);
  if (current < Date.parse(approval.approvedAt) || current >= Date.parse(approval.expiresAt)) {
    stopSk104("SK104_APPROVAL_EXPIRED");
  }
  return approval;
}
