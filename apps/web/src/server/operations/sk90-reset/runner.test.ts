import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { protectValue, sha256Digest } from "./canonical";
import {
  FileDurableRunStateStore,
  REQUIRED_ROLLBACK_POINTS,
  ZERO_MUTATIONS,
  type DurableAction,
  type DurableOperationReceipt,
  type DurableRunPhase,
  type MutationCounters,
  type RequiredRollbackPoint,
  type RunPurpose,
} from "./durable-state";
import {
  Sk90RehearsalRunner,
  targetActionFor,
  type AuthorizedActionContext,
  type PreparedRunnerMaterial,
  type ReconciliationResult,
  type RehearsalRunnerPorts,
  type SafeRunnerEvent,
} from "./runner";
import { Sk90ResetSafetyError } from "./errors";

const HMAC_KEY = "runner-test-hmac-key-that-is-longer-than-32-bytes";
const ARTIFACT = sha256Digest("artifact");
const MANIFEST = sha256Digest("manifest");
const POLICY = sha256Digest("policy");
const TARGET = sha256Digest("target");
const DATABASE_TARGET = sha256Digest("database-target");
const STORAGE_TARGET = sha256Digest("storage-target");
const EXECUTION = sha256Digest("execution");
const MIGRATION = sha256Digest("migration");
const ENVELOPE = sha256Digest("envelope");
const PLAN = sha256Digest("plan");
const EVIDENCE = sha256Digest("evidence");
const DATABASE_RESTORE = sha256Digest("database-restore");
const STORAGE_RESTORE = sha256Digest("storage-restore");
const STORAGE_PRE = sha256Digest("storage-pre");
const STORAGE_POST = sha256Digest("storage-post");
const POST_STATE = sha256Digest("post-state");
const RESTORED_STATE = sha256Digest("restored-state");
const directories: string[] = [];

async function store(): Promise<FileDurableRunStateStore> {
  const directory = await mkdtemp(join(tmpdir(), "sk90-runner-"));
  directories.push(directory);
  return new FileDurableRunStateStore(join(directory, "journal"), HMAC_KEY);
}

function receipt(
  context: AuthorizedActionContext,
  label: string,
  mutations: MutationCounters = ZERO_MUTATIONS,
  postStateFingerprint: ReturnType<typeof sha256Digest> | null = null,
): DurableOperationReceipt {
  return {
    action: context.action,
    artifactDigest: context.artifactDigest,
    targetObservationDigest: context.targetObservationDigest,
    challengeToken: context.challengeToken,
    issuedAt: context.issuedAt,
    expiresAt: context.expiresAt,
    receiptDigest: sha256Digest(label),
    mutations,
    postStateFingerprint,
  };
}

class FakePorts implements RehearsalRunnerPorts {
  readonly operations: string[] = [];
  readonly challenges: string[] = [];
  challengeIndex = 0;
  crashBeforeDatabaseMutation = false;
  crashAfterDatabaseCommit = false;
  crashAfterRollbackDatabaseCommit = false;
  crashAfterRollbackPartialDatabaseCommit = false;
  crashAfterRollbackPartialStorageDelete = false;
  crashAfterQuarantine = false;
  crashAfterPartialStorageDelete = false;
  crashAfterPostVerification = false;
  crashAfterRestore = false;
  crashAfterSecondRun = false;
  quarantineCompleted = false;
  databaseCommitted = false;
  mixedDatabaseObservation = false;
  partialStorageDeleted = false;
  storageDeleted = false;
  postVerified = false;
  restored = false;
  secondRunCompleted = false;
  secondRunMutations: MutationCounters = ZERO_MUTATIONS;
  backupValid = true;
  expireDuringRecoveryCheck = false;
  databaseMutationCalls = 0;
  storageDeleteCalls = 0;

  recordState(): Promise<void> {
    return Promise.resolve();
  }

