import { resolve } from "node:path";

import {
  assertProtectedToken,
  assertSha256Digest,
  canonicalJson,
  protectValue,
  sameDigest,
  sha256Digest,
  type ProtectedToken,
  type Sha256Digest,
} from "../sk90-reset/canonical";
import type { PrivateExecutionEnvelope } from "../sk90-reset/private-envelope";
import type { Sk104DatabaseBackupReceipt } from "./backup";
import {
  assertSk104CutoverApproval,
  assertSk104ProductionManifest,
  type Sk104CutoverApproval,
  type Sk104ProductionManifest,
} from "./contract";
import type { Sk104PrivateProductionDatabaseManifest } from "./database";
import { stopSk104 } from "./environment";
import type { Sk104StorageRestorePointReceipt } from "./storage";

export const SK104_EXECUTION_ORDER = [
  "verify_approval",
  "verify_database_backup",
  "acquire_exclusive_run_lease",
  "prepare_storage_recovery",
  "database_cutover",
  "delete_reset_storage",
  "verify_final_state",
] as const;

export const SK104_RESTORE_ORDER = [
  "verify_approval",
  "verify_database_backup",
  "acquire_exclusive_run_lease",
  "restore_reset_storage",
  "restore_database",
  "verify_restored_state",
] as const;

export type Sk104ExecutionContextBody = Readonly<{
  contract: "sk104-execution-context-v1";
  runMarker: ProtectedToken;
  stateDirectoryBinding: ProtectedToken;
  approvalLedgerDirectoryBinding: ProtectedToken;
  approvalFileBinding: ProtectedToken;
  releaseCommitDigest: Sha256Digest;
}>;

export type Sk104ExecutionContext = Sk104ExecutionContextBody & Readonly<{ digest: Sha256Digest }>;

export type Sk104ExecutionPlanBody = Readonly<{
  contract: "sk104-production-execution-plan-v1";
  action: "execute" | "restore";
  manifestDigest: Sha256Digest;
  targetPolicyDigest: Sha256Digest;
  targetDatabaseFingerprint: Sha256Digest;
  targetStorageFingerprint: Sha256Digest;
  databaseRestorePointFingerprint: Sha256Digest;
  storageRestorePointFingerprint: Sha256Digest;
  migrationBundleDigest: Sha256Digest;
  executionContextDigest: Sha256Digest;
  releaseCommitDigest: Sha256Digest;
  resetRowCount: 114;
  resetStorageObjectCount: 9;
  noWriterGateRequired: true;
  executionOrder: typeof SK104_EXECUTION_ORDER | typeof SK104_RESTORE_ORDER;
}>;

export type Sk104ExecutionPlan = Sk104ExecutionPlanBody & Readonly<{ digest: Sha256Digest }>;

type StagedBundleBody = Readonly<{
  contract: "sk104-private-staged-bundle-v1";
  context: Sk104ExecutionContext;
  manifest: Sk104ProductionManifest;
  privateDatabaseManifest: Sk104PrivateProductionDatabaseManifest;
  privateStorageEnvelope: PrivateExecutionEnvelope;
  databaseBackup: Sk104DatabaseBackupReceipt | null;
  storageRestorePoint: Sk104StorageRestorePointReceipt;
  executionPlan: Sk104ExecutionPlan | null;
  restorePlan: Sk104ExecutionPlan | null;
  approvals: readonly Sk104CutoverApproval[];
  activeApprovalDigest: Sha256Digest | null;
}>;

export type Sk104PrivateStagedBundle = StagedBundleBody &
  Readonly<{ bindingToken: ProtectedToken }>;

function exactAbsolutePath(value: string): string {
  if (typeof value !== "string" || value.includes("\0") || resolve(value) !== value) {
    stopSk104("SK104_CONTRACT_INVALID");
  }
  return value;
}

function contextBody(context: Sk104ExecutionContextBody): Sk104ExecutionContextBody {
  return {
    contract: context.contract,
    runMarker: context.runMarker,
    stateDirectoryBinding: context.stateDirectoryBinding,
    approvalLedgerDirectoryBinding: context.approvalLedgerDirectoryBinding,
    approvalFileBinding: context.approvalFileBinding,
    releaseCommitDigest: context.releaseCommitDigest,
  };
}

