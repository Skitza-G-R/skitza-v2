import { lstat, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

import {
  assertProtectedToken,
  assertSha256Digest,
  canonicalJson,
  protectValue,
  sameDigest,
  sha256Digest,
  type ProtectedToken,
  type Sha256Digest,
} from "./canonical";
import { Sk90ResetSafetyError, stop } from "./errors";
import {
  bindExecutableResetApproval,
  type ExecutableResetApproval,
} from "./execution";
import {
  ensureOwnerOnlyDirectory,
  publishOwnerOnlyUtf8Exclusive,
  readOwnerOnlyUtf8,
} from "./private-envelope";
import {
  FileDurableRunStateStore,
  type DurableRunState,
} from "./durable-state";

const CONSUMPTION_CONTRACT = "sk90-execution-approval-consumption-v2" as const;
const RUN_INSTANCE_CONTRACT = "sk90-execution-run-instance-v1" as const;
const INITIALIZATION_CONTRACT = "sk90-execution-run-state-anchor-v1" as const;

/** Fingerprint the exact canonical owner-only ledger location approved by the operator. */
export function approvalLedgerDirectoryFingerprint(canonicalDirectory: string): Sha256Digest {
  if (
    !isAbsolute(canonicalDirectory) ||
    canonicalDirectory.includes("\0") ||
    resolve(canonicalDirectory) !== canonicalDirectory
  ) {
    stop("EXECUTION_APPROVAL_MISMATCH");
  }
  return sha256Digest(
    canonicalJson({
      contract: "sk90-private-approval-ledger-directory-v1",
      path: canonicalDirectory,
    }),
  );
}

function pathContains(parent: string, candidate: string): boolean {
  const child = relative(parent, candidate);
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

type ApprovalConsumptionBody = Readonly<{
  contract: typeof CONSUMPTION_CONTRACT;
  approvalDigest: Sha256Digest;
  artifactDigest: Sha256Digest;
  manifestDigest: Sha256Digest;
  policyDigest: Sha256Digest;
  targetDatabaseFingerprint: Sha256Digest;
  targetStorageFingerprint: Sha256Digest;
  approvalChallengeToken: ProtectedToken;
  approvalLedgerDirectoryFingerprint: Sha256Digest;
  stateDirectoryFingerprint: Sha256Digest;
  runInstanceMarkerDigest: Sha256Digest;
  consumedAt: string;
}>;

export type ApprovalConsumptionReceipt = ApprovalConsumptionBody &
  Readonly<{
    bindingToken: ProtectedToken;
    receiptDigest: Sha256Digest;
  }>;

type RunInstanceMarkerBody = Readonly<{
  contract: typeof RUN_INSTANCE_CONTRACT;
  approvalDigest: Sha256Digest;
  stateDirectoryFingerprint: Sha256Digest;
  runInstanceToken: ProtectedToken;
  createdAt: string;
}>;

type RunInstanceMarker = RunInstanceMarkerBody &
  Readonly<{
    bindingToken: ProtectedToken;
    markerDigest: Sha256Digest;
  }>;

type RunInitializationBody = Readonly<{
  contract: typeof INITIALIZATION_CONTRACT;
  approvalDigest: Sha256Digest;
  consumptionReceiptDigest: Sha256Digest;
  runInstanceMarkerDigest: Sha256Digest;
  stateRevision: number;
  initialStateDigest: Sha256Digest;
  previousStateDigest: Sha256Digest | null;
  initializedAt: string;
}>;

type RunInitializationReceipt = RunInitializationBody &
  Readonly<{
    bindingToken: ProtectedToken;
    receiptDigest: Sha256Digest;
  }>;

function exactIso(value: string): number {
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString() !== value) {
    stop("EXECUTION_APPROVAL_MISMATCH");
  }
  return epoch;
}

function assertApprovalBinding(
  approval: ExecutableResetApproval,
  approvedDigest: Sha256Digest,
): ExecutableResetApproval {
  assertSha256Digest(approvedDigest);
  const rebound = bindExecutableResetApproval(approval);
  assertSha256Digest(approval.digest);
  if (!sameDigest(rebound.digest, approval.digest) || !sameDigest(approval.digest, approvedDigest)) {
    stop("EXECUTION_APPROVAL_MISMATCH");
  }
  return rebound;
}

function bindReceipt(body: ApprovalConsumptionBody, hmacKey: string): ApprovalConsumptionReceipt {
  if (hmacKey.length < 32) stop("REHEARSAL_ENV_INVALID");
  const contract: unknown = body.contract;
  if (contract !== CONSUMPTION_CONTRACT) stop("EXECUTION_APPROVAL_MISMATCH");
  for (const digest of [
    body.approvalDigest,
    body.artifactDigest,
    body.manifestDigest,
    body.policyDigest,
    body.targetDatabaseFingerprint,
    body.targetStorageFingerprint,
    body.approvalLedgerDirectoryFingerprint,
    body.stateDirectoryFingerprint,
    body.runInstanceMarkerDigest,
  ]) {
    assertSha256Digest(digest);
  }
  assertProtectedToken(body.approvalChallengeToken);
  exactIso(body.consumedAt);
  const canonical = canonicalJson(body);
  return {
    ...body,
    bindingToken: protectValue(hmacKey, `sk90-execution-approval-consumption\0${canonical}`),
    receiptDigest: sha256Digest(canonical),
  };
}

function assertReceipt(
  value: unknown,
  hmacKey: string,
  expected: ApprovalConsumptionBody,
  approval: ExecutableResetApproval,
): ApprovalConsumptionReceipt {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    stop("EXECUTION_APPROVAL_MISMATCH");
  }
  const candidate = value as Partial<ApprovalConsumptionReceipt>;
  if (
    candidate.contract !== CONSUMPTION_CONTRACT ||
    typeof candidate.approvalDigest !== "string" ||
    typeof candidate.artifactDigest !== "string" ||
    typeof candidate.manifestDigest !== "string" ||
    typeof candidate.policyDigest !== "string" ||
    typeof candidate.targetDatabaseFingerprint !== "string" ||
    typeof candidate.targetStorageFingerprint !== "string" ||
    typeof candidate.approvalChallengeToken !== "string" ||
    typeof candidate.approvalLedgerDirectoryFingerprint !== "string" ||
    typeof candidate.stateDirectoryFingerprint !== "string" ||
    typeof candidate.runInstanceMarkerDigest !== "string" ||
    typeof candidate.consumedAt !== "string" ||
    typeof candidate.bindingToken !== "string" ||
    typeof candidate.receiptDigest !== "string"
  ) {
    stop("EXECUTION_APPROVAL_MISMATCH");
  }
  const body: ApprovalConsumptionBody = {
    contract: CONSUMPTION_CONTRACT,
    approvalDigest: candidate.approvalDigest,
    artifactDigest: candidate.artifactDigest,
    manifestDigest: candidate.manifestDigest,
    policyDigest: candidate.policyDigest,
    targetDatabaseFingerprint: candidate.targetDatabaseFingerprint,
    targetStorageFingerprint: candidate.targetStorageFingerprint,
    approvalChallengeToken: candidate.approvalChallengeToken,
    approvalLedgerDirectoryFingerprint: candidate.approvalLedgerDirectoryFingerprint,
    stateDirectoryFingerprint: candidate.stateDirectoryFingerprint,
    runInstanceMarkerDigest: candidate.runInstanceMarkerDigest,
    consumedAt: candidate.consumedAt,
  };
  const rebound = bindReceipt(body, hmacKey);
  assertProtectedToken(candidate.bindingToken);
  assertSha256Digest(candidate.receiptDigest);
  const consumedAt = exactIso(body.consumedAt);
  if (
    !sameDigest(candidate.bindingToken, rebound.bindingToken) ||
    !sameDigest(candidate.receiptDigest, rebound.receiptDigest)
  ) {
    stop("EXECUTION_APPROVAL_MISMATCH");
  }
  const expectedAtOriginalConsumption = { ...expected, consumedAt: body.consumedAt };
  if (canonicalJson(body) !== canonicalJson(expectedAtOriginalConsumption)) {
    const expectedIgnoringDirectory = {
      ...expectedAtOriginalConsumption,
      stateDirectoryFingerprint: body.stateDirectoryFingerprint,
    };
    if (
      canonicalJson(body) === canonicalJson(expectedIgnoringDirectory) &&
      !sameDigest(body.stateDirectoryFingerprint, expected.stateDirectoryFingerprint)
    ) {
      stop("FRESHNESS_NONCE_REUSED");
    }
    stop("EXECUTION_APPROVAL_MISMATCH");
  }
  if (
    consumedAt < Date.parse(approval.approvedAt) ||
    consumedAt >= Date.parse(approval.expiresAt)
  ) {
    stop("EXECUTION_APPROVAL_MISMATCH");
  }
  return rebound;
}

