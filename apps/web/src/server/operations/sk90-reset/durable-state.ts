import { readdir } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

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
import { stop } from "./errors";
import {
  ensureOwnerOnlyDirectory,
  publishOwnerOnlyUtf8Exclusive,
  readOwnerOnlyUtf8,
} from "./private-envelope";

export const REQUIRED_ROLLBACK_POINTS = [
  "before_database_commit",
  "after_database_commit_before_storage_delete",
  "after_partial_storage_delete",
] as const;

export type RequiredRollbackPoint = (typeof REQUIRED_ROLLBACK_POINTS)[number];
type SingleStageRollbackPoint = Exclude<
  RequiredRollbackPoint,
  "after_partial_storage_delete"
>;

export type RunPurpose =
  | Readonly<{ kind: "rollback"; point: RequiredRollbackPoint }>
  | Readonly<{ kind: "final" }>;

export type DurableRunPhase =
  | "prepared"
  | "quarantine_started"
  | "objects_quarantined"
  | "rollback_scenario_started"
  | "rollback_partial_database_committed"
  | "rollback_partial_storage_delete_started"
  | "rollback_started"
  | "database_reset_started"
  | "database_committed"
  | "storage_delete_started"
  | "storage_deleted"
  | "verification_started"
  | "first_verified"
  | "restore_started"
  | "restore_verification_started"
  | "restored"
  | "second_run_started"
  | "verified";

export type DurableAction =
  | "prepare"
  | "database_reset"
  | "storage_delete"
  | "post_reset_verify"
  | "second_run"
  | "manual_restore"
  | "manual_restore_verify"
  | "reconcile_quarantine"
  | "reconcile_database_commit"
  | "reconcile_storage_delete"
  | "reconcile_post_reset"
  | "reconcile_restore"
  | "reconcile_second_run"
  | "reconcile_rollback_interruption"
  | `quarantine:rollback:${RequiredRollbackPoint}`
  | `rollback_interrupt:${SingleStageRollbackPoint}`
  | "rollback_interrupt_database:after_partial_storage_delete"
  | "rollback_interrupt_storage:after_partial_storage_delete"
  | `rollback_restore:${RequiredRollbackPoint}`
  | `rollback_verify:${RequiredRollbackPoint}`
  | "quarantine:final";

export type MutationCounters = Readonly<{
  databaseRows: number;
  storageCopies: number;
  storageDeletes: number;
}>;

export const ZERO_MUTATIONS: MutationCounters = Object.freeze({
  databaseRows: 0,
  storageCopies: 0,
  storageDeletes: 0,
});

export type DurableRunBindings = Readonly<{
  artifactDigest: Sha256Digest;
  manifestDigest: Sha256Digest;
  targetPolicyDigest: Sha256Digest;
  targetDatabaseFingerprint: Sha256Digest;
  targetStorageFingerprint: Sha256Digest;
  approvedTargetObservationDigest: Sha256Digest;
  executionApprovalDigest: Sha256Digest;
  migrationDigest: Sha256Digest;
  privateEnvelopeDigest: Sha256Digest;
  resetPlanDigest: Sha256Digest;
  evidenceObservationDigest: Sha256Digest;
  databaseRestorePointFingerprint: Sha256Digest;
  storageRestorePointFingerprint: Sha256Digest;
  preStorageNamespaceFingerprint: Sha256Digest;
  postStorageNamespaceFingerprint: Sha256Digest;
  runInstanceMarkerDigest: Sha256Digest;
}>;

export type DurableOperationReceipt = Readonly<{
  action: DurableAction;
  artifactDigest: Sha256Digest;
  targetObservationDigest: Sha256Digest;
  challengeToken: ProtectedToken | null;
  issuedAt: string | null;
  expiresAt: string | null;
  receiptDigest: Sha256Digest;
  mutations: MutationCounters;
  postStateFingerprint: Sha256Digest | null;
}>;

export type DurableNonceEntry = Readonly<{
  challengeToken: ProtectedToken;
  action: DurableAction;
  artifactDigest: Sha256Digest;
  targetObservationDigest: Sha256Digest;
  issuedAt: string;
  expiresAt: string;
  consumedAt: string | null;
}>;

type DurableRunStateBody = Readonly<{
  contract: "sk90-durable-run-state-v1";
  revision: number;
  previousStateDigest: Sha256Digest | null;
  bindings: DurableRunBindings;
  phase: DurableRunPhase;
  activePurpose: RunPurpose | null;
  completedRollbackPoints: readonly RequiredRollbackPoint[];
  receipts: readonly DurableOperationReceipt[];
  nonceLedger: readonly DurableNonceEntry[];
  mutationTotals: MutationCounters;
}>;

