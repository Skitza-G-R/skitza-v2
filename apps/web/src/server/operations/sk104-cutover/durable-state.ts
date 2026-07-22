import { lstat, readdir } from "node:fs/promises";
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
import { assertSk104ExecutionContext, type Sk104ExecutionContext } from "./bundle";
import { stopSk104 } from "./environment";

export const SK104_RUN_PHASES = [
  "inspected",
  "backup_prepared",
  "planned",
  "recovery_copies_started",
  "recovery_copies_prepared",
  "database_started",
  "database_committed",
  "storage_delete_started",
  "storage_deleted",
  "verified",
  "restore_storage_started",
  "restore_storage_completed",
  "restore_database_started",
  "restore_database_completed",
  "restore_verified",
] as const;

export type Sk104RunPhase = (typeof SK104_RUN_PHASES)[number];

type StateBody = Readonly<{
  contract: "sk104-durable-state-v1";
  runMarker: ProtectedToken;
  contextDigest: Sha256Digest;
  manifestDigest: Sha256Digest;
  planDigest: Sha256Digest | null;
  restorePlanDigest: Sha256Digest | null;
  phase: Sk104RunPhase;
  revision: number;
  previousStateDigest: Sha256Digest | null;
  activeApprovalDigest: Sha256Digest | null;
  databaseReceiptDigest: Sha256Digest | null;
  storageReceiptDigest: Sha256Digest | null;
  restoreReceiptDigest: Sha256Digest | null;
  updatedAt: string;
}>;

export type Sk104DurableState = StateBody &
  Readonly<{
    bindingToken: ProtectedToken;
    stateDigest: Sha256Digest;
  }>;

type RunMarkerBody = Readonly<{
  contract: "sk104-run-marker-v1";
  runMarker: ProtectedToken;
  contextDigest: Sha256Digest;
  createdAt: string;
}>;

type BoundRunMarker = RunMarkerBody & Readonly<{ bindingToken: ProtectedToken }>;

const PHASE_TRANSITIONS: Readonly<Record<Sk104RunPhase, readonly Sk104RunPhase[]>> = {
  inspected: ["backup_prepared"],
  backup_prepared: ["planned"],
  planned: ["recovery_copies_started", "restore_storage_started"],
  recovery_copies_started: ["recovery_copies_prepared"],
  recovery_copies_prepared: ["database_started", "restore_storage_started"],
  database_started: ["database_committed", "restore_storage_started"],
  database_committed: ["storage_delete_started", "restore_storage_started"],
  storage_delete_started: ["storage_deleted", "restore_storage_started"],
  storage_deleted: ["verified", "restore_storage_started"],
  verified: ["restore_storage_started"],
  restore_storage_started: ["restore_storage_completed"],
  restore_storage_completed: ["restore_database_started"],
  restore_database_started: ["restore_database_completed"],
  restore_database_completed: ["restore_verified"],
  restore_verified: [],
};

function exactIso(value: string): void {
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) {
    stopSk104("SK104_CONTRACT_INVALID");
  }
}

function markerStem(context: Sk104ExecutionContext): string {
  assertProtectedToken(context.runMarker);
  return `.sk104-${context.runMarker.slice("hmac-sha256:".length)}`;
}

function markerPath(directory: string, context: Sk104ExecutionContext): string {
  return join(directory, `${markerStem(context)}.run.json`);
}

function statePath(directory: string, context: Sk104ExecutionContext, revision: number): string {
  if (!Number.isSafeInteger(revision) || revision < 0 || revision > 999_999_999_999) {
    stopSk104("SK104_CONTRACT_INVALID");
  }
  return join(directory, `${markerStem(context)}.state-${String(revision).padStart(12, "0")}.json`);
}

function bindRunMarker(body: RunMarkerBody, hmacKey: string): BoundRunMarker {
  if (hmacKey.length < 32) stopSk104("SK104_CONTRACT_INVALID");
  exactIso(body.createdAt);
  assertProtectedToken(body.runMarker);
  assertSha256Digest(body.contextDigest);
  return {
    ...body,
    bindingToken: protectValue(hmacKey, `sk104-run-marker\0${canonicalJson(body)}`),
  };
}