function errno(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (errno(error) === "ENOENT") return false;
    stop("PHASE_STATE_INVALID");
  }
}

async function readReceipt(
  path: string,
  hmacKey: string,
  expected: ApprovalConsumptionBody,
  approval: ExecutableResetApproval,
): Promise<ApprovalConsumptionReceipt> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readOwnerOnlyUtf8(path)) as unknown;
  } catch (error) {
    if (error instanceof Sk90ResetSafetyError) throw error;
    stop("EXECUTION_APPROVAL_MISMATCH");
  }
  return assertReceipt(parsed, hmacKey, expected, approval);
}

function approvalStem(approvalDigest: Sha256Digest): string {
  assertSha256Digest(approvalDigest);
  return `.sk90-execution-${approvalDigest.slice("sha256:".length)}`;
}

function runInstancePath(stateDirectory: string, approvalDigest: Sha256Digest): string {
  return join(stateDirectory, `${approvalStem(approvalDigest)}.run-instance.json`);
}

function consumptionPath(ledgerDirectory: string, approvalDigest: Sha256Digest): string {
  return join(ledgerDirectory, `${approvalStem(approvalDigest)}.consumed.json`);
}

function initializationPath(
  ledgerDirectory: string,
  approvalDigest: Sha256Digest,
  revision: number,
): string {
  return join(
    ledgerDirectory,
    `${approvalStem(approvalDigest)}.state-${revision.toString().padStart(12, "0")}.json`,
  );
}