export function buildSk104ExecutionContext(
  input: Readonly<{
    runNonce: string;
    stateDirectory: string;
    approvalLedgerDirectory: string;
    approvalFile: string;
    releaseCommit: string;
    hmacKey: string;
  }>,
): Sk104ExecutionContext {
  if (
    input.hmacKey.length < 32 ||
    input.runNonce.length < 32 ||
    input.runNonce.includes("\0") ||
    !/^[0-9a-f]{40}$/.test(input.releaseCommit)
  ) {
    stopSk104("SK104_CONTRACT_INVALID");
  }
  const stateDirectory = exactAbsolutePath(input.stateDirectory);
  const approvalLedgerDirectory = exactAbsolutePath(input.approvalLedgerDirectory);
  const approvalFile = exactAbsolutePath(input.approvalFile);
  const body: Sk104ExecutionContextBody = {
    contract: "sk104-execution-context-v1",
    runMarker: protectValue(input.hmacKey, `sk104-run\0${input.runNonce}`),
    stateDirectoryBinding: protectValue(input.hmacKey, `sk104-state-root\0${stateDirectory}`),
    approvalLedgerDirectoryBinding: protectValue(
      input.hmacKey,
      `sk104-approval-ledger-root\0${approvalLedgerDirectory}`,
    ),
    approvalFileBinding: protectValue(input.hmacKey, `sk104-approval-file\0${approvalFile}`),
    releaseCommitDigest: sha256Digest(input.releaseCommit),
  };
  return { ...body, digest: sha256Digest(canonicalJson(body)) };
}

export function assertSk104ExecutionContext(context: Sk104ExecutionContext): Sk104ExecutionContext {
  const untrustedContract: unknown = context.contract;
  if (untrustedContract !== "sk104-execution-context-v1") {
    stopSk104("SK104_CONTRACT_INVALID");
  }
  assertProtectedToken(context.runMarker);
  assertProtectedToken(context.stateDirectoryBinding);
  assertProtectedToken(context.approvalLedgerDirectoryBinding);
  assertProtectedToken(context.approvalFileBinding);
  assertSha256Digest(context.releaseCommitDigest);
  assertSha256Digest(context.digest);
  if (!sameDigest(context.digest, sha256Digest(canonicalJson(contextBody(context))))) {
    stopSk104("SK104_DIGEST_MISMATCH");
  }
  return context;
}

export function assertSk104ExecutionContextPaths(
  input: Readonly<{
    context: Sk104ExecutionContext;
    stateDirectory: string;
    approvalLedgerDirectory: string;
    approvalFile: string;
    releaseCommit: string;
    hmacKey: string;
  }>,
): void {
  const expected = buildSk104ExecutionContext({
    runNonce: "x".repeat(32),
    stateDirectory: input.stateDirectory,
    approvalLedgerDirectory: input.approvalLedgerDirectory,
    approvalFile: input.approvalFile,
    releaseCommit: input.releaseCommit,
    hmacKey: input.hmacKey,
  });
  const context = assertSk104ExecutionContext(input.context);
  if (
    !sameDigest(context.stateDirectoryBinding, expected.stateDirectoryBinding) ||
    !sameDigest(context.approvalLedgerDirectoryBinding, expected.approvalLedgerDirectoryBinding) ||
    !sameDigest(context.approvalFileBinding, expected.approvalFileBinding) ||
    !sameDigest(context.releaseCommitDigest, expected.releaseCommitDigest)
  ) {
    stopSk104("SK104_APPROVAL_INVALID");
  }
}

export function buildSk104ExecutionPlan(
  input: Readonly<{
    action: "execute" | "restore";
    manifest: Sk104ProductionManifest;
    context: Sk104ExecutionContext;
    databaseRestorePointFingerprint: Sha256Digest;
    storageRestorePointFingerprint: Sha256Digest;
    migrationBundleDigest: Sha256Digest;
  }>,
): Sk104ExecutionPlan {
  const manifest = assertSk104ProductionManifest(input.manifest);
  const context = assertSk104ExecutionContext(input.context);
  assertSha256Digest(input.databaseRestorePointFingerprint);
  assertSha256Digest(input.storageRestorePointFingerprint);
  assertSha256Digest(input.migrationBundleDigest);
  const body: Sk104ExecutionPlanBody = {
    contract: "sk104-production-execution-plan-v1",
    action: input.action,
    manifestDigest: manifest.digest,
    targetPolicyDigest: manifest.target.policyDigest,
    targetDatabaseFingerprint: manifest.target.approvedDatabaseFingerprint,
    targetStorageFingerprint: manifest.target.approvedStorageFingerprint,
    databaseRestorePointFingerprint: input.databaseRestorePointFingerprint,
    storageRestorePointFingerprint: input.storageRestorePointFingerprint,
    migrationBundleDigest: input.migrationBundleDigest,
    executionContextDigest: context.digest,
    releaseCommitDigest: context.releaseCommitDigest,
    resetRowCount: 114,
    resetStorageObjectCount: 9,
    noWriterGateRequired: true,
    executionOrder: input.action === "execute" ? SK104_EXECUTION_ORDER : SK104_RESTORE_ORDER,
  };
  return { ...body, digest: sha256Digest(canonicalJson(body)) };
}