function bindState(body: StateBody, hmacKey: string): Sk104DurableState {
  if (hmacKey.length < 32) stopSk104("SK104_CONTRACT_INVALID");
  assertProtectedToken(body.runMarker);
  assertSha256Digest(body.contextDigest);
  assertSha256Digest(body.manifestDigest);
  if (body.planDigest !== null) assertSha256Digest(body.planDigest);
  if (body.restorePlanDigest !== null) assertSha256Digest(body.restorePlanDigest);
  if (body.previousStateDigest !== null) assertSha256Digest(body.previousStateDigest);
  if (body.activeApprovalDigest !== null) assertSha256Digest(body.activeApprovalDigest);
  if (body.databaseReceiptDigest !== null) assertSha256Digest(body.databaseReceiptDigest);
  if (body.storageReceiptDigest !== null) assertSha256Digest(body.storageReceiptDigest);
  if (body.restoreReceiptDigest !== null) assertSha256Digest(body.restoreReceiptDigest);
  if (!SK104_RUN_PHASES.includes(body.phase)) stopSk104("SK104_CONTRACT_INVALID");
  if (!Number.isSafeInteger(body.revision) || body.revision < 0) {
    stopSk104("SK104_CONTRACT_INVALID");
  }
  exactIso(body.updatedAt);
  const bindingToken = protectValue(hmacKey, `sk104-durable-state\0${canonicalJson(body)}`);
  return {
    ...body,
    bindingToken,
    stateDigest: sha256Digest(canonicalJson({ ...body, bindingToken })),
  };
}

function stateBody(state: Sk104DurableState): StateBody {
  return {
    contract: state.contract,
    runMarker: state.runMarker,
    contextDigest: state.contextDigest,
    manifestDigest: state.manifestDigest,
    planDigest: state.planDigest,
    restorePlanDigest: state.restorePlanDigest,
    phase: state.phase,
    revision: state.revision,
    previousStateDigest: state.previousStateDigest,
    activeApprovalDigest: state.activeApprovalDigest,
    databaseReceiptDigest: state.databaseReceiptDigest,
    storageReceiptDigest: state.storageReceiptDigest,
    restoreReceiptDigest: state.restoreReceiptDigest,
    updatedAt: state.updatedAt,
  };
}

function parseState(value: string, hmacKey: string): Sk104DurableState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    stopSk104("SK104_CONTRACT_INVALID");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    stopSk104("SK104_CONTRACT_INVALID");
  }
  const candidate = parsed as Sk104DurableState;
  const expected = bindState(stateBody(candidate), hmacKey);
  if (canonicalJson(candidate) !== canonicalJson(expected)) {
    stopSk104("SK104_DIGEST_MISMATCH");
  }
  return expected;
}

async function assertRunMarker(
  directory: string,
  context: Sk104ExecutionContext,
  hmacKey: string,
): Promise<BoundRunMarker> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readOwnerOnlyUtf8(markerPath(directory, context))) as unknown;
  } catch {
    stopSk104("SK104_CONTRACT_INVALID");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    stopSk104("SK104_CONTRACT_INVALID");
  }
  const marker = parsed as BoundRunMarker;
  const expected = bindRunMarker(
    {
      contract: marker.contract,
      runMarker: marker.runMarker,
      contextDigest: marker.contextDigest,
      createdAt: marker.createdAt,
    },
    hmacKey,
  );
  if (
    canonicalJson(marker) !== canonicalJson(expected) ||
    !sameDigest(marker.runMarker, context.runMarker) ||
    !sameDigest(marker.contextDigest, context.digest)
  ) {
    stopSk104("SK104_DIGEST_MISMATCH");
  }
  return expected;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return false;
    }
    stopSk104("SK104_CONTRACT_INVALID");
  }
}

async function revisions(directory: string, context: Sk104ExecutionContext): Promise<number[]> {
  await ensureOwnerOnlyDirectory(directory);
  const prefix = `${markerStem(context)}.state-`;
  const result = (await readdir(directory))
    .filter((name) => name.startsWith(prefix) && name.endsWith(".json"))
    .map((name) => name.slice(prefix.length, -".json".length))
    .map((value) => (/^\d{12}$/.test(value) ? Number(value) : NaN))
    .filter((value) => Number.isSafeInteger(value))
    .sort((left, right) => left - right);
  if (result.length === 0 || result.some((value, index) => value !== index)) {
    stopSk104("SK104_CONTRACT_INVALID");
  }
  return result;
}