function bindRunInstanceMarker(
  body: RunInstanceMarkerBody,
  hmacKey: string,
): RunInstanceMarker {
  assertSha256Digest(body.approvalDigest);
  assertSha256Digest(body.stateDirectoryFingerprint);
  assertProtectedToken(body.runInstanceToken);
  exactIso(body.createdAt);
  const bindingToken = protectValue(
    hmacKey,
    `sk90-execution-run-instance\0${canonicalJson(body)}`,
  );
  return {
    ...body,
    bindingToken,
    markerDigest: sha256Digest(canonicalJson({ ...body, bindingToken })),
  };
}

function assertRunInstanceMarker(
  value: unknown,
  hmacKey: string,
  expected: Omit<RunInstanceMarkerBody, "createdAt">,
  approval: ExecutableResetApproval,
): RunInstanceMarker {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    stop("DURABLE_STATE_INVALID");
  }
  const candidate = value as Partial<RunInstanceMarker>;
  if (
    candidate.contract !== RUN_INSTANCE_CONTRACT ||
    typeof candidate.approvalDigest !== "string" ||
    typeof candidate.stateDirectoryFingerprint !== "string" ||
    typeof candidate.runInstanceToken !== "string" ||
    typeof candidate.createdAt !== "string" ||
    typeof candidate.bindingToken !== "string" ||
    typeof candidate.markerDigest !== "string"
  ) {
    stop("DURABLE_STATE_INVALID");
  }
  const rebound = bindRunInstanceMarker(
    {
      contract: RUN_INSTANCE_CONTRACT,
      approvalDigest: candidate.approvalDigest,
      stateDirectoryFingerprint: candidate.stateDirectoryFingerprint,
      runInstanceToken: candidate.runInstanceToken,
      createdAt: candidate.createdAt,
    },
    hmacKey,
  );
  assertProtectedToken(candidate.bindingToken);
  assertSha256Digest(candidate.markerDigest);
  const normalizedCandidate: RunInstanceMarker = {
    contract: candidate.contract,
    approvalDigest: candidate.approvalDigest,
    stateDirectoryFingerprint: candidate.stateDirectoryFingerprint,
    runInstanceToken: candidate.runInstanceToken,
    createdAt: candidate.createdAt,
    bindingToken: candidate.bindingToken,
    markerDigest: candidate.markerDigest,
  };
  if (
    canonicalJson(rebound) !== canonicalJson(normalizedCandidate) ||
    canonicalJson({
      contract: rebound.contract,
      approvalDigest: rebound.approvalDigest,
      stateDirectoryFingerprint: rebound.stateDirectoryFingerprint,
      runInstanceToken: rebound.runInstanceToken,
    }) !== canonicalJson(expected) ||
    !sameDigest(candidate.bindingToken, rebound.bindingToken) ||
    !sameDigest(candidate.markerDigest, rebound.markerDigest)
  ) {
    stop("DURABLE_STATE_INVALID");
  }
  const createdAt = exactIso(rebound.createdAt);
  if (createdAt < Date.parse(approval.approvedAt) || createdAt >= Date.parse(approval.expiresAt)) {
    stop("EXECUTION_APPROVAL_MISMATCH");
  }
  return rebound;
}