export type DurableRunState = DurableRunStateBody &
  Readonly<{
    bindingToken: ProtectedToken;
    stateDigest: Sha256Digest;
  }>;

export type InitialDurableRunState = Readonly<{
  bindings: DurableRunBindings;
  prepareReceipt: DurableOperationReceipt;
}>;

export type DurableStateValues = Readonly<{
  phase: DurableRunPhase;
  activePurpose: RunPurpose | null;
  completedRollbackPoints: readonly RequiredRollbackPoint[];
  receipts: readonly DurableOperationReceipt[];
  nonceLedger: readonly DurableNonceEntry[];
  mutationTotals: MutationCounters;
}>;

export interface DurableRunStateStore {
  load(): Promise<DurableRunState | null>;
  initialize(input: InitialDurableRunState): Promise<DurableRunState>;
  transition(
    expected: DurableRunState,
    mutate: (current: DurableStateValues) => DurableStateValues,
  ): Promise<DurableRunState>;
}

const DURABLE_PHASES = new Set<DurableRunPhase>([
  "prepared",
  "quarantine_started",
  "objects_quarantined",
  "rollback_scenario_started",
  "rollback_partial_database_committed",
  "rollback_partial_storage_delete_started",
  "rollback_started",
  "database_reset_started",
  "database_committed",
  "storage_delete_started",
  "storage_deleted",
  "verification_started",
  "first_verified",
  "restore_started",
  "restore_verification_started",
  "restored",
  "second_run_started",
  "verified",
]);

const STATIC_ACTIONS = new Set<DurableAction>([
  "prepare",
  "database_reset",
  "storage_delete",
  "post_reset_verify",
  "second_run",
  "manual_restore",
  "manual_restore_verify",
  "reconcile_quarantine",
  "reconcile_database_commit",
  "reconcile_storage_delete",
  "reconcile_post_reset",
  "reconcile_restore",
  "reconcile_second_run",
  "reconcile_rollback_interruption",
  "quarantine:final",
  "rollback_interrupt_database:after_partial_storage_delete",
  "rollback_interrupt_storage:after_partial_storage_delete",
  ...REQUIRED_ROLLBACK_POINTS.flatMap((point) => [
    `quarantine:rollback:${point}` as const,
    `rollback_restore:${point}` as const,
    `rollback_verify:${point}` as const,
  ]),
  "rollback_interrupt:before_database_commit",
  "rollback_interrupt:after_database_commit_before_storage_delete",
]);

const ALLOWED_NEXT_PHASES: Readonly<Record<DurableRunPhase, readonly DurableRunPhase[]>> = {
  prepared: ["quarantine_started", "restore_started"],
  quarantine_started: ["objects_quarantined", "restore_started"],
  objects_quarantined: ["rollback_scenario_started", "database_reset_started", "restore_started"],
  rollback_scenario_started: [
    "objects_quarantined",
    "rollback_partial_database_committed",
    "rollback_started",
    "restore_started",
  ],
  rollback_partial_database_committed: [
    "rollback_partial_storage_delete_started",
    "restore_started",
  ],
  rollback_partial_storage_delete_started: ["rollback_started", "restore_started"],
  rollback_started: ["restore_started"],
  database_reset_started: ["database_committed", "restore_started"],
  database_committed: ["storage_delete_started", "restore_started"],
  storage_delete_started: ["storage_deleted", "restore_started"],
  storage_deleted: ["verification_started", "restore_started"],
  verification_started: ["first_verified", "restore_started"],
  first_verified: ["second_run_started", "restore_started"],
  restore_started: ["restore_verification_started", "restored"],
  restore_verification_started: ["restored", "restore_started"],
  restored: ["quarantine_started", "restore_started"],
  second_run_started: ["verified", "restore_started"],
  verified: ["restore_started"],
};

function assertNonnegativeInteger(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) stop("PHASE_STATE_INVALID");
}

function assertMutationCounters(counters: MutationCounters): void {
  assertNonnegativeInteger(counters.databaseRows);
  assertNonnegativeInteger(counters.storageCopies);
  assertNonnegativeInteger(counters.storageDeletes);
}