  prepare(): Promise<PreparedRunnerMaterial> {
    this.operations.push("prepare");
    return Promise.resolve({
      bindings: {
        artifactDigest: ARTIFACT,
        manifestDigest: MANIFEST,
        targetPolicyDigest: POLICY,
        targetDatabaseFingerprint: DATABASE_TARGET,
        targetStorageFingerprint: STORAGE_TARGET,
        approvedTargetObservationDigest: TARGET,
        executionApprovalDigest: EXECUTION,
        migrationDigest: MIGRATION,
        privateEnvelopeDigest: ENVELOPE,
        resetPlanDigest: PLAN,
        evidenceObservationDigest: EVIDENCE,
        databaseRestorePointFingerprint: DATABASE_RESTORE,
        storageRestorePointFingerprint: STORAGE_RESTORE,
        preStorageNamespaceFingerprint: STORAGE_PRE,
        postStorageNamespaceFingerprint: STORAGE_POST,
        runInstanceMarkerDigest: sha256Digest("run-instance"),
      },
      receipt: {
        action: "prepare",
        artifactDigest: ARTIFACT,
        targetObservationDigest: TARGET,
        challengeToken: null,
        issuedAt: null,
        expiresAt: null,
        receiptDigest: sha256Digest("prepare"),
        mutations: ZERO_MUTATIONS,
        postStateFingerprint: null,
      },
    });
  }

  observeTarget(input: { action: DurableAction }) {
    this.operations.push(`observe:${input.action}`);
    return Promise.resolve(TARGET);
  }

  freshChallenge(action: DurableAction) {
    this.challengeIndex += 1;
    const challenge = protectValue(
      HMAC_KEY,
      `challenge:${this.challengeIndex.toString()}:${action}`,
    );
    this.challenges.push(challenge);
    return Promise.resolve(challenge);
  }

  assertAuthorizedTarget(): Promise<void> {
    this.operations.push("authorize_target");
    return Promise.resolve();
  }

  quarantine(context: AuthorizedActionContext, purpose: RunPurpose) {
    const label = purpose.kind === "final" ? "final" : purpose.point;
    this.operations.push(`quarantine:${label}`);
    this.quarantineCompleted = true;
    if (this.crashAfterQuarantine) {
      this.crashAfterQuarantine = false;
      return Promise.reject(new Error("simulated crash after quarantine"));
    }
    return Promise.resolve(
      receipt(context, `quarantine:${label}`, {
        databaseRows: 0,
        storageCopies: 7,
        storageDeletes: 0,
      }),
    );
  }

  assertDatabaseRecoveryReady(): Promise<void> {
    this.operations.push("assert_database_recovery_ready");
    if (this.expireDuringRecoveryCheck) {
      return Promise.reject(new Sk90ResetSafetyError("FRESHNESS_PROOF_INVALID"));
    }
    return this.backupValid
      ? Promise.resolve()
      : Promise.reject(new Sk90ResetSafetyError("RESTORE_PROOF_MISMATCH"));
  }

  reconcileRollbackInterruption(
    context: AuthorizedActionContext,
    point: RequiredRollbackPoint,
  ): Promise<{
    observation: "baseline" | "post_reset" | "mixed";
    receipt: DurableOperationReceipt | null;
  }> {
    this.operations.push("observe_rollback_database");
    if (this.mixedDatabaseObservation) {
      return Promise.resolve({ observation: "mixed", receipt: null });
    }
    if (!this.databaseCommitted) {
      return Promise.resolve({ observation: "baseline", receipt: null });
    }
    return Promise.resolve({
      observation: "post_reset",
      receipt: receipt(context, `reconciled-interruption:${point}`, {
        databaseRows: 102,
        storageCopies: 0,
        storageDeletes: 0,
      }),
    });
  }

  interruptForRollback(context: AuthorizedActionContext, point: RequiredRollbackPoint) {
    if (
      point === "after_partial_storage_delete" &&
      context.action === "rollback_interrupt_database:after_partial_storage_delete"
    ) {
      this.operations.push("interrupt_database:after_partial_storage_delete");
      this.databaseCommitted = true;
      if (this.crashAfterRollbackPartialDatabaseCommit) {
        this.crashAfterRollbackPartialDatabaseCommit = false;
        return Promise.reject(new Error("simulated crash after rollback database commit"));
      }
      return Promise.resolve(
        receipt(context, "interrupt-database:after_partial_storage_delete", {
          databaseRows: 102,
          storageCopies: 0,
          storageDeletes: 0,
        }),
      );
    }
    if (
      point === "after_partial_storage_delete" &&
      context.action === "rollback_interrupt_storage:after_partial_storage_delete"
    ) {
      this.operations.push("interrupt_storage:after_partial_storage_delete");
      this.storageDeleteCalls += 1;
      this.partialStorageDeleted = true;
      if (this.crashAfterRollbackPartialStorageDelete) {
        this.crashAfterRollbackPartialStorageDelete = false;
        return Promise.reject(new Error("simulated crash after rollback partial storage delete"));
      }
      return Promise.resolve(
        receipt(context, "interrupt-storage:after_partial_storage_delete", {
          databaseRows: 0,
          storageCopies: 0,
          storageDeletes: 1,
        }),
      );
    }
    if (point === "after_partial_storage_delete") {
      return Promise.reject(new Error("partial rollback used the wrong durable action"));
    }
    this.operations.push(`interrupt:${point}`);
    const mutations =
      point === "before_database_commit"
        ? ZERO_MUTATIONS
        : { databaseRows: 102, storageCopies: 0, storageDeletes: 0 };
    if (point !== "before_database_commit") this.databaseCommitted = true;
    if (
      point === "after_database_commit_before_storage_delete" &&
      this.crashAfterRollbackDatabaseCommit
    ) {
      this.crashAfterRollbackDatabaseCommit = false;
      return Promise.reject(new Error("simulated crash after rollback database commit"));
    }
    return Promise.resolve(receipt(context, `interrupt:${point}`, mutations));
  }