async function readRunInstanceMarker(
  path: string,
  hmacKey: string,
  expected: Omit<RunInstanceMarkerBody, "createdAt">,
  approval: ExecutableResetApproval,
): Promise<RunInstanceMarker> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readOwnerOnlyUtf8(path)) as unknown;
  } catch (error) {
    if (error instanceof Sk90ResetSafetyError) throw error;
    stop("DURABLE_STATE_INVALID");
  }
  return assertRunInstanceMarker(parsed, hmacKey, expected, approval);
}

async function ensureRunInstanceMarker(input: Readonly<{
  path: string;
  approval: ExecutableResetApproval;
  stateDirectoryFingerprint: Sha256Digest;
  hmacKey: string;
  createdAt: string;
}>): Promise<RunInstanceMarker> {
  const expected = {
    contract: RUN_INSTANCE_CONTRACT,
    approvalDigest: input.approval.digest,
    stateDirectoryFingerprint: input.stateDirectoryFingerprint,
    runInstanceToken: protectValue(
      input.hmacKey,
      `sk90-run-instance\0${input.approval.digest}\0${input.stateDirectoryFingerprint}\0${input.approval.approvalChallengeToken}`,
    ),
  } as const;
  if (await exists(input.path)) {
    return readRunInstanceMarker(input.path, input.hmacKey, expected, input.approval);
  }
  const marker = bindRunInstanceMarker({ ...expected, createdAt: input.createdAt }, input.hmacKey);
  try {
    await publishOwnerOnlyUtf8Exclusive(input.path, canonicalJson(marker));
    return marker;
  } catch (error) {
    if (!(error instanceof Sk90ResetSafetyError)) stop("DURABLE_STATE_INVALID");
    return readRunInstanceMarker(input.path, input.hmacKey, expected, input.approval);
  }
}

function assertRunState(
  state: DurableRunState,
  approval: ExecutableResetApproval,
  consumption: ApprovalConsumptionReceipt,
): void {
  if (
    !sameDigest(state.bindings.artifactDigest, approval.artifactDigest) ||
    !sameDigest(state.bindings.manifestDigest, approval.manifestDigest) ||
    !sameDigest(state.bindings.executionApprovalDigest, approval.digest) ||
    !sameDigest(state.bindings.runInstanceMarkerDigest, consumption.runInstanceMarkerDigest)
  ) {
    stop("DURABLE_STATE_INVALID");
  }
}