export function addMutationCounters(
  left: MutationCounters,
  right: MutationCounters,
): MutationCounters {
  assertMutationCounters(left);
  assertMutationCounters(right);
  const result = {
    databaseRows: left.databaseRows + right.databaseRows,
    storageCopies: left.storageCopies + right.storageCopies,
    storageDeletes: left.storageDeletes + right.storageDeletes,
  };
  assertMutationCounters(result);
  return result;
}

export function hasZeroMutations(counters: MutationCounters): boolean {
  assertMutationCounters(counters);
  return (
    counters.databaseRows === 0 && counters.storageCopies === 0 && counters.storageDeletes === 0
  );
}

function isRollbackPoint(value: unknown): value is RequiredRollbackPoint {
  return (
    typeof value === "string" && (REQUIRED_ROLLBACK_POINTS as readonly string[]).includes(value)
  );
}

function assertAction(value: unknown): asserts value is DurableAction {
  if (typeof value !== "string" || !STATIC_ACTIONS.has(value as DurableAction)) {
    stop("PHASE_STATE_INVALID");
  }
}

function assertPurpose(value: RunPurpose | null): void {
  if (value === null) return;
  if (value.kind === "final") return;
  if (!isRollbackPoint(value.point)) stop("PHASE_STATE_INVALID");
}

function isoEpoch(value: string): number {
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString() !== value) {
    stop("PHASE_STATE_INVALID");
  }
  return epoch;
}

function assertReceipt(receipt: DurableOperationReceipt): void {
  assertAction(receipt.action);
  assertSha256Digest(receipt.artifactDigest);
  assertSha256Digest(receipt.targetObservationDigest);
  if (receipt.challengeToken === null) {
    if (receipt.action !== "prepare" || receipt.issuedAt !== null || receipt.expiresAt !== null) {
      stop("PHASE_STATE_INVALID");
    }
  } else {
    assertProtectedToken(receipt.challengeToken);
    if (receipt.issuedAt === null || receipt.expiresAt === null) stop("PHASE_STATE_INVALID");
    if (isoEpoch(receipt.expiresAt) <= isoEpoch(receipt.issuedAt)) stop("PHASE_STATE_INVALID");
  }
  assertSha256Digest(receipt.receiptDigest);
  assertMutationCounters(receipt.mutations);
  if (receipt.postStateFingerprint !== null) {
    assertSha256Digest(receipt.postStateFingerprint);
  }
}

function assertNonce(nonce: DurableNonceEntry): void {
  assertProtectedToken(nonce.challengeToken);
  assertAction(nonce.action);
  assertSha256Digest(nonce.artifactDigest);
  assertSha256Digest(nonce.targetObservationDigest);
  const issued = isoEpoch(nonce.issuedAt);
  const expires = isoEpoch(nonce.expiresAt);
  if (expires <= issued) stop("PHASE_STATE_INVALID");
  if (nonce.consumedAt !== null) {
    const consumed = isoEpoch(nonce.consumedAt);
    if (consumed < issued || consumed >= expires) stop("PHASE_STATE_INVALID");
  }
}

function normalizedBody(body: DurableRunStateBody): DurableRunStateBody {
  assertNonnegativeInteger(body.revision);
  if (body.previousStateDigest !== null) assertSha256Digest(body.previousStateDigest);
  for (const digest of Object.values(body.bindings)) assertSha256Digest(digest);
  if (!DURABLE_PHASES.has(body.phase)) stop("PHASE_STATE_INVALID");
  assertPurpose(body.activePurpose);
  const completed = new Set<RequiredRollbackPoint>();
  for (const point of body.completedRollbackPoints) {
    if (!isRollbackPoint(point) || completed.has(point)) stop("PHASE_STATE_INVALID");
    completed.add(point);
  }
  const completedRollbackPoints = REQUIRED_ROLLBACK_POINTS.filter((point) => completed.has(point));

  const challenges = new Set<string>();
  const nonceLedger = body.nonceLedger.map((nonce) => {
    assertNonce(nonce);
    if (
      challenges.has(nonce.challengeToken) ||
      !sameDigest(nonce.artifactDigest, body.bindings.artifactDigest)
    ) {
      stop("PHASE_STATE_INVALID");
    }
    challenges.add(nonce.challengeToken);
    return { ...nonce };
  });
  const receipts = body.receipts.map((receipt) => {
    assertReceipt(receipt);
    if (!sameDigest(receipt.artifactDigest, body.bindings.artifactDigest)) {
      stop("PHASE_STATE_INVALID");
    }
    return { ...receipt, mutations: { ...receipt.mutations } };
  });
  assertMutationCounters(body.mutationTotals);

  return {
    contract: "sk90-durable-run-state-v1",
    revision: body.revision,
    previousStateDigest: body.previousStateDigest,
    bindings: { ...body.bindings },
    phase: body.phase,
    activePurpose: body.activePurpose === null ? null : { ...body.activePurpose },
    completedRollbackPoints,
    receipts,
    nonceLedger,
    mutationTotals: { ...body.mutationTotals },
  };
}