export async function initializeSk104DurableState(
  input: Readonly<{
    directory: string;
    context: Sk104ExecutionContext;
    manifestDigest: Sha256Digest;
    hmacKey: string;
    currentTime: string;
  }>,
): Promise<Sk104DurableState> {
  const context = assertSk104ExecutionContext(input.context);
  assertSha256Digest(input.manifestDigest);
  exactIso(input.currentTime);
  await ensureOwnerOnlyDirectory(input.directory, true);
  const markerFile = markerPath(input.directory, context);
  const initialStateFile = statePath(input.directory, context, 0);
  const proposedMarker = bindRunMarker(
    {
      contract: "sk104-run-marker-v1",
      runMarker: context.runMarker,
      contextDigest: context.digest,
      createdAt: input.currentTime,
    },
    input.hmacKey,
  );
  let marker = proposedMarker;
  if (await pathExists(markerFile)) {
    marker = await assertRunMarker(input.directory, context, input.hmacKey);
  } else {
    try {
      await publishOwnerOnlyUtf8Exclusive(markerFile, canonicalJson(proposedMarker));
    } catch {
      // A retry or a second exact runner may have won the immutable marker
      // claim. Only the same authenticated context is allowed to continue.
      marker = await assertRunMarker(input.directory, context, input.hmacKey);
    }
  }

  if (await pathExists(initialStateFile)) {
    const existing = await loadSk104DurableState({
      directory: input.directory,
      context,
      hmacKey: input.hmacKey,
    });
    if (!sameDigest(existing.manifestDigest, input.manifestDigest)) {
      stopSk104("SK104_DIGEST_MISMATCH");
    }
    return existing;
  }

  const initial = bindState(
    {
      contract: "sk104-durable-state-v1",
      runMarker: context.runMarker,
      contextDigest: context.digest,
      manifestDigest: input.manifestDigest,
      planDigest: null,
      restorePlanDigest: null,
      phase: "inspected",
      revision: 0,
      previousStateDigest: null,
      activeApprovalDigest: null,
      databaseReceiptDigest: null,
      storageReceiptDigest: null,
      restoreReceiptDigest: null,
      updatedAt: marker.createdAt,
    },
    input.hmacKey,
  );
  try {
    await publishOwnerOnlyUtf8Exclusive(initialStateFile, canonicalJson(initial));
    return initial;
  } catch {
    const existing = await loadSk104DurableState({
      directory: input.directory,
      context,
      hmacKey: input.hmacKey,
    });
    if (!sameDigest(existing.manifestDigest, input.manifestDigest)) {
      stopSk104("SK104_DIGEST_MISMATCH");
    }
    return existing;
  }
}

export async function loadSk104DurableState(
  input: Readonly<{
    directory: string;
    context: Sk104ExecutionContext;
    hmacKey: string;
  }>,
): Promise<Sk104DurableState> {
  const context = assertSk104ExecutionContext(input.context);
  await assertRunMarker(input.directory, context, input.hmacKey);
  const allRevisions = await revisions(input.directory, context);
  let previous: Sk104DurableState | null = null;
  for (const revision of allRevisions) {
    const state = parseState(
      await readOwnerOnlyUtf8(statePath(input.directory, context, revision)),
      input.hmacKey,
    );
    if (
      state.revision !== revision ||
      !sameDigest(state.runMarker, context.runMarker) ||
      !sameDigest(state.contextDigest, context.digest) ||
      (previous === null
        ? state.previousStateDigest !== null
        : !sameDigest(state.previousStateDigest ?? "", previous.stateDigest))
    ) {
      stopSk104("SK104_DIGEST_MISMATCH");
    }
    previous = state;
  }
  if (previous === null) stopSk104("SK104_CONTRACT_INVALID");
  return previous;
}

