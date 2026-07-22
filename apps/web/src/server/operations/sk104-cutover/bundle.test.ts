import { describe, expect, it } from "vitest";

import { sha256Digest } from "../sk90-reset/canonical";
import {
  buildSk104ExecutionContext,
  buildSk104ExecutionPlan,
  assertSk104ExecutionContextPaths,
} from "./bundle";
import {
  bindSk104ProductionTarget,
  buildSk104ProductionManifest,
  sk104ProductionTargetPolicyDigest,
} from "./contract";
import {
  SK104_CANONICAL_DATABASE_FINGERPRINT,
  SK104_FROZEN_DATABASE_FINGERPRINT,
} from "./target-observer";

const HMAC_KEY = "sk104-bundle-test-hmac-key-longer-than-thirty-two";

function manifest() {
  const boundary = {
    targetClass: "canonical_production" as const,
    approvedDatabaseFingerprint: SK104_CANONICAL_DATABASE_FINGERPRINT,
    forbiddenDatabaseFingerprint: SK104_FROZEN_DATABASE_FINGERPRINT,
    approvedStorageFingerprint: sha256Digest("storage"),
    forbiddenStorageFingerprint: sha256Digest("frozen-storage"),
  };
  return buildSk104ProductionManifest({
    target: bindSk104ProductionTarget(boundary, sk104ProductionTargetPolicyDigest(boundary)),
    sourceSchemaFingerprint: sha256Digest("source"),
    targetSchemaFingerprint: sha256Digest("target"),
    resetRowsFingerprint: sha256Digest("rows"),
    preservedRowCountsFingerprint: sha256Digest("counts"),
    preservedBusinessFingerprint: sha256Digest("business"),
    storageReferencesFingerprint: sha256Digest("refs"),
    storageEnumerationFingerprint: sha256Digest("objects"),
    mockEvidenceFingerprint: sha256Digest("mock"),
  });
}

function context() {
  return buildSk104ExecutionContext({
    runNonce: "r".repeat(32),
    stateDirectory: "/private/tmp/sk104-state",
    approvalLedgerDirectory: "/private/tmp/sk104-ledger",
    approvalFile: "/private/tmp/sk104-approval.json",
    releaseCommit: "a".repeat(40),
    hmacKey: HMAC_KEY,
  });
}

describe("SK-104 execution bundle", () => {
  it("binds roots, run, commit, target, backups, and exact operation order", () => {
    const activeManifest = manifest();
    const activeContext = context();
    const plan = buildSk104ExecutionPlan({
      action: "execute",
      manifest: activeManifest,
      context: activeContext,
      databaseRestorePointFingerprint: sha256Digest("database-backup"),
      storageRestorePointFingerprint: sha256Digest("storage-backup"),
      migrationBundleDigest: sha256Digest("migrations"),
    });
    expect(plan.resetRowCount).toBe(114);
    expect(plan.resetStorageObjectCount).toBe(9);
    expect(plan.noWriterGateRequired).toBe(true);
    expect(plan.executionOrder).toEqual([
      "verify_approval",
      "verify_database_backup",
      "acquire_exclusive_run_lease",
      "prepare_storage_recovery",
      "database_cutover",
      "delete_reset_storage",
      "verify_final_state",
    ]);

    const restorePlan = buildSk104ExecutionPlan({
      action: "restore",
      manifest: activeManifest,
      context: activeContext,
      databaseRestorePointFingerprint: sha256Digest("database-backup"),
      storageRestorePointFingerprint: sha256Digest("storage-backup"),
      migrationBundleDigest: sha256Digest("migrations"),
    });
    expect(restorePlan.executionOrder).toEqual([
      "verify_approval",
      "verify_database_backup",
      "acquire_exclusive_run_lease",
      "restore_reset_storage",
      "restore_database",
      "verify_restored_state",
    ]);
  });

  it("rejects moving one approval to different private roots", () => {
    expect(() => {
      assertSk104ExecutionContextPaths({
        context: context(),
        stateDirectory: "/private/tmp/other-state",
        approvalLedgerDirectory: "/private/tmp/sk104-ledger",
        approvalFile: "/private/tmp/sk104-approval.json",
        releaseCommit: "a".repeat(40),
        hmacKey: HMAC_KEY,
      });
    }).toThrow(expect.objectContaining({ code: "SK104_APPROVAL_INVALID" }));
  });
});