function bindBody(body: DurableRunStateBody, hmacKey: string): DurableRunState {
  const normalized = normalizedBody(body);
  const bindingToken = protectValue(
    hmacKey,
    `sk90-durable-run-state\0${canonicalJson(normalized)}`,
  );
  return {
    ...normalized,
    bindingToken,
    stateDigest: sha256Digest(canonicalJson({ ...normalized, bindingToken })),
  };
}

export function assertDurableRunState(value: unknown, hmacKey: string): DurableRunState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    stop("PHASE_STATE_INVALID");
  }
  const candidate = value as Record<string, unknown>;
  if (
    candidate.contract !== "sk90-durable-run-state-v1" ||
    typeof candidate.revision !== "number" ||
    !("previousStateDigest" in candidate) ||
    typeof candidate.bindings !== "object" ||
    candidate.bindings === null ||
    typeof candidate.phase !== "string" ||
    !("activePurpose" in candidate) ||
    !Array.isArray(candidate.completedRollbackPoints) ||
    !Array.isArray(candidate.receipts) ||
    !Array.isArray(candidate.nonceLedger) ||
    typeof candidate.mutationTotals !== "object" ||
    candidate.mutationTotals === null ||
    typeof candidate.bindingToken !== "string" ||
    typeof candidate.stateDigest !== "string"
  ) {
    stop("PHASE_STATE_INVALID");
  }
  const body = normalizedBody(candidate as DurableRunStateBody);
  assertProtectedToken(candidate.bindingToken);
  assertSha256Digest(candidate.stateDigest);
  const rebound = bindBody(body, hmacKey);
  if (
    !sameDigest(candidate.bindingToken, rebound.bindingToken) ||
    !sameDigest(candidate.stateDigest, rebound.stateDigest)
  ) {
    stop("PHASE_STATE_INVALID");
  }
  return rebound;
}

export function durableStateValues(state: DurableRunState): DurableStateValues {
  return {
    phase: state.phase,
    activePurpose: state.activePurpose,
    completedRollbackPoints: state.completedRollbackPoints,
    receipts: state.receipts,
    nonceLedger: state.nonceLedger,
    mutationTotals: state.mutationTotals,
  };
}

function assertTransition(previous: DurableRunState, next: DurableStateValues): void {
  if (previous.phase !== next.phase && !ALLOWED_NEXT_PHASES[previous.phase].includes(next.phase)) {
    stop("PHASE_STATE_INVALID");
  }
}

function nextState(
  previous: DurableRunState,
  values: DurableStateValues,
  hmacKey: string,
): DurableRunState {
  assertTransition(previous, values);
  return bindBody(
    {
      contract: "sk90-durable-run-state-v1",
      revision: previous.revision + 1,
      previousStateDigest: previous.stateDigest,
      bindings: previous.bindings,
      ...values,
    },
    hmacKey,
  );
}