export function assertSk104ExecutionPlan(
  plan: Sk104ExecutionPlan,
  manifest: Sk104ProductionManifest,
  context: Sk104ExecutionContext,
): Sk104ExecutionPlan {
  const expected = buildSk104ExecutionPlan({
    action: plan.action,
    manifest,
    context,
    databaseRestorePointFingerprint: plan.databaseRestorePointFingerprint,
    storageRestorePointFingerprint: plan.storageRestorePointFingerprint,
    migrationBundleDigest: plan.migrationBundleDigest,
  });
  if (canonicalJson(plan) !== canonicalJson(expected)) {
    stopSk104("SK104_DIGEST_MISMATCH");
  }
  return expected;
}

function stagedBody(bundle: StagedBundleBody): StagedBundleBody {
  return {
    contract: bundle.contract,
    context: bundle.context,
    manifest: bundle.manifest,
    privateDatabaseManifest: bundle.privateDatabaseManifest,
    privateStorageEnvelope: bundle.privateStorageEnvelope,
    databaseBackup: bundle.databaseBackup,
    storageRestorePoint: bundle.storageRestorePoint,
    executionPlan: bundle.executionPlan,
    restorePlan: bundle.restorePlan,
    approvals: bundle.approvals,
    activeApprovalDigest: bundle.activeApprovalDigest,
  };
}

export function bindSk104PrivateStagedBundle(
  input: Omit<StagedBundleBody, "contract">,
  hmacKey: string,
): Sk104PrivateStagedBundle {
  if (hmacKey.length < 32) stopSk104("SK104_CONTRACT_INVALID");
  const body: StagedBundleBody = {
    contract: "sk104-private-staged-bundle-v1",
    context: input.context,
    manifest: input.manifest,
    privateDatabaseManifest: input.privateDatabaseManifest,
    privateStorageEnvelope: input.privateStorageEnvelope,
    databaseBackup: input.databaseBackup,
    storageRestorePoint: input.storageRestorePoint,
    executionPlan: input.executionPlan,
    restorePlan: input.restorePlan,
    approvals: input.approvals,
    activeApprovalDigest: input.activeApprovalDigest,
  };
  assertSk104ExecutionContext(body.context);
  assertSk104ProductionManifest(body.manifest);
  if (body.executionPlan !== null) {
    assertSk104ExecutionPlan(body.executionPlan, body.manifest, body.context);
  }
  if (body.restorePlan !== null) {
    assertSk104ExecutionPlan(body.restorePlan, body.manifest, body.context);
    if (body.restorePlan.action !== "restore") stopSk104("SK104_CONTRACT_INVALID");
  }
  const approvalDigests = new Set<string>();
  for (const approval of body.approvals) {
    assertSk104CutoverApproval(approval, body.manifest, approval.approvedAt);
    if (
      approvalDigests.has(approval.digest) ||
      ![body.executionPlan?.digest, body.restorePlan?.digest].some(
        (digest) => digest !== undefined && sameDigest(approval.executionPlanDigest, digest),
      )
    ) {
      stopSk104("SK104_APPROVAL_INVALID");
    }
    approvalDigests.add(approval.digest);
  }
  if (
    body.activeApprovalDigest !== null &&
    !body.approvals.some((approval) => sameDigest(approval.digest, body.activeApprovalDigest ?? ""))
  ) {
    stopSk104("SK104_APPROVAL_INVALID");
  }
  return {
    ...body,
    bindingToken: protectValue(hmacKey, `sk104-private-staged-bundle\0${canonicalJson(body)}`),
  };
}

export function assertSk104PrivateStagedBundle(
  bundle: Sk104PrivateStagedBundle,
  hmacKey: string,
): Sk104PrivateStagedBundle {
  const untrustedContract: unknown = bundle.contract;
  if (untrustedContract !== "sk104-private-staged-bundle-v1") {
    stopSk104("SK104_CONTRACT_INVALID");
  }
  assertProtectedToken(bundle.bindingToken);
  const expected = bindSk104PrivateStagedBundle(stagedBody(bundle), hmacKey);
  if (canonicalJson(bundle) !== canonicalJson(expected)) {
    stopSk104("SK104_DIGEST_MISMATCH");
  }
  return expected;
}