async function readRunState(input: Readonly<{
  stateDirectory: string;
  hmacKey: string;
  approval: ExecutableResetApproval;
  consumption: ApprovalConsumptionReceipt;
}>): Promise<DurableRunState | null> {
  const state = await new FileDurableRunStateStore(
    join(input.stateDirectory, "runner"),
    input.hmacKey,
  ).load();
  if (state === null) return null;
  assertRunState(state, input.approval, input.consumption);
  return state;
}

function bindInitializationReceipt(
  body: RunInitializationBody,
  hmacKey: string,
): RunInitializationReceipt {
  for (const digest of [
    body.approvalDigest,
    body.consumptionReceiptDigest,
    body.runInstanceMarkerDigest,
    body.initialStateDigest,
  ]) {
    assertSha256Digest(digest);
  }
  if (!Number.isSafeInteger(body.stateRevision) || body.stateRevision < 0) {
    stop("DURABLE_STATE_INVALID");
  }
  if (body.previousStateDigest !== null) assertSha256Digest(body.previousStateDigest);
  exactIso(body.initializedAt);
  const bindingToken = protectValue(
    hmacKey,
    `sk90-execution-run-initialization\0${canonicalJson(body)}`,
  );
  return {
    ...body,
    bindingToken,
    receiptDigest: sha256Digest(canonicalJson({ ...body, bindingToken })),
  };
}

function assertStateAnchor(
  value: unknown,
  hmacKey: string,
  approval: ExecutableResetApproval,
  consumption: ApprovalConsumptionReceipt,
): RunInitializationReceipt {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    stop("DURABLE_STATE_INVALID");
  }
  const candidate = value as Partial<RunInitializationReceipt>;
  if (
    candidate.contract !== INITIALIZATION_CONTRACT ||
    typeof candidate.approvalDigest !== "string" ||
    typeof candidate.consumptionReceiptDigest !== "string" ||
    typeof candidate.runInstanceMarkerDigest !== "string" ||
    typeof candidate.stateRevision !== "number" ||
    typeof candidate.initialStateDigest !== "string" ||
    !(candidate.previousStateDigest === null || typeof candidate.previousStateDigest === "string") ||
    typeof candidate.initializedAt !== "string" ||
    typeof candidate.bindingToken !== "string" ||
    typeof candidate.receiptDigest !== "string"
  ) {
    stop("DURABLE_STATE_INVALID");
  }
  const rebound = bindInitializationReceipt(
    {
      contract: INITIALIZATION_CONTRACT,
      approvalDigest: candidate.approvalDigest,
      consumptionReceiptDigest: candidate.consumptionReceiptDigest,
      runInstanceMarkerDigest: candidate.runInstanceMarkerDigest,
      stateRevision: candidate.stateRevision,
      initialStateDigest: candidate.initialStateDigest,
      previousStateDigest: candidate.previousStateDigest,
      initializedAt: candidate.initializedAt,
    },
    hmacKey,
  );
  if (
    canonicalJson(rebound) !== canonicalJson(candidate) ||
    !sameDigest(rebound.approvalDigest, approval.digest) ||
    !sameDigest(rebound.consumptionReceiptDigest, consumption.receiptDigest) ||
    !sameDigest(rebound.runInstanceMarkerDigest, consumption.runInstanceMarkerDigest)
  ) {
    stop("DURABLE_STATE_INVALID");
  }
  return rebound;
}