  resetDatabase(context: AuthorizedActionContext) {
    this.operations.push("reset_database");
    this.databaseMutationCalls += 1;
    if (this.crashBeforeDatabaseMutation) {
      this.crashBeforeDatabaseMutation = false;
      return Promise.reject(new Error("simulated stop before database mutation"));
    }
    this.databaseCommitted = true;
    if (this.crashAfterDatabaseCommit) {
      this.crashAfterDatabaseCommit = false;
      return Promise.reject(new Error("simulated crash after commit"));
    }
    return Promise.resolve(
      receipt(context, "database", {
        databaseRows: 102,
        storageCopies: 0,
        storageDeletes: 0,
      }),
    );
  }

  deleteStorage(context: AuthorizedActionContext) {
    this.operations.push("delete_storage");
    this.storageDeleteCalls += 1;
    if (this.crashAfterPartialStorageDelete) {
      this.crashAfterPartialStorageDelete = false;
      this.partialStorageDeleted = true;
      return Promise.reject(new Error("simulated crash after partial storage delete"));
    }
    this.storageDeleted = true;
    return Promise.resolve(
      receipt(context, "delete", {
        databaseRows: 0,
        storageCopies: 0,
        storageDeletes: 7,
      }),
    );
  }

  verifyPostReset(context: AuthorizedActionContext) {
    this.operations.push("verify_post_reset");
    this.postVerified = true;
    if (this.crashAfterPostVerification) {
      this.crashAfterPostVerification = false;
      return Promise.reject(new Error("simulated crash after post verification"));
    }
    return Promise.resolve(receipt(context, "post-reset", ZERO_MUTATIONS, POST_STATE));
  }

  restore(context: AuthorizedActionContext, point: RequiredRollbackPoint) {
    this.operations.push(`restore:${point}`);
    this.restored = true;
    this.databaseCommitted = false;
    this.partialStorageDeleted = false;
    this.storageDeleted = false;
    this.postVerified = false;
    this.secondRunCompleted = false;
    if (this.crashAfterRestore) {
      this.crashAfterRestore = false;
      return Promise.reject(new Error("simulated crash after restore"));
    }
    return Promise.resolve(
      receipt(context, `restore:${point}`, {
        databaseRows: 102,
        storageCopies: 7,
        storageDeletes: 0,
      }),
    );
  }

  verifyRestored(
    context: AuthorizedActionContext,
    point: RequiredRollbackPoint,
    _restoreReceipt: DurableOperationReceipt,
  ) {
    void _restoreReceipt;
    this.operations.push(`verify_restored:${point}`);
    return Promise.resolve(
      receipt(context, `verify-restored:${point}`, ZERO_MUTATIONS, RESTORED_STATE),
    );
  }

  runSecondTime(context: AuthorizedActionContext, firstPostResetReceipt: DurableOperationReceipt) {
    this.operations.push("second_run");
    this.secondRunCompleted = true;
    if (this.crashAfterSecondRun) {
      this.crashAfterSecondRun = false;
      return Promise.reject(new Error("simulated crash after second run"));
    }
    const firstPostStateFingerprint = firstPostResetReceipt.postStateFingerprint;
    if (!firstPostStateFingerprint) throw new Error("missing first post fingerprint");
    return Promise.resolve(
      receipt(context, "second", this.secondRunMutations, firstPostStateFingerprint),
    );
  }

