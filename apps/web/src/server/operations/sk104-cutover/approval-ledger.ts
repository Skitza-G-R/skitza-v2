import { join } from "node:path";

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
import {
  ensureOwnerOnlyDirectory,
  publishOwnerOnlyUtf8Exclusive,
  readOwnerOnlyUtf8,
} from "../sk90-reset/private-envelope";
import {
  assertSk104CutoverApproval,
  type Sk104CutoverApproval,
  type Sk104ProductionManifest,
} from "./contract";
import {
  assertSk104ExecutionContextPaths,
  assertSk104ExecutionPlan,
  type Sk104ExecutionContext,
  type Sk104ExecutionPlan,
} from "./bundle";
import { Sk104CutoverSafetyError, stopSk104 } from "./environment";

const CONSUMPTION_CONTRACT = "sk104-cutover-approval-consumption-v1" as const;

type ConsumptionBody = Readonly<{
  contract: typeof CONSUMPTION_CONTRACT;
  action: "execute" | "restore";
  approvalDigest: Sha256Digest;
  manifestDigest: Sha256Digest;
  targetDatabaseFingerprint: Sha256Digest;
  targetStorageFingerprint: Sha256Digest;
  databaseRestorePointFingerprint: Sha256Digest;
  storageRestorePointFingerprint: Sha256Digest;
  migrationBundleDigest: Sha256Digest;
  executionPlanDigest: Sha256Digest;
  executionContextDigest: Sha256Digest;
  approvalChallengeToken: ProtectedToken;
  consumedAt: string;
}>;

export type Sk104ApprovalConsumptionReceipt = ConsumptionBody &
  Readonly<{
    bindingToken: ProtectedToken;
    receiptDigest: Sha256Digest;
  }>;

function receiptPath(directory: string, approvalDigest: Sha256Digest): string {
  assertSha256Digest(approvalDigest);
  return join(directory, `.sk104-${approvalDigest.slice("sha256:".length)}.consumed.json`);
}

function bindReceipt(body: ConsumptionBody, hmacKey: string): Sk104ApprovalConsumptionReceipt {
  if (hmacKey.length < 32) stopSk104("SK104_ENV_INVALID");
  const bindingToken = protectValue(hmacKey, `sk104-approval-consumption\0${canonicalJson(body)}`);
  return {
    ...body,
    bindingToken,
    receiptDigest: sha256Digest(canonicalJson({ ...body, bindingToken })),
  };
}

function bodyFor(
  approval: Sk104CutoverApproval,
  executionPlan: Sk104ExecutionPlan,
  executionContext: Sk104ExecutionContext,
  consumedAt: string,
): ConsumptionBody {
  return {
    contract: CONSUMPTION_CONTRACT,
    action: approval.action,
    approvalDigest: approval.digest,
    manifestDigest: approval.manifestDigest,
    targetDatabaseFingerprint: approval.targetDatabaseFingerprint,
    targetStorageFingerprint: approval.targetStorageFingerprint,
    databaseRestorePointFingerprint: approval.databaseRestorePointFingerprint,
    storageRestorePointFingerprint: approval.storageRestorePointFingerprint,
    migrationBundleDigest: approval.migrationBundleDigest,
    executionPlanDigest: executionPlan.digest,
    executionContextDigest: executionContext.digest,
    approvalChallengeToken: approval.approvalChallengeToken,
    consumedAt,
  };
}

function assertReceipt(
  value: unknown,
  approval: Sk104CutoverApproval,
  manifest: Sk104ProductionManifest,
  executionPlan: Sk104ExecutionPlan,
  executionContext: Sk104ExecutionContext,
  hmacKey: string,
): Sk104ApprovalConsumptionReceipt {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    stopSk104("SK104_APPROVAL_INVALID");
  }
  const candidate = value as Partial<Sk104ApprovalConsumptionReceipt>;
  if (
    candidate.contract !== CONSUMPTION_CONTRACT ||
    (candidate.action !== "execute" && candidate.action !== "restore") ||
    typeof candidate.approvalDigest !== "string" ||
    typeof candidate.manifestDigest !== "string" ||
    typeof candidate.targetDatabaseFingerprint !== "string" ||
    typeof candidate.targetStorageFingerprint !== "string" ||
    typeof candidate.databaseRestorePointFingerprint !== "string" ||
    typeof candidate.storageRestorePointFingerprint !== "string" ||
    typeof candidate.migrationBundleDigest !== "string" ||
    typeof candidate.executionPlanDigest !== "string" ||
    typeof candidate.executionContextDigest !== "string" ||
    typeof candidate.approvalChallengeToken !== "string" ||
    typeof candidate.consumedAt !== "string" ||
    typeof candidate.bindingToken !== "string" ||
    typeof candidate.receiptDigest !== "string"
  ) {
    stopSk104("SK104_APPROVAL_INVALID");
  }
  assertSha256Digest(candidate.approvalDigest);
  assertSha256Digest(candidate.manifestDigest);
  assertSha256Digest(candidate.targetDatabaseFingerprint);
  assertSha256Digest(candidate.targetStorageFingerprint);
  assertSha256Digest(candidate.databaseRestorePointFingerprint);
  assertSha256Digest(candidate.storageRestorePointFingerprint);
  assertSha256Digest(candidate.migrationBundleDigest);
  assertSha256Digest(candidate.executionPlanDigest);
  assertSha256Digest(candidate.executionContextDigest);
  assertProtectedToken(candidate.approvalChallengeToken);
  assertProtectedToken(candidate.bindingToken);
  assertSha256Digest(candidate.receiptDigest);

  assertSk104CutoverApproval(approval, manifest, candidate.consumedAt);
  assertSk104ExecutionPlan(executionPlan, manifest, executionContext);
  const expected = bindReceipt(
    bodyFor(approval, executionPlan, executionContext, candidate.consumedAt),
    hmacKey,
  );
  if (
    canonicalJson(candidate) !== canonicalJson(expected) ||
    !sameDigest(candidate.bindingToken, expected.bindingToken) ||
    !sameDigest(candidate.receiptDigest, expected.receiptDigest)
  ) {
    stopSk104("SK104_APPROVAL_INVALID");
  }
  return expected;
}