async function readStateAnchors(input: Readonly<{
  ledgerPath: string;
  hmacKey: string;
  approval: ExecutableResetApproval;
  consumption: ApprovalConsumptionReceipt;
}>): Promise<readonly RunInitializationReceipt[]> {
  const prefix = `${approvalStem(input.approval.digest)}.state-`;
  const revisions = (await readdir(input.ledgerPath))
    .filter((entry) => entry.startsWith(prefix) && entry.endsWith(".json"))
    .map((entry) => entry.slice(prefix.length, -".json".length))
    .filter((entry) => /^[0-9]{12}$/.test(entry))
    .map(Number)
    .sort((left, right) => left - right);
  for (let index = 0; index < revisions.length; index += 1) {
    if (revisions[index] !== index) stop("DURABLE_STATE_INVALID");
  }
  const anchors: RunInitializationReceipt[] = [];
  for (const revision of revisions) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(
        await readOwnerOnlyUtf8(
          initializationPath(input.ledgerPath, input.approval.digest, revision),
        ),
      ) as unknown;
    } catch (error) {
      if (error instanceof Sk90ResetSafetyError) throw error;
      stop("DURABLE_STATE_INVALID");
    }
    const anchor = assertStateAnchor(
      parsed,
      input.hmacKey,
      input.approval,
      input.consumption,
    );
    const previous = anchors.at(-1);
    if (
      anchor.stateRevision !== revision ||
      (previous === undefined
        ? anchor.previousStateDigest !== null
        : anchor.previousStateDigest === null ||
          !sameDigest(anchor.previousStateDigest, previous.initialStateDigest))
    ) {
      stop("DURABLE_STATE_INVALID");
    }
    anchors.push(anchor);
  }
  return anchors;
}

async function publishOrAssertInitialization(input: Readonly<{
  ledgerPath: string;
  hmacKey: string;
  approval: ExecutableResetApproval;
  consumption: ApprovalConsumptionReceipt;
  state: DurableRunState;
}>): Promise<void> {
  assertRunState(input.state, input.approval, input.consumption);
  const anchors = await readStateAnchors(input);
  const latest = anchors.at(-1);
  if (
    latest !== undefined &&
    latest.stateRevision === input.state.revision &&
    sameDigest(latest.initialStateDigest, input.state.stateDigest)
  ) {
    return;
  }
  if (
    latest === undefined
      ? input.state.revision !== 0 || input.state.previousStateDigest !== null
      : input.state.revision !== latest.stateRevision + 1 ||
        input.state.previousStateDigest === null ||
        !sameDigest(input.state.previousStateDigest, latest.initialStateDigest)
  ) {
    stop("DURABLE_STATE_INVALID");
  }
  const expected = bindInitializationReceipt(
    {
      contract: INITIALIZATION_CONTRACT,
      approvalDigest: input.approval.digest,
      consumptionReceiptDigest: input.consumption.receiptDigest,
      runInstanceMarkerDigest: input.consumption.runInstanceMarkerDigest,
      stateRevision: input.state.revision,
      initialStateDigest: input.state.stateDigest,
      previousStateDigest: input.state.previousStateDigest,
      initializedAt: input.consumption.consumedAt,
    },
    input.hmacKey,
  );
  const path = initializationPath(
    input.ledgerPath,
    input.approval.digest,
    input.state.revision,
  );
  try {
    await publishOwnerOnlyUtf8Exclusive(path, canonicalJson(expected));
    return;
  } catch (error) {
    if (!(error instanceof Sk90ResetSafetyError)) stop("DURABLE_STATE_INVALID");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readOwnerOnlyUtf8(path)) as unknown;
  } catch (error) {
    if (error instanceof Sk90ResetSafetyError) throw error;
    stop("DURABLE_STATE_INVALID");
  }
  if (canonicalJson(assertStateAnchor(parsed, input.hmacKey, input.approval, input.consumption)) !== canonicalJson(expected)) {
    stop("DURABLE_STATE_INVALID");
  }
}

async function reconcileInitialization(input: Readonly<{
  ledgerPath: string;
  statePath: string;
  hmacKey: string;
  approval: ExecutableResetApproval;
  consumption: ApprovalConsumptionReceipt;
}>): Promise<void> {
  const state = await readRunState({
    stateDirectory: input.statePath,
    hmacKey: input.hmacKey,
    approval: input.approval,
    consumption: input.consumption,
  });
  const anchors = await readStateAnchors(input);
  if (state === null) {
    if (anchors.length !== 0) stop("DURABLE_STATE_INVALID");
    return;
  }
  await publishOrAssertInitialization({
    ledgerPath: input.ledgerPath,
    hmacKey: input.hmacKey,
    approval: input.approval,
    consumption: input.consumption,
    state,
  });
}