  reconcile(
    context: AuthorizedActionContext,
    phase: DurableRunPhase,
  ): Promise<ReconciliationResult> {
    this.operations.push(`reconcile:${phase}`);
    if (phase === "quarantine_started" && this.quarantineCompleted) {
      return Promise.resolve({
        observation: "quarantined",
        receipt: receipt(context, "reconciled-quarantine", {
          databaseRows: 0,
          storageCopies: 7,
          storageDeletes: 0,
        }),
      });
    }
    if (phase === "database_reset_started" && this.mixedDatabaseObservation) {
      return Promise.resolve({ observation: "mixed", receipt: null });
    }
    if (phase === "database_reset_started" && this.databaseCommitted) {
      return Promise.resolve({
        observation: "database_committed",
        receipt: receipt(context, "reconciled-database", {
          databaseRows: 102,
          storageCopies: 0,
          storageDeletes: 0,
        }),
      });
    }
    if (
      (phase === "restore_started" || phase === "restore_verification_started") &&
      this.restored
    ) {
      return Promise.resolve({
        observation: "restored",
        receipt: receipt(context, "reconciled-restore", {
          databaseRows: 102,
          storageCopies: 7,
          storageDeletes: 0,
        }),
      });
    }
    if (phase === "storage_delete_started" && this.partialStorageDeleted) {
      this.partialStorageDeleted = false;
      return Promise.resolve({ observation: "mixed", receipt: null });
    }
    if (phase === "storage_delete_started" && this.storageDeleted) {
      return Promise.resolve({
        observation: "storage_deleted",
        receipt: receipt(context, "reconciled-storage", {
          databaseRows: 0,
          storageCopies: 0,
          storageDeletes: 7,
        }),
      });
    }
    if (phase === "verification_started" && this.postVerified) {
      return Promise.resolve({
        observation: "post_verified",
        receipt: receipt(context, "reconciled-post", ZERO_MUTATIONS, POST_STATE),
      });
    }
    if (phase === "second_run_started" && this.secondRunCompleted) {
      return Promise.resolve({ observation: "post_verified", receipt: null });
    }
    return Promise.resolve({ observation: "pre", receipt: null });
  }
}

function fixedClock() {
  return { now: () => new Date("2026-07-17T10:00:00.000Z") };
}

