import { describe, expect, it } from "vitest";

import { protectValue, sha256Digest } from "../sk90-reset/canonical";
import {
  MAX_SK104_APPROVAL_TTL_MS,
  SK104_MOCK_EVIDENCE_COUNTS,
  SK104_PRESERVED_INVENTORY,
  SK104_PRESERVED_ROW_COUNT,
  SK104_RESET_INVENTORY,
  SK104_RESET_ROW_COUNT,
  SK104_RESET_STORAGE_REFERENCE_COUNT,
  assertSk104CutoverApproval,
  assertSk104ProductionManifest,
  bindSk104CutoverApproval,
  bindSk104ProductionTarget,
  buildSk104ProductionManifest,
  sk104ProductionTargetPolicyDigest,
  type Sk104ProductionManifest,
} from "./contract";
import {
  SK104_CANONICAL_DATABASE_FINGERPRINT,
  SK104_FROZEN_DATABASE_FINGERPRINT,
} from "./target-observer";

function productionTarget() {
  const boundary = {
    targetClass: "canonical_production" as const,
    approvedDatabaseFingerprint: SK104_CANONICAL_DATABASE_FINGERPRINT,
    forbiddenDatabaseFingerprint: SK104_FROZEN_DATABASE_FINGERPRINT,
    approvedStorageFingerprint: sha256Digest("canonical-storage"),
    forbiddenStorageFingerprint: sha256Digest("forbidden-storage"),
  };
  return bindSk104ProductionTarget(boundary, sk104ProductionTargetPolicyDigest(boundary));
}

function manifest(): Sk104ProductionManifest {
  return buildSk104ProductionManifest({
    target: productionTarget(),
    sourceSchemaFingerprint: sha256Digest("source-schema"),
    targetSchemaFingerprint: sha256Digest("target-schema-through-0034"),
    resetRowsFingerprint: sha256Digest("exact-114-reset-rows"),
    preservedRowCountsFingerprint: sha256Digest("exact-preserved-counts"),
    preservedBusinessFingerprint: sha256Digest("exact-preserved-business-content"),
    storageReferencesFingerprint: sha256Digest("exact-storage-references"),
    storageEnumerationFingerprint: sha256Digest("complete-storage-enumeration"),
    mockEvidenceFingerprint: sha256Digest("five-five-seven-mock-evidence"),
  });
}

function approval(activeManifest = manifest()) {
  const approvedAt = "2026-07-22T10:00:00.000Z";
  return bindSk104CutoverApproval({
    manifest: activeManifest,
    action: "execute",
    manifestDigest: activeManifest.digest,
    targetDatabaseFingerprint: activeManifest.target.approvedDatabaseFingerprint,
    targetStorageFingerprint: activeManifest.target.approvedStorageFingerprint,
    targetPolicyDigest: activeManifest.target.policyDigest,
    databaseRestorePointFingerprint: sha256Digest("database-backup"),
    storageRestorePointFingerprint: sha256Digest("storage-backup"),
    migrationBundleDigest: sha256Digest("migrations-0027-through-0034"),
    executionPlanDigest: sha256Digest("exact-production-plan"),
    approvalChallengeToken: protectValue(
      "test-only-approval-key-with-at-least-32-bytes",
      "one-time-production-approval",
    ),
    approvedAt,
    expiresAt: new Date(Date.parse(approvedAt) + MAX_SK104_APPROVAL_TTL_MS).toISOString(),
  });
}