/**
 * Consume one approved execution challenge in its immutable owner-only ledger.
 * The receipt binds the exact state directory without storing or reporting raw
 * paths. A crash may reuse the same receipt only for that same ledger and state;
 * copying the signed bundle cannot create another consumption claim.
 */
export async function consumeExecutableResetApproval(input: Readonly<{
  approval: ExecutableResetApproval;
  approvedDigest: Sha256Digest;
  approvalFilePath: string;
  approvalLedgerDirectory: string;
  stateDirectory: string;
  hmacKey: string;
  now: Date;
}>): Promise<ApprovalConsumptionReceipt> {
  const approval = assertApprovalBinding(input.approval, input.approvedDigest);
  if (input.hmacKey.length < 32) stop("REHEARSAL_ENV_INVALID");

  // The signed bundle may be moved for crash recovery, but it must still cross
  // the owner-only boundary and it can never move the global consumption ledger.
  await readOwnerOnlyUtf8(input.approvalFilePath);
  const sourcePath = await realpath(input.approvalFilePath).catch(() =>
    stop("PHASE_STATE_INVALID"),
  );
  const ledgerPath = await realpath(
    await ensureOwnerOnlyDirectory(input.approvalLedgerDirectory),
  ).catch(() => stop("PHASE_STATE_INVALID"));
  const observedLedgerFingerprint = approvalLedgerDirectoryFingerprint(ledgerPath);
  if (
    !sameDigest(observedLedgerFingerprint, approval.approvalLedgerDirectoryFingerprint)
  ) {
    stop("EXECUTION_APPROVAL_MISMATCH");
  }
  if (pathContains(ledgerPath, sourcePath)) stop("REHEARSAL_ENV_INVALID");
  const statePath = await realpath(
    await ensureOwnerOnlyDirectory(input.stateDirectory, true),
  ).catch(() => stop("PHASE_STATE_INVALID"));
  if (
    pathContains(ledgerPath, statePath) ||
    pathContains(statePath, ledgerPath)
  ) {
    stop("REHEARSAL_ENV_INVALID");
  }
  const stateDirectoryFingerprint = sha256Digest(
    canonicalJson({ contract: "sk90-private-state-directory-v1", path: statePath }),
  );
  const nowEpoch = input.now.getTime();
  if (!Number.isFinite(nowEpoch)) stop("EXECUTION_APPROVAL_MISMATCH");
  const consumedAt = input.now.toISOString();
  const receiptPath = consumptionPath(ledgerPath, approval.digest);
  const markerPath = runInstancePath(statePath, approval.digest);
  const receiptExists = await exists(receiptPath);
  const markerExists = await exists(markerPath);
  if (receiptExists && !markerExists) stop("FRESHNESS_NONCE_REUSED");
  if (
    !receiptExists &&
    !markerExists &&
    (nowEpoch < Date.parse(approval.approvedAt) || nowEpoch >= Date.parse(approval.expiresAt))
  ) {
    stop("EXECUTION_APPROVAL_MISMATCH");
  }
  const marker = await ensureRunInstanceMarker({
    path: markerPath,
    approval,
    stateDirectoryFingerprint,
    hmacKey: input.hmacKey,
    createdAt: consumedAt,
  });
  const body: ApprovalConsumptionBody = {
    contract: CONSUMPTION_CONTRACT,
    approvalDigest: approval.digest,
    artifactDigest: approval.artifactDigest,
    manifestDigest: approval.manifestDigest,
    policyDigest: approval.policyDigest,
    targetDatabaseFingerprint: approval.targetDatabaseFingerprint,
    targetStorageFingerprint: approval.targetStorageFingerprint,
    approvalChallengeToken: approval.approvalChallengeToken,
    approvalLedgerDirectoryFingerprint: observedLedgerFingerprint,
    stateDirectoryFingerprint,
    runInstanceMarkerDigest: marker.markerDigest,
    consumedAt: marker.createdAt,
  };

  if (receiptExists) {
    const receipt = await readReceipt(receiptPath, input.hmacKey, body, approval);
    await reconcileInitialization({
      ledgerPath,
      statePath,
      hmacKey: input.hmacKey,
      approval,
      consumption: receipt,
    });
    return receipt;
  }
  const receipt = bindReceipt(body, input.hmacKey);
  let publishedReceipt = receipt;
  try {
    await publishOwnerOnlyUtf8Exclusive(receiptPath, canonicalJson(receipt));
  } catch (error) {
    // An exact concurrent publisher for the same approval and state directory
    // is safe to join; any different or invalid winner remains a hard stop.
    if (!(error instanceof Sk90ResetSafetyError)) stop("PHASE_STATE_INVALID");
    publishedReceipt = await readReceipt(receiptPath, input.hmacKey, body, approval);
  }
  await reconcileInitialization({
    ledgerPath,
    statePath,
    hmacKey: input.hmacKey,
    approval,
    consumption: publishedReceipt,
  });
  return publishedReceipt;
}