export async function transitionSk104DurableState(
  input: Readonly<{
    directory: string;
    context: Sk104ExecutionContext;
    hmacKey: string;
    expectedStateDigest: Sha256Digest;
    nextPhase: Sk104RunPhase;
    currentTime: string;
    planDigest?: Sha256Digest;
    restorePlanDigest?: Sha256Digest;
    activeApprovalDigest?: Sha256Digest | null;
    databaseReceiptDigest?: Sha256Digest;
    storageReceiptDigest?: Sha256Digest;
    restoreReceiptDigest?: Sha256Digest;
  }>,
): Promise<Sk104DurableState> {
  assertSha256Digest(input.expectedStateDigest);
  exactIso(input.currentTime);
  const current = await loadSk104DurableState(input);
  if (
    !sameDigest(current.stateDigest, input.expectedStateDigest) ||
    !PHASE_TRANSITIONS[current.phase].includes(input.nextPhase)
  ) {
    stopSk104("SK104_APPROVAL_INVALID");
  }
  const planDigest = input.planDigest ?? current.planDigest;
  const restorePlanDigest = input.restorePlanDigest ?? current.restorePlanDigest;
  if (planDigest !== null) assertSha256Digest(planDigest);
  if (restorePlanDigest !== null) assertSha256Digest(restorePlanDigest);
  if (input.nextPhase === "planned" && (planDigest === null || restorePlanDigest === null)) {
    stopSk104("SK104_CONTRACT_INVALID");
  }
  if (current.planDigest !== null && !sameDigest(planDigest ?? "", current.planDigest)) {
    stopSk104("SK104_APPROVAL_INVALID");
  }
  if (
    current.restorePlanDigest !== null &&
    !sameDigest(restorePlanDigest ?? "", current.restorePlanDigest)
  ) {
    stopSk104("SK104_APPROVAL_INVALID");
  }
  const next = bindState(
    {
      ...stateBody(current),
      planDigest,
      restorePlanDigest,
      phase: input.nextPhase,
      revision: current.revision + 1,
      previousStateDigest: current.stateDigest,
      activeApprovalDigest:
        input.activeApprovalDigest === undefined
          ? current.activeApprovalDigest
          : input.activeApprovalDigest,
      databaseReceiptDigest: input.databaseReceiptDigest ?? current.databaseReceiptDigest,
      storageReceiptDigest: input.storageReceiptDigest ?? current.storageReceiptDigest,
      restoreReceiptDigest: input.restoreReceiptDigest ?? current.restoreReceiptDigest,
      updatedAt: input.currentTime,
    },
    input.hmacKey,
  );
  await publishOwnerOnlyUtf8Exclusive(
    statePath(input.directory, input.context, next.revision),
    canonicalJson(next),
  );
  return next;
}

/** Record a new short-lived approval without changing the immutable plan or phase. */
export async function reauthorizeSk104DurableState(
  input: Readonly<{
    directory: string;
    context: Sk104ExecutionContext;
    hmacKey: string;
    expectedStateDigest: Sha256Digest;
    approvalDigest: Sha256Digest;
    planDigest: Sha256Digest;
    currentTime: string;
  }>,
): Promise<Sk104DurableState> {
  assertSha256Digest(input.expectedStateDigest);
  assertSha256Digest(input.approvalDigest);
  assertSha256Digest(input.planDigest);
  exactIso(input.currentTime);
  const current = await loadSk104DurableState(input);
  if (
    !sameDigest(current.stateDigest, input.expectedStateDigest) ||
    current.planDigest === null ||
    ![current.planDigest, current.restorePlanDigest].some(
      (digest) => digest !== null && sameDigest(digest, input.planDigest),
    ) ||
    current.phase === "restore_verified"
  ) {
    stopSk104("SK104_APPROVAL_INVALID");
  }
  const next = bindState(
    {
      ...stateBody(current),
      revision: current.revision + 1,
      previousStateDigest: current.stateDigest,
      activeApprovalDigest: input.approvalDigest,
      updatedAt: input.currentTime,
    },
    input.hmacKey,
  );
  await publishOwnerOnlyUtf8Exclusive(
    statePath(input.directory, input.context, next.revision),
    canonicalJson(next),
  );
  return next;
}
