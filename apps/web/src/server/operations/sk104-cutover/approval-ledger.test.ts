import { chmod, mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { protectValue, sha256Digest } from "../sk90-reset/canonical";
import { buildSk104ExecutionContext, buildSk104ExecutionPlan } from "./bundle";
import {
  bindSk104CutoverApproval,
  bindSk104ProductionTarget,
  buildSk104ProductionManifest,
  sk104ProductionTargetPolicyDigest,
} from "./contract";
import { consumeSk104CutoverApproval, readConsumedSk104CutoverApproval } from "./approval-ledger";
import {
  SK104_CANONICAL_DATABASE_FINGERPRINT,
  SK104_FROZEN_DATABASE_FINGERPRINT,
} from "./target-observer";

const HMAC_KEY = "sk104-approval-ledger-test-key-long-enough";

function fixture(paths: Readonly<{ ledger: string; state: string; approvalFile: string }>) {
  const boundary = {
    targetClass: "canonical_production" as const,
    approvedDatabaseFingerprint: SK104_CANONICAL_DATABASE_FINGERPRINT,
    forbiddenDatabaseFingerprint: SK104_FROZEN_DATABASE_FINGERPRINT,
    approvedStorageFingerprint: sha256Digest("approved-storage"),
    forbiddenStorageFingerprint: sha256Digest("forbidden-storage"),
  };
  const target = bindSk104ProductionTarget(boundary, sk104ProductionTargetPolicyDigest(boundary));
  const manifest = buildSk104ProductionManifest({
    target,
    sourceSchemaFingerprint: sha256Digest("source"),
    targetSchemaFingerprint: sha256Digest("target"),
    resetRowsFingerprint: sha256Digest("rows"),
    preservedRowCountsFingerprint: sha256Digest("counts"),
    preservedBusinessFingerprint: sha256Digest("business"),
    storageReferencesFingerprint: sha256Digest("refs"),
    storageEnumerationFingerprint: sha256Digest("objects"),
    mockEvidenceFingerprint: sha256Digest("mock"),
  });
  const releaseCommit = "a".repeat(40);
  const executionContext = buildSk104ExecutionContext({
    runNonce: "r".repeat(32),
    stateDirectory: paths.state,
    approvalLedgerDirectory: paths.ledger,
    approvalFile: paths.approvalFile,
    releaseCommit,
    hmacKey: HMAC_KEY,
  });
  const migrationBundleDigest = sha256Digest("migration-bundle");
  const executionPlan = buildSk104ExecutionPlan({
    action: "execute",
    manifest,
    context: executionContext,
    databaseRestorePointFingerprint: sha256Digest("database-backup"),
    storageRestorePointFingerprint: sha256Digest("storage-backup"),
    migrationBundleDigest,
  });
  const approval = bindSk104CutoverApproval({
    manifest,
    action: "execute",
    manifestDigest: manifest.digest,
    targetDatabaseFingerprint: target.approvedDatabaseFingerprint,
    targetStorageFingerprint: target.approvedStorageFingerprint,
    targetPolicyDigest: target.policyDigest,
    databaseRestorePointFingerprint: sha256Digest("database-backup"),
    storageRestorePointFingerprint: sha256Digest("storage-backup"),
    migrationBundleDigest,
    executionPlanDigest: executionPlan.digest,
    approvalChallengeToken: protectValue(HMAC_KEY, "challenge"),
    approvedAt: "2026-07-22T10:00:00.000Z",
    expiresAt: "2026-07-22T10:05:00.000Z",
  });
  return { approval, executionContext, executionPlan, manifest, releaseCommit };
}

async function privatePaths() {
  const root = await mkdtemp(join(tmpdir(), "sk104-ledger-"));
  await chmod(root, 0o700);
  const ledger = join(root, "ledger");
  await mkdir(ledger, { mode: 0o700 });
  return {
    ledger,
    state: join(root, "state"),
    approvalFile: join(root, "approval.json"),
  };
}

describe("SK-104 approval consumption", () => {
  it("consumes one exact execution approval and permits only exact resume", async () => {
    const paths = await privatePaths();
    const { approval, executionContext, executionPlan, manifest, releaseCommit } = fixture(paths);
    const common = {
      approval,
      manifest,
      executionPlan,
      executionContext,
      approvedExecutionDigest: approval.digest,
      ledgerDirectory: paths.ledger,
      stateDirectory: paths.state,
      approvalFile: paths.approvalFile,
      releaseCommit,
      hmacKey: HMAC_KEY,
    };
    const receipt = await consumeSk104CutoverApproval({
      ...common,
      expectedAction: "execute",
      currentTime: "2026-07-22T10:01:00.000Z",
    });
    expect(receipt.action).toBe("execute");
    await expect(
      readConsumedSk104CutoverApproval({
        ...common,
        expectedAction: "execute",
      }),
    ).resolves.toEqual(receipt);
    await expect(
      consumeSk104CutoverApproval({
        ...common,
        expectedAction: "execute",
        currentTime: "2026-07-22T10:02:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "SK104_APPROVAL_INVALID" });
  });

  it("rejects a restore action under the execution approval", async () => {
    const paths = await privatePaths();
    const { approval, executionContext, executionPlan, manifest, releaseCommit } = fixture(paths);
    await expect(
      consumeSk104CutoverApproval({
        approval,
        manifest,
        executionPlan,
        executionContext,
        approvedExecutionDigest: approval.digest,
        expectedAction: "restore",
        ledgerDirectory: paths.ledger,
        stateDirectory: paths.state,
        approvalFile: paths.approvalFile,
        releaseCommit,
        hmacKey: HMAC_KEY,
        currentTime: "2026-07-22T10:01:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "SK104_APPROVAL_INVALID" });
  });
});