function initialState(input: InitialDurableRunState, hmacKey: string): DurableRunState {
  assertReceipt(input.prepareReceipt);
  if (!hasZeroMutations(input.prepareReceipt.mutations)) stop("PHASE_STATE_INVALID");
  for (const digest of Object.values(input.bindings)) assertSha256Digest(digest);
  return bindBody(
    {
      contract: "sk90-durable-run-state-v1",
      revision: 0,
      previousStateDigest: null,
      bindings: { ...input.bindings },
      phase: "prepared",
      activePurpose: null,
      completedRollbackPoints: [],
      receipts: [input.prepareReceipt],
      nonceLedger: [],
      mutationTotals: { ...ZERO_MUTATIONS },
    },
    hmacKey,
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function revisionPath(basePath: string, revision: number): string {
  return `${basePath}.revision-${revision.toString().padStart(12, "0")}.json`;
}

export class FileDurableRunStateStore implements DurableRunStateStore {
  readonly #basePath: string;
  readonly #hmacKey: string;
  readonly #onPublishedState: ((state: DurableRunState) => Promise<void>) | undefined;

  constructor(
    basePath: string,
    hmacKey: string,
    onPublishedState?: (state: DurableRunState) => Promise<void>,
  ) {
    if (hmacKey.length < 32) stop("PHASE_STATE_INVALID");
    this.#basePath = resolve(basePath);
    this.#hmacKey = hmacKey;
    this.#onPublishedState = onPublishedState;
  }

  async load(): Promise<DurableRunState | null> {
    const directory = await ensureOwnerOnlyDirectory(dirname(this.#basePath), true);
    const pattern = new RegExp(
      `^${escapeRegExp(basename(this.#basePath))}\\.revision-([0-9]{12})\\.json$`,
    );
    const entries = await readdir(directory);
    const revisions = entries
      .map((entry) => pattern.exec(entry)?.[1])
      .filter((entry): entry is string => entry !== undefined)
      .map((entry) => Number(entry))
      .sort((left, right) => left - right);
    if (revisions.length === 0) return null;
    for (let index = 0; index < revisions.length; index += 1) {
      if (revisions[index] !== index) stop("PHASE_STATE_INVALID");
    }

    let previous: DurableRunState | null = null;
    for (const revision of revisions) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(
          await readOwnerOnlyUtf8(revisionPath(this.#basePath, revision)),
        ) as unknown;
      } catch {
        stop("PHASE_STATE_INVALID");
      }
      const current = assertDurableRunState(parsed, this.#hmacKey);
      if (
        current.revision !== revision ||
        (previous === null
          ? current.previousStateDigest !== null
          : current.previousStateDigest === null ||
            !sameDigest(current.previousStateDigest, previous.stateDigest))
      ) {
        stop("PHASE_STATE_INVALID");
      }
      previous = current;
    }
    return previous;
  }

  async initialize(input: InitialDurableRunState): Promise<DurableRunState> {
    if ((await this.load()) !== null) stop("PHASE_STATE_INVALID");
    const state = initialState(input, this.#hmacKey);
    await publishOwnerOnlyUtf8Exclusive(
      revisionPath(this.#basePath, state.revision),
      canonicalJson(state),
    );
    await this.#onPublishedState?.(state);
    return state;
  }

  async transition(
    expected: DurableRunState,
    mutate: (current: DurableStateValues) => DurableStateValues,
  ): Promise<DurableRunState> {
    const current = await this.load();
    if (
      current === null ||
      current.revision !== expected.revision ||
      !sameDigest(current.stateDigest, expected.stateDigest)
    ) {
      stop("PHASE_STATE_INVALID");
    }
    const next = nextState(current, mutate(durableStateValues(current)), this.#hmacKey);
    await publishOwnerOnlyUtf8Exclusive(
      revisionPath(this.#basePath, next.revision),
      canonicalJson(next),
    );
    await this.#onPublishedState?.(next);
    return next;
  }
}

export const MAX_DURABLE_NONCE_TTL_MS = 5 * 60 * 1000;

export type IssueDurableNonceInput = Readonly<{
  challengeToken: ProtectedToken;
  action: DurableAction;
  artifactDigest: Sha256Digest;
  targetObservationDigest: Sha256Digest;
  issuedAt: string;
  expiresAt: string;
}>;

export async function issueDurableNonce(
  store: DurableRunStateStore,
  state: DurableRunState,
  input: IssueDurableNonceInput,
): Promise<DurableRunState> {
  assertProtectedToken(input.challengeToken);
  assertAction(input.action);
  assertSha256Digest(input.artifactDigest);
  assertSha256Digest(input.targetObservationDigest);
  const issued = isoEpoch(input.issuedAt);
  const expires = isoEpoch(input.expiresAt);
  if (
    expires <= issued ||
    expires - issued > MAX_DURABLE_NONCE_TTL_MS ||
    !sameDigest(input.artifactDigest, state.bindings.artifactDigest)
  ) {
    stop("FRESHNESS_PROOF_INVALID");
  }
  if (state.nonceLedger.some((entry) => sameDigest(entry.challengeToken, input.challengeToken))) {
    stop("FRESHNESS_NONCE_REUSED");
  }
  return store.transition(state, (current) => ({
    ...current,
    nonceLedger: [
      ...current.nonceLedger,
      {
        ...input,
        consumedAt: null,
      },
    ],
  }));
}

export type ConsumeDurableNonceInput = Readonly<{
  challengeToken: ProtectedToken;
  action: DurableAction;
  artifactDigest: Sha256Digest;
  targetObservationDigest: Sha256Digest;
  consumedAt: string;
}>;

export async function consumeDurableNonce(
  store: DurableRunStateStore,
  state: DurableRunState,
  input: ConsumeDurableNonceInput,
): Promise<DurableRunState> {
  assertProtectedToken(input.challengeToken);
  assertAction(input.action);
  assertSha256Digest(input.artifactDigest);
  assertSha256Digest(input.targetObservationDigest);
  const consumed = isoEpoch(input.consumedAt);
  const index = state.nonceLedger.findIndex((entry) =>
    sameDigest(entry.challengeToken, input.challengeToken),
  );
  const entry = state.nonceLedger[index];
  if (entry && entry.consumedAt !== null) stop("FRESHNESS_NONCE_REUSED");
  if (
    !entry ||
    entry.action !== input.action ||
    !sameDigest(entry.artifactDigest, input.artifactDigest) ||
    !sameDigest(entry.targetObservationDigest, input.targetObservationDigest) ||
    consumed < isoEpoch(entry.issuedAt) ||
    consumed >= isoEpoch(entry.expiresAt)
  ) {
    stop("FRESHNESS_PROOF_INVALID");
  }
  return store.transition(state, (current) => ({
    ...current,
    nonceLedger: current.nonceLedger.map((candidate, candidateIndex) =>
      candidateIndex === index ? { ...candidate, consumedAt: input.consumedAt } : candidate,
    ),
  }));
}

/** Digest an exact, already-consumed durable nonce entry for external proof binding. */
export function consumedDurableNonceDigest(
  state: DurableRunState,
  challengeToken: ProtectedToken,
): Sha256Digest {
  assertProtectedToken(challengeToken);
  const entry = state.nonceLedger.find((candidate) =>
    sameDigest(candidate.challengeToken, challengeToken),
  );
  if (!entry || entry.consumedAt === null) stop("FRESHNESS_PROOF_INVALID");
  return sha256Digest(canonicalJson(entry));
}

export function quarantineAction(purpose: RunPurpose): DurableAction {
  return purpose.kind === "final" ? "quarantine:final" : `quarantine:rollback:${purpose.point}`;
}

export type RecoveryObservation =
  | "pre"
  | "quarantined"
  | "database_committed"
  | "storage_deleted"
  | "post_verified"
  | "restored"
  | "mixed";

export type RecoveryDecision =
  | "continue"
  | "complete"
  | "retry_operation"
  | "reconcile_completed_operation"
  | "restore"
  | "retry_restore"
  | "verify_restore";

/** Pure fail-closed restart matrix used before any resumed external action. */
export function recoveryDecision(
  phase: DurableRunPhase,
  observed: RecoveryObservation,
): RecoveryDecision {
  switch (phase) {
    case "prepared":
    case "objects_quarantined":
    case "rollback_started":
    case "rollback_partial_database_committed":
    case "database_committed":
    case "storage_deleted":
    case "first_verified":
      return observed === "mixed" ? "restore" : "continue";
    case "restored":
      return observed === "restored" || observed === "pre" ? "continue" : "restore";
    case "verified":
      return observed === "post_verified" ? "complete" : "restore";
    case "quarantine_started":
      if (observed === "pre") return "retry_operation";
      if (observed === "quarantined") return "reconcile_completed_operation";
      return "restore";
    case "database_reset_started":
      if (observed === "pre" || observed === "quarantined") return "retry_operation";
      if (observed === "database_committed") return "reconcile_completed_operation";
      if (observed === "mixed") stop("DATABASE_VERIFICATION_MISMATCH");
      return "restore";
    case "storage_delete_started":
      if (observed === "database_committed") return "retry_operation";
      if (observed === "storage_deleted") return "reconcile_completed_operation";
      return "restore";
    case "verification_started":
      if (observed === "storage_deleted") return "retry_operation";
      if (observed === "post_verified") return "reconcile_completed_operation";
      return "restore";
    case "rollback_scenario_started":
    case "rollback_partial_storage_delete_started":
      return "restore";
    case "restore_started":
      return observed === "restored" ? "verify_restore" : "retry_restore";
    case "restore_verification_started":
      return observed === "restored" ? "verify_restore" : "retry_restore";
    case "second_run_started":
      return observed === "post_verified" ? "retry_operation" : "restore";
  }
}

export function receiptForAction(
  state: DurableRunState,
  action: DurableAction,
): DurableOperationReceipt | undefined {
  return [...state.receipts].reverse().find((receipt) => receipt.action === action);
}