describe("SK-104 production-cutover contract", () => {
  it("binds the exact approved reset, preserved, mock, and storage inventory", () => {
    const exact = manifest();

    expect(exact.resetInventory).toEqual(SK104_RESET_INVENTORY);
    expect(exact.preservedInventory).toEqual(SK104_PRESERVED_INVENTORY);
    expect(exact.resetRowCount).toBe(SK104_RESET_ROW_COUNT);
    expect(exact.preservedRowCount).toBe(SK104_PRESERVED_ROW_COUNT);
    expect(exact.mockEvidenceCounts).toEqual(SK104_MOCK_EVIDENCE_COUNTS);
    expect(exact.resetStorageReferenceCount).toBe(SK104_RESET_STORAGE_REFERENCE_COUNT);
    expect(exact.resetInventory.reduce((total, entry) => total + entry.count, 0)).toBe(114);
    expect(exact.preservedInventory.reduce((total, entry) => total + entry.count, 0)).toBe(215);
    expect(assertSk104ProductionManifest(exact)).toBe(exact);
  });

  it("rejects the old SK-90 row count or any substituted inventory", () => {
    const exact = manifest();
    const oldCount = { ...exact, resetRowCount: 102 } as Sk104ProductionManifest;
    expect(() => assertSk104ProductionManifest(oldCount)).toThrow(
      expect.objectContaining({ code: "SK104_CONTRACT_INVALID" }),
    );

    const substituted = {
      ...exact,
      resetInventory: exact.resetInventory.map((entry, index) =>
        index === 0 ? { ...entry, count: entry.count + 1 } : entry,
      ),
    } as Sk104ProductionManifest;
    expect(() => assertSk104ProductionManifest(substituted)).toThrow(
      expect.objectContaining({ code: "SK104_CONTRACT_INVALID" }),
    );
  });

  it("rejects a manifest digest that no longer matches its content", () => {
    const exact = manifest();
    expect(() =>
      assertSk104ProductionManifest({
        ...exact,
        storageEnumerationFingerprint: sha256Digest("substituted-enumeration"),
      }),
    ).toThrow(expect.objectContaining({ code: "SK104_DIGEST_MISMATCH" }));
  });

  it("accepts only the pinned, distinct canonical and forbidden target fingerprints", () => {
    const substituted = {
      targetClass: "canonical_production" as const,
      approvedDatabaseFingerprint: sha256Digest("substituted-production-database"),
      forbiddenDatabaseFingerprint: SK104_FROZEN_DATABASE_FINGERPRINT,
      approvedStorageFingerprint: sha256Digest("canonical-storage"),
      forbiddenStorageFingerprint: sha256Digest("forbidden-storage"),
    };
    expect(() => sk104ProductionTargetPolicyDigest(substituted)).toThrow(
      expect.objectContaining({ code: "SK104_TARGET_INVALID" }),
    );

    const boundary = {
      targetClass: "canonical_production" as const,
      approvedDatabaseFingerprint: SK104_CANONICAL_DATABASE_FINGERPRINT,
      forbiddenDatabaseFingerprint: SK104_CANONICAL_DATABASE_FINGERPRINT,
      approvedStorageFingerprint: sha256Digest("canonical-storage"),
      forbiddenStorageFingerprint: sha256Digest("forbidden-storage"),
    };
    expect(() => sk104ProductionTargetPolicyDigest(boundary)).toThrow(
      expect.objectContaining({ code: "SK104_TARGET_INVALID" }),
    );
  });

  it("binds one fresh approval to the manifest, targets, restore points, and migrations", () => {
    const exactManifest = manifest();
    const exactApproval = approval(exactManifest);

    expect(
      assertSk104CutoverApproval(exactApproval, exactManifest, "2026-07-22T10:02:00.000Z"),
    ).toBe(exactApproval);
    expect(exactApproval.action).toBe("execute");
  });

  it("requires a separately bound restore action", () => {
    const exactManifest = manifest();
    const executeApproval = approval(exactManifest);
    const restoreApproval = bindSk104CutoverApproval({
      ...executeApproval,
      manifest: exactManifest,
      action: "restore",
      approvalChallengeToken: protectValue(
        "test-only-approval-key-with-at-least-32-bytes",
        "one-time-production-restore-approval",
      ),
    });

    expect(executeApproval.action).toBe("execute");
    expect(restoreApproval.action).toBe("restore");
    expect(restoreApproval.digest).not.toBe(executeApproval.digest);
  });

  it("rejects expired, overlong, or substituted approvals", () => {
    const exactManifest = manifest();
    const exactApproval = approval(exactManifest);
    expect(() =>
      assertSk104CutoverApproval(exactApproval, exactManifest, "2026-07-22T10:05:00.000Z"),
    ).toThrow(expect.objectContaining({ code: "SK104_APPROVAL_EXPIRED" }));

    expect(() =>
      bindSk104CutoverApproval({
        ...exactApproval,
        manifest: exactManifest,
        expiresAt: new Date(
          Date.parse(exactApproval.approvedAt) + MAX_SK104_APPROVAL_TTL_MS + 1,
        ).toISOString(),
      }),
    ).toThrow(expect.objectContaining({ code: "SK104_APPROVAL_INVALID" }));

    expect(() =>
      assertSk104CutoverApproval(
        {
          ...exactApproval,
          databaseRestorePointFingerprint: sha256Digest("substituted-backup"),
        },
        exactManifest,
        "2026-07-22T10:02:00.000Z",
      ),
    ).toThrow(expect.objectContaining({ code: "SK104_DIGEST_MISMATCH" }));
  });
});