export async function consumeSk104CutoverApproval(
  input: Readonly<{
    approval: Sk104CutoverApproval;
    manifest: Sk104ProductionManifest;
    executionPlan: Sk104ExecutionPlan;
    executionContext: Sk104ExecutionContext;
    approvedExecutionDigest: Sha256Digest;
    expectedAction: "execute" | "restore";
    ledgerDirectory: string;
    stateDirectory: string;
    approvalFile: string;
    releaseCommit: string;
    hmacKey: string;
    currentTime: string;
  }>,
): Promise<Sk104ApprovalConsumptionReceipt> {
  assertSk104CutoverApproval(input.approval, input.manifest, input.currentTime);
  assertSk104ExecutionPlan(input.executionPlan, input.manifest, input.executionContext);
  assertSk104ExecutionContextPaths({
    context: input.executionContext,
    stateDirectory: input.stateDirectory,
    approvalLedgerDirectory: input.ledgerDirectory,
    approvalFile: input.approvalFile,
    releaseCommit: input.releaseCommit,
    hmacKey: input.hmacKey,
  });
  assertSha256Digest(input.approvedExecutionDigest);
  if (
    input.approval.action !== input.expectedAction ||
    !sameDigest(input.approval.digest, input.approvedExecutionDigest) ||
    !sameDigest(input.approval.executionPlanDigest, input.executionPlan.digest)
  ) {
    stopSk104("SK104_APPROVAL_INVALID");
  }
  await ensureOwnerOnlyDirectory(input.ledgerDirectory, true);
  const receipt = bindReceipt(
    bodyFor(input.approval, input.executionPlan, input.executionContext, input.currentTime),
    input.hmacKey,
  );
  try {
    await publishOwnerOnlyUtf8Exclusive(
      receiptPath(input.ledgerDirectory, input.approval.digest),
      canonicalJson(receipt),
    );
  } catch (error) {
    if (error instanceof Sk104CutoverSafetyError) throw error;
    stopSk104("SK104_APPROVAL_INVALID");
  }
  return receipt;
}

export async function readConsumedSk104CutoverApproval(
  input: Readonly<{
    approval: Sk104CutoverApproval;
    manifest: Sk104ProductionManifest;
    executionPlan: Sk104ExecutionPlan;
    executionContext: Sk104ExecutionContext;
    approvedExecutionDigest: Sha256Digest;
    expectedAction: "execute" | "restore";
    ledgerDirectory: string;
    stateDirectory: string;
    approvalFile: string;
    releaseCommit: string;
    hmacKey: string;
  }>,
): Promise<Sk104ApprovalConsumptionReceipt> {
  assertSha256Digest(input.approvedExecutionDigest);
  assertSk104ExecutionPlan(input.executionPlan, input.manifest, input.executionContext);
  assertSk104ExecutionContextPaths({
    context: input.executionContext,
    stateDirectory: input.stateDirectory,
    approvalLedgerDirectory: input.ledgerDirectory,
    approvalFile: input.approvalFile,
    releaseCommit: input.releaseCommit,
    hmacKey: input.hmacKey,
  });
  if (
    input.approval.action !== input.expectedAction ||
    !sameDigest(input.approval.digest, input.approvedExecutionDigest) ||
    !sameDigest(input.approval.executionPlanDigest, input.executionPlan.digest)
  ) {
    stopSk104("SK104_APPROVAL_INVALID");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      await readOwnerOnlyUtf8(receiptPath(input.ledgerDirectory, input.approval.digest)),
    ) as unknown;
  } catch {
    stopSk104("SK104_APPROVAL_INVALID");
  }
  return assertReceipt(
    parsed,
    input.approval,
    input.manifest,
    input.executionPlan,
    input.executionContext,
    input.hmacKey,
  );
}