/** Append the exact latest durable state revision to the independent approval ledger. */
export async function recordExecutableResetRunState(input: Readonly<{
  approval: ExecutableResetApproval;
  consumption: ApprovalConsumptionReceipt;
  approvalLedgerDirectory: string;
  stateDirectory: string;
  hmacKey: string;
  state: DurableRunState;
}>): Promise<void> {
  const approval = assertApprovalBinding(input.approval, input.consumption.approvalDigest);
  const ledgerPath = await realpath(
    await ensureOwnerOnlyDirectory(input.approvalLedgerDirectory),
  ).catch(() => stop("DURABLE_STATE_INVALID"));
  const statePath = await realpath(
    await ensureOwnerOnlyDirectory(input.stateDirectory),
  ).catch(() => stop("DURABLE_STATE_INVALID"));
  const ledgerFingerprint = approvalLedgerDirectoryFingerprint(ledgerPath);
  const stateDirectoryFingerprint = sha256Digest(
    canonicalJson({ contract: "sk90-private-state-directory-v1", path: statePath }),
  );
  const marker = await readRunInstanceMarker(
    runInstancePath(statePath, approval.digest),
    input.hmacKey,
    {
      contract: RUN_INSTANCE_CONTRACT,
      approvalDigest: approval.digest,
      stateDirectoryFingerprint,
      runInstanceToken: protectValue(
        input.hmacKey,
        `sk90-run-instance\0${approval.digest}\0${stateDirectoryFingerprint}\0${approval.approvalChallengeToken}`,
      ),
    },
    approval,
  );
  const persistedConsumption = await readReceipt(
    consumptionPath(ledgerPath, approval.digest),
    input.hmacKey,
    {
      contract: CONSUMPTION_CONTRACT,
      approvalDigest: approval.digest,
      artifactDigest: approval.artifactDigest,
      manifestDigest: approval.manifestDigest,
      policyDigest: approval.policyDigest,
      targetDatabaseFingerprint: approval.targetDatabaseFingerprint,
      targetStorageFingerprint: approval.targetStorageFingerprint,
      approvalChallengeToken: approval.approvalChallengeToken,
      approvalLedgerDirectoryFingerprint: ledgerFingerprint,
      stateDirectoryFingerprint,
      runInstanceMarkerDigest: marker.markerDigest,
      consumedAt: input.consumption.consumedAt,
    },
    approval,
  );
  if (!sameDigest(persistedConsumption.receiptDigest, input.consumption.receiptDigest)) {
    stop("DURABLE_STATE_INVALID");
  }
  const persistedState = await readRunState({
    stateDirectory: statePath,
    hmacKey: input.hmacKey,
    approval,
    consumption: persistedConsumption,
  });
  if (
    persistedState === null ||
    persistedState.revision !== input.state.revision ||
    !sameDigest(persistedState.stateDigest, input.state.stateDigest)
  ) {
    stop("DURABLE_STATE_INVALID");
  }
  await publishOrAssertInitialization({
    ledgerPath,
    hmacKey: input.hmacKey,
    approval,
    consumption: persistedConsumption,
    state: persistedState,
  });
}