async function skipRollbackExercises(stateStore: FileDurableRunStateStore): Promise<void> {
  const initial = await stateStore.load();
  if (!initial) throw new Error("missing fixture state");
  await stateStore.transition(initial, (current) => ({
    ...current,
    completedRollbackPoints: REQUIRED_ROLLBACK_POINTS,
  }));
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("SK-90 executable rehearsal orchestration", () => {
  it("maps the split third rollback actions to their exact destructive gates", () => {
    expect(targetActionFor("rollback_interrupt_database:after_partial_storage_delete")).toBe(
      "reset_database",
    );
    expect(targetActionFor("rollback_interrupt_storage:after_partial_storage_delete")).toBe(
      "delete_storage",
    );
    expect(targetActionFor("reconcile_restore")).toBe("restore");
    expect(targetActionFor("prepare")).toBe("prepare");
  });

  it("runs all three rollback points, final success, and an automatic zero-change second run", async () => {
    const stateStore = await store();
    const ports = new FakePorts();
    const events: SafeRunnerEvent[] = [];
    const runner = new Sk90RehearsalRunner({
      store: stateStore,
      ports,
      clock: fixedClock(),
      reporter: { emit: (event) => events.push(event) },
    });

    expect((await runner.run("plan")).phase).toBe("prepared");
    const result = await runner.run("execute");
    expect(result.phase).toBe("verified");
    expect((await stateStore.load())?.completedRollbackPoints).toEqual(REQUIRED_ROLLBACK_POINTS);
    expect(
      ports.operations.filter(
        (operation) =>
          !operation.startsWith("observe:") &&
          !operation.startsWith("reconcile:") &&
          operation !== "authorize_target",
      ),
    ).toEqual([
      "prepare",
      "quarantine:before_database_commit",
      "interrupt:before_database_commit",
      "restore:before_database_commit",
      "verify_restored:before_database_commit",
      "quarantine:after_database_commit_before_storage_delete",
      "assert_database_recovery_ready",
      "interrupt:after_database_commit_before_storage_delete",
      "restore:after_database_commit_before_storage_delete",
      "verify_restored:after_database_commit_before_storage_delete",
      "quarantine:after_partial_storage_delete",
      "assert_database_recovery_ready",
      "interrupt_database:after_partial_storage_delete",
      "assert_database_recovery_ready",
      "interrupt_storage:after_partial_storage_delete",
      "restore:after_partial_storage_delete",
      "verify_restored:after_partial_storage_delete",
      "quarantine:final",
      "assert_database_recovery_ready",
      "reset_database",
      "assert_database_recovery_ready",
      "delete_storage",
      "verify_post_reset",
      "assert_database_recovery_ready",
      "second_run",
    ]);
    expect(new Set(ports.challenges).size).toBe(ports.challenges.length);
    const finalState = await stateStore.load();
    expect(finalState?.nonceLedger.every((nonce) => nonce.consumedAt !== null)).toBe(true);
    expect(
      finalState?.receipts.filter((entry) =>
        entry.action.startsWith("rollback_interrupt_")
      ).map((entry) => entry.action),
    ).toEqual([
      "rollback_interrupt_database:after_partial_storage_delete",
      "rollback_interrupt_storage:after_partial_storage_delete",
    ]);
    expect(finalState?.receipts.at(-1)?.action).toBe("second_run");
    expect(events.at(-1)?.kind).toBe("complete");
  }, 15_000);

  it("reconciles and restores a partial-storage exercise committed before its receipt", async () => {
    const stateStore = await store();
    const ports = new FakePorts();
    const runner = new Sk90RehearsalRunner({
      store: stateStore,
      ports,
      clock: fixedClock(),
    });
    await runner.run("plan");
    ports.crashAfterRollbackPartialDatabaseCommit = true;

    await expect(runner.run("execute")).rejects.toThrow(
      "simulated crash after rollback database commit",
    );
    expect((await stateStore.load())?.phase).toBe("rollback_scenario_started");

    expect((await runner.run("resume")).phase).toBe("verified");
    expect(
      ports.operations.filter(
        (entry) => entry === "interrupt_database:after_partial_storage_delete",
      ),
    ).toHaveLength(1);
    expect(
      ports.operations.filter((entry) => entry === "restore:after_partial_storage_delete"),
    ).toHaveLength(1);
    const final = await stateStore.load();
    expect(final?.completedRollbackPoints).toEqual(REQUIRED_ROLLBACK_POINTS);
    expect(
      final?.receipts.some(
        (entry) =>
          entry.action === "reconcile_rollback_interruption" &&
          entry.mutations.databaseRows === 102,
      ),
    ).toBe(true);
  });

  it("reconciles and restores a single-stage rollback committed before its receipt", async () => {
    const stateStore = await store();
    const ports = new FakePorts();
    const runner = new Sk90RehearsalRunner({
      store: stateStore,
      ports,
      clock: fixedClock(),
    });
    await runner.run("plan");
    ports.crashAfterRollbackDatabaseCommit = true;

    await expect(runner.run("execute")).rejects.toThrow(
      "simulated crash after rollback database commit",
    );
    expect((await stateStore.load())?.phase).toBe("rollback_scenario_started");

    expect((await runner.run("resume")).phase).toBe("verified");
    expect(
      ports.operations.filter(
        (entry) => entry === "interrupt:after_database_commit_before_storage_delete",
      ),
    ).toHaveLength(1);
    expect(
      ports.operations.filter(
        (entry) => entry === "restore:after_database_commit_before_storage_delete",
      ),
    ).toHaveLength(1);
    const final = await stateStore.load();
    expect(final?.completedRollbackPoints).toEqual(REQUIRED_ROLLBACK_POINTS);
    expect(
      final?.receipts.some(
        (entry) =>
          entry.action === "reconcile_rollback_interruption" &&
          entry.mutations.databaseRows === 102,
      ),
    ).toBe(true);
  });

  it("retries a rollback interruption only when the crash-gap database is exact baseline", async () => {
    const stateStore = await store();
    const ports = new FakePorts();
    const crash = new Error("simulated stop before rollback mutation");
    let shouldCrash = true;
    const runner = new Sk90RehearsalRunner({
      store: stateStore,
      ports,
      clock: fixedClock(),
      reporter: {
        emit: (event) => {
          if (
            shouldCrash &&
            event.kind === "phase" &&
            event.phase === "rollback_scenario_started"
          ) {
            shouldCrash = false;
            throw crash;
          }
        },
      },
    });
    await runner.run("plan");

    await expect(runner.run("execute")).rejects.toBe(crash);
    expect((await stateStore.load())?.phase).toBe("rollback_scenario_started");
    expect((await runner.run("resume")).phase).toBe("verified");
    expect(ports.operations).toContain("observe_rollback_database");
    expect(
      ports.operations.filter((entry) => entry === "interrupt:before_database_commit"),
    ).toHaveLength(1);
  });

  it("never restores mixed drift from a rollback-interruption crash gap", async () => {
    const stateStore = await store();
    const ports = new FakePorts();
    const crash = new Error("simulated stop before rollback mutation");
    let shouldCrash = true;
    const runner = new Sk90RehearsalRunner({
      store: stateStore,
      ports,
      clock: fixedClock(),
      reporter: {
        emit: (event) => {
          if (
            shouldCrash &&
            event.kind === "phase" &&
            event.phase === "rollback_scenario_started"
          ) {
            shouldCrash = false;
            throw crash;
          }
        },
      },
    });
    await runner.run("plan");
    await expect(runner.run("execute")).rejects.toBe(crash);
    ports.mixedDatabaseObservation = true;

    await expect(runner.run("resume")).rejects.toMatchObject({
      code: "DATABASE_VERIFICATION_MISMATCH",
    });
    expect(ports.operations.some((entry) => entry.startsWith("restore:"))).toBe(false);
    expect((await stateStore.load())?.phase).toBe("rollback_scenario_started");
  });

  it("stops resumed partial rollback storage deletion when the approved backup drifted", async () => {
    const stateStore = await store();
    const ports = new FakePorts();
    const crash = new Error("simulated crash after partial database journal");
    let shouldCrash = true;
    const runner = new Sk90RehearsalRunner({
      store: stateStore,
      ports,
      clock: fixedClock(),
      reporter: {
        emit: (event) => {
          if (
            shouldCrash &&
            event.kind === "phase" &&
            event.phase === "rollback_partial_database_committed"
          ) {
            shouldCrash = false;
            throw crash;
          }
        },
      },
    });
    await runner.run("plan");

    await expect(runner.run("execute")).rejects.toBe(crash);
    expect((await stateStore.load())?.phase).toBe("rollback_partial_database_committed");
    ports.backupValid = false;

    await expect(runner.run("resume")).rejects.toMatchObject({
      code: "RESTORE_PROOF_MISMATCH",
    });
    expect(
      ports.operations.filter(
        (entry) => entry === "interrupt_storage:after_partial_storage_delete",
      ),
    ).toHaveLength(0);
    expect(ports.storageDeleteCalls).toBe(0);
  });

  it("restores and safely replays the third exercise after a partial-delete journal gap", async () => {
    const stateStore = await store();
    const ports = new FakePorts();
    const runner = new Sk90RehearsalRunner({
      store: stateStore,
      ports,
      clock: fixedClock(),
    });
    await runner.run("plan");
    ports.crashAfterRollbackPartialStorageDelete = true;

    await expect(runner.run("execute")).rejects.toThrow(
      "simulated crash after rollback partial storage delete",
    );
    const interrupted = await stateStore.load();
    expect(interrupted?.phase).toBe("rollback_partial_storage_delete_started");
    expect(
      interrupted?.receipts.at(-1)?.action,
    ).toBe("rollback_interrupt_database:after_partial_storage_delete");

    expect((await runner.run("resume")).phase).toBe("verified");
    expect(
      ports.operations.filter(
        (entry) => entry === "interrupt_database:after_partial_storage_delete",
      ),
    ).toHaveLength(2);
    expect(
      ports.operations.filter(
        (entry) => entry === "interrupt_storage:after_partial_storage_delete",
      ),
    ).toHaveLength(2);
    expect(
      ports.operations.filter((entry) => entry === "restore:after_partial_storage_delete"),
    ).toHaveLength(2);
    const final = await stateStore.load();
    expect(final?.completedRollbackPoints).toEqual(REQUIRED_ROLLBACK_POINTS);
    expect(new Set(ports.challenges).size).toBe(ports.challenges.length);
  });

  it("reconciles a completed quarantine copy set without copying it twice", async () => {
    const stateStore = await store();
    const ports = new FakePorts();
    const runner = new Sk90RehearsalRunner({
      store: stateStore,
      ports,
      clock: fixedClock(),
    });
    await runner.run("plan");
    await skipRollbackExercises(stateStore);
    ports.crashAfterQuarantine = true;

    await expect(runner.run("execute")).rejects.toThrow("simulated crash after quarantine");
    expect((await stateStore.load())?.phase).toBe("quarantine_started");
    expect((await runner.run("resume")).phase).toBe("verified");
    expect(ports.operations.filter((entry) => entry === "quarantine:final")).toHaveLength(1);
    expect(ports.operations).toContain("reconcile:quarantine_started");
  });

  it("stops a resumed quarantined run before any database mutation when its backup drifted", async () => {
    const stateStore = await store();
    const ports = new FakePorts();
    const runner = new Sk90RehearsalRunner({
      store: stateStore,
      ports,
      clock: fixedClock(),
    });
    await runner.run("plan");
    await skipRollbackExercises(stateStore);
    ports.crashAfterQuarantine = true;

    await expect(runner.run("execute")).rejects.toThrow("simulated crash after quarantine");
    expect((await stateStore.load())?.phase).toBe("quarantine_started");
    ports.backupValid = false;

    await expect(runner.run("resume")).rejects.toMatchObject({
      code: "RESTORE_PROOF_MISMATCH",
    });
    expect(ports.operations).toContain("reconcile:quarantine_started");
    expect(ports.operations.filter((entry) => entry === "reset_database")).toHaveLength(0);
    expect(ports.databaseMutationCalls).toBe(0);
  });

  it("forces restore after a partial storage deletion before retrying the final reset", async () => {
    const stateStore = await store();
    const ports = new FakePorts();
    const runner = new Sk90RehearsalRunner({
      store: stateStore,
      ports,
      clock: fixedClock(),
    });
    await runner.run("plan");
    await skipRollbackExercises(stateStore);
    ports.crashAfterPartialStorageDelete = true;

    await expect(runner.run("execute")).rejects.toThrow(
      "simulated crash after partial storage delete",
    );
    expect((await stateStore.load())?.phase).toBe("storage_delete_started");
    expect((await runner.run("resume")).phase).toBe("verified");
    expect(ports.operations).toContain("restore:after_partial_storage_delete");
    expect(ports.operations.filter((entry) => entry === "reset_database")).toHaveLength(2);
  });

  it("reconciles a completed post-reset verification without repeating it", async () => {
    const stateStore = await store();
    const ports = new FakePorts();
    const runner = new Sk90RehearsalRunner({
      store: stateStore,
      ports,
      clock: fixedClock(),
    });
    await runner.run("plan");
    await skipRollbackExercises(stateStore);
    ports.crashAfterPostVerification = true;

    await expect(runner.run("execute")).rejects.toThrow("simulated crash after post verification");
    expect((await stateStore.load())?.phase).toBe("verification_started");
    expect((await runner.run("resume")).phase).toBe("verified");
    expect(ports.operations.filter((entry) => entry === "verify_post_reset")).toHaveLength(1);
    expect(ports.operations).toContain("reconcile:verification_started");
  });

  it("re-runs only the zero-mutation verifier after a second-run journal gap", async () => {
    const stateStore = await store();
    const ports = new FakePorts();
    const runner = new Sk90RehearsalRunner({
      store: stateStore,
      ports,
      clock: fixedClock(),
    });
    await runner.run("plan");
    await skipRollbackExercises(stateStore);
    ports.crashAfterSecondRun = true;

    await expect(runner.run("execute")).rejects.toThrow("simulated crash after second run");
    expect((await stateStore.load())?.phase).toBe("second_run_started");
    expect((await runner.run("resume")).phase).toBe("verified");
    expect(ports.operations.filter((entry) => entry === "second_run")).toHaveLength(2);
    expect(ports.operations.filter((entry) => entry === "reset_database")).toHaveLength(1);
  });

  it("reconciles a committed database after a crash instead of resetting twice", async () => {
    const stateStore = await store();
    const ports = new FakePorts();
    const runner = new Sk90RehearsalRunner({
      store: stateStore,
      ports,
      clock: fixedClock(),
    });
    await runner.run("plan");
    await skipRollbackExercises(stateStore);
    ports.crashAfterDatabaseCommit = true;

    await expect(runner.run("execute")).rejects.toThrow("simulated crash after commit");
    expect((await stateStore.load())?.phase).toBe("database_reset_started");
    expect(ports.operations.filter((entry) => entry === "reset_database")).toHaveLength(1);

    expect((await runner.run("resume")).phase).toBe("verified");
    expect(ports.operations.filter((entry) => entry === "reset_database")).toHaveLength(1);
    expect(ports.operations).toContain("reconcile:database_reset_started");
    expect(
      (await stateStore.load())?.receipts.some(
        (entry) => entry.action === "reconcile_database_commit",
      ),
    ).toBe(true);
  });

  it("stops resumed final storage deletion when the approved backup drifted", async () => {
    const stateStore = await store();
    const ports = new FakePorts();
    const crash = new Error("simulated crash after database journal");
    let shouldCrash = true;
    const runner = new Sk90RehearsalRunner({
      store: stateStore,
      ports,
      clock: fixedClock(),
      reporter: {
        emit: (event) => {
          if (shouldCrash && event.kind === "phase" && event.phase === "database_committed") {
            shouldCrash = false;
            throw crash;
          }
        },
      },
    });
    await runner.run("plan");
    await skipRollbackExercises(stateStore);

    await expect(runner.run("execute")).rejects.toBe(crash);
    expect((await stateStore.load())?.phase).toBe("database_committed");
    ports.backupValid = false;

    await expect(runner.run("resume")).rejects.toMatchObject({
      code: "RESTORE_PROOF_MISMATCH",
    });
    expect(ports.operations.filter((entry) => entry === "delete_storage")).toHaveLength(0);
    expect(ports.storageDeleteCalls).toBe(0);
  });

  it("rechecks expiry after the backup precheck and before final storage deletion", async () => {
    const stateStore = await store();
    const ports = new FakePorts();
    const crash = new Error("simulated crash before final storage deletion");
    let shouldCrash = true;
    const runner = new Sk90RehearsalRunner({
      store: stateStore,
      ports,
      clock: fixedClock(),
      reporter: {
        emit: (event) => {
          if (shouldCrash && event.kind === "phase" && event.phase === "database_committed") {
            shouldCrash = false;
            throw crash;
          }
        },
      },
    });
    await runner.run("plan");
    await skipRollbackExercises(stateStore);

    await expect(runner.run("execute")).rejects.toBe(crash);
    ports.expireDuringRecoveryCheck = true;

    await expect(runner.run("resume")).rejects.toMatchObject({
      code: "FRESHNESS_PROOF_INVALID",
    });
    expect(ports.operations.filter((entry) => entry === "delete_storage")).toHaveLength(0);
    expect(ports.storageDeleteCalls).toBe(0);
  });

  it("never restores unrelated mixed drift observed before the database mutation", async () => {
    const stateStore = await store();
    const ports = new FakePorts();
    const runner = new Sk90RehearsalRunner({
      store: stateStore,
      ports,
      clock: fixedClock(),
    });
    await runner.run("plan");
    await skipRollbackExercises(stateStore);
    ports.crashBeforeDatabaseMutation = true;
    ports.mixedDatabaseObservation = true;

    await expect(runner.run("execute")).rejects.toThrow(
      "simulated stop before database mutation",
    );
    expect((await stateStore.load())?.phase).toBe("database_reset_started");

    await expect(runner.run("resume")).rejects.toMatchObject({
      code: "DATABASE_VERIFICATION_MISMATCH",
    });
    expect(ports.operations.filter((entry) => entry === "reset_database")).toHaveLength(1);
    expect(ports.operations).toContain("reconcile:database_reset_started");
    expect(ports.operations.some((entry) => entry.startsWith("restore:"))).toBe(false);
    expect((await stateStore.load())?.phase).toBe("database_reset_started");
  });

  it("recovers a completed restore with a fresh reconciliation and proof challenge", async () => {
    const stateStore = await store();
    const ports = new FakePorts();
    const runner = new Sk90RehearsalRunner({
      store: stateStore,
      ports,
      clock: fixedClock(),
    });
    await runner.run("plan");
    ports.crashAfterRestore = true;

    await expect(runner.run("execute")).rejects.toThrow("simulated crash after restore");
    expect((await stateStore.load())?.phase).toBe("restore_started");
    expect((await runner.run("resume")).phase).toBe("verified");
    expect(ports.operations).toContain("reconcile:restore_started");
    expect(
      ports.operations.filter((entry) => entry === "interrupt:before_database_commit"),
    ).toHaveLength(1);
    expect((await stateStore.load())?.completedRollbackPoints).toEqual(REQUIRED_ROLLBACK_POINTS);
  });

  it("refuses final success when the second run changes even one object", async () => {
    const stateStore = await store();
    const ports = new FakePorts();
    ports.secondRunMutations = { databaseRows: 0, storageCopies: 0, storageDeletes: 1 };
    const runner = new Sk90RehearsalRunner({
      store: stateStore,
      ports,
      clock: fixedClock(),
    });
    await runner.run("plan");
    const initial = await stateStore.load();
    if (!initial) throw new Error("missing fixture state");
    await stateStore.transition(initial, (current) => ({
      ...current,
      completedRollbackPoints: REQUIRED_ROLLBACK_POINTS,
    }));

    await expect(runner.run("execute")).rejects.toMatchObject({
      code: "POST_RESET_INTEGRITY_MISMATCH",
    });
    expect((await stateStore.load())?.phase).toBe("second_run_started");
  });
});
