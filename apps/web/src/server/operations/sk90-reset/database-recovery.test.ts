import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { approvalLedgerDirectoryFingerprint } from "./approval-consumption";
import { canonicalJson, protectValue, sha256Digest, type ProtectedToken } from "./canonical";
import {
  classifyDatabaseSchemaState,
  SK90_BASELINE_ONLY_RELATIONS,
  SK90_POST_RESET_ONLY_RELATIONS,
  type DatabaseRestorePreparedRecord,
  type DatabaseVerificationReceipt,
  type NeonPoolClientLike,
} from "./database-adapter";
import {
  createDatabaseRecovery,
  type DatabaseBackupPreparationAuthorization,
  type DatabaseRecoveryAuthorization,
  type DatabaseRestoreRollbackPoint,
  type RecoveryProcessInput,
  type RecoveryProcessPort,
} from "./database-recovery";
import { Sk90ResetSafetyError } from "./errors";
import { bindExecutableResetApproval, type ExecutableResetApproval } from "./execution";
import type { FreshTargetAuthorization, TargetGatedResetAction } from "./policy";

const directories: string[] = [];
const DATABASE_URL = "postgresql://isolated-user:isolated-password@isolated.invalid/rehearsal";
const HMAC_KEY = "database-recovery-test-key-that-is-at-least-32-bytes";
const CURRENT_TIME = "2026-07-17T12:00:00.000Z";
const ISSUED_AT = "2026-07-17T11:59:00.000Z";
const EXPIRES_AT = "2026-07-17T12:04:00.000Z";

function freshAuthorization(
  action: TargetGatedResetAction,
  artifactDigest: `sha256:${string}`,
  targetObservationDigest: `sha256:${string}`,
  label: string,
  window: Readonly<{ issuedAt: string; expiresAt: string }> = {
    issuedAt: ISSUED_AT,
    expiresAt: EXPIRES_AT,
  },
): Readonly<{
  authorization: FreshTargetAuthorization;
  challengeToken: ProtectedToken;
}> {
  const challengeToken = protectValue(HMAC_KEY, `recovery-${label}`);
  const body = {
    contract: "sk90-fresh-target-authorization-v1" as const,
    action,
    artifactDigest,
    challengeToken,
    targetObservationDigest,
    issuedAt: window.issuedAt,
    expiresAt: window.expiresAt,
  };
  return {
    challengeToken,
    authorization: { ...body, authorizationDigest: sha256Digest(canonicalJson(body)) },
  };
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "sk90-db-recovery-"));
  directories.push(directory);
  await chmod(directory, 0o700);
  const approvalLedgerDirectory = join(directory, "approval-ledger");
  await mkdir(approvalLedgerDirectory, { mode: 0o700 });
  const approvalLedgerFingerprint = approvalLedgerDirectoryFingerprint(
    await realpath(approvalLedgerDirectory),
  );
  const dump = join(directory, "pg_dump");
  const restore = join(directory, "pg_restore");
  await writeFile(dump, "test dump binary", { mode: 0o700 });
  await writeFile(restore, "test restore binary", { mode: 0o700 });
  await chmod(dump, 0o700);
  await chmod(restore, 0o700);

  const artifactDigest = sha256Digest("artifact");
  const manifestDigest = sha256Digest("manifest");
  const policyDigest = sha256Digest("policy");
  const targetDatabaseFingerprint = sha256Digest("target-database");
  const targetObservationDigest = sha256Digest("target-observation");
  const baselineDatabaseFingerprint = sha256Digest("baseline-database");
  const calls: RecoveryProcessInput[] = [];
  let databaseState: "baseline" | "post_reset" = "baseline";
  let failNextBaselineVerification = false;
  let failNextRestore = false;
  let driftDuringSnapshot = false;
  let expireBeforeSnapshotUse = false;
  let expireDuringRestorePreparation = false;
  let restoreProcessCount = 0;
  let restorePreparationCount = 0;
  let restorePreparedRecord: DatabaseRestorePreparedRecord | null = null;
  let snapshotSequence = 0;
  let authorizationSequence = 0;
  let recoveryNow = new Date(CURRENT_TIME);
  let failNextDump = false;
  let blockedDump:
    | Readonly<{ started(): void; wait: Promise<void> }>
    | undefined;

  const baselineReceipt = (): DatabaseVerificationReceipt => ({
    artifactDigest,
    manifestDigest,
    purpose: "restored_baseline",
    schemaFingerprint: sha256Digest("baseline-schema"),
    databaseStateFingerprint: baselineDatabaseFingerprint,
    databaseMutationCount: 0,
    committed: true,
  });

  const process: RecoveryProcessPort = {
    async run(input) {
      calls.push(input);
      if (basename(input.binary) === "pg_dump") {
        if (failNextDump) {
          failNextDump = false;
          throw new Error("private pg_dump failure");
        }
        blockedDump?.started();
        if (blockedDump) await blockedDump.wait;
        blockedDump = undefined;
        const fileIndex = input.arguments.indexOf("--file");
        const path = input.arguments[fileIndex + 1];
        if (!path) throw new Error("missing test backup path");
        if (!input.arguments.some((argument) => argument.startsWith("--snapshot="))) {
          throw new Error("missing exported snapshot");
        }
        await writeFile(path, "private custom-format backup", { mode: 0o600 });
        await chmod(path, 0o600);
      } else if (input.arguments[0] === "--list") {
        const archive = input.arguments[1];
        if (!archive || (await readFile(archive)).byteLength === 0) {
          throw new Error("invalid private archive");
        }
      } else {
        restoreProcessCount += 1;
        if (failNextRestore) {
          failNextRestore = false;
          throw new Error("private pg_restore failure");
        }
        databaseState = "baseline";
        restorePreparedRecord = null;
      }
      return { exitCode: 0 };
    },
  };

  const verifyRestoredBaseline = async (): Promise<DatabaseVerificationReceipt> => {
    const classified = await classifyDatabaseSchemaState({
      query: (() =>
        Promise.resolve({
          rows: [...SK90_BASELINE_ONLY_RELATIONS, ...SK90_POST_RESET_ONLY_RELATIONS].map(
            (relationName) => ({
              relation_name: relationName,
              relation:
                databaseState === "baseline"
                  ? SK90_BASELINE_ONLY_RELATIONS.includes(
                      relationName as (typeof SK90_BASELINE_ONLY_RELATIONS)[number],
                    )
                    ? relationName
                    : null
                  : SK90_POST_RESET_ONLY_RELATIONS.includes(
                        relationName as (typeof SK90_POST_RESET_ONLY_RELATIONS)[number],
                      )
                    ? relationName
                    : null,
            }),
          ),
        })) as NeonPoolClientLike["query"],
      release: () => undefined,
    });
    if (classified !== "baseline") {
      throw new Sk90ResetSafetyError("DATABASE_VERIFICATION_MISMATCH");
    }
    if (failNextBaselineVerification) {
      failNextBaselineVerification = false;
      throw new Error("private crash detail");
    }
    return Promise.resolve(baselineReceipt());
  };

  const recovery = createDatabaseRecovery({
    artifactDigest,
    manifestDigest,
    policyDigest,
    targetDatabaseFingerprint,
    targetObservationDigest,
    baselineDatabaseFingerprint,
    targetDatabaseUrl: DATABASE_URL,
    privateStateDirectory: directory,
    privateApprovalLedgerDirectory: approvalLedgerDirectory,
    pgDumpBinary: dump,
    pgRestoreBinary: restore,
    hmacKey: HMAC_KEY,
    now: () => recoveryNow,
    prepareRestoreTarget: (input) => {
      restorePreparationCount += 1;
      input.assertFresh();
      if (
        (input.expectedExistingMarkerFingerprint === null &&
          restorePreparedRecord !== null) ||
        (input.expectedExistingMarkerFingerprint !== null &&
          restorePreparedRecord?.markerFingerprint !==
            input.expectedExistingMarkerFingerprint)
      ) {
        throw new Sk90ResetSafetyError("RESTORE_PROOF_MISMATCH");
      }
      if (expireDuringRestorePreparation) {
        expireDuringRestorePreparation = false;
        recoveryNow = new Date("2026-07-17T12:05:00.000Z");
      }
      input.assertFresh();
      restorePreparedRecord = input.marker;
      databaseState = "post_reset";
      return Promise.resolve();
    },
    readRestorePreparedRecord: () => Promise.resolve(restorePreparedRecord),
    verifyRestoredBaseline,
    async withVerifiedBaselineSnapshot(useSnapshot) {
      if (databaseState !== "baseline") {
        throw new Sk90ResetSafetyError("RESTORE_PROOF_MISMATCH");
      }
      snapshotSequence += 1;
      if (expireBeforeSnapshotUse) {
        recoveryNow = new Date("2026-07-17T12:05:00.000Z");
      }
      await useSnapshot(`snapshot-${String(snapshotSequence)}`);
      if (driftDuringSnapshot) databaseState = "post_reset";
      if (databaseState !== "baseline") {
        throw new Sk90ResetSafetyError("RESTORE_POINT_NOT_READY");
      }
      return baselineReceipt();
    },
    process,
  });

  function preparationAuthorization(): DatabaseBackupPreparationAuthorization {
    authorizationSequence += 1;
    const fresh = freshAuthorization(
      "prepare",
      artifactDigest,
      targetObservationDigest,
      `prepare-${String(authorizationSequence)}`,
    );
    return {
      freshAuthorization: fresh.authorization,
      actionChallengeToken: fresh.challengeToken,
      targetObservationBindingDigest: sha256Digest(
        `prepare-observation-${String(authorizationSequence)}`,
      ),
      currentTime: CURRENT_TIME,
    };
  }

  function approvalFor(backupFingerprint: `sha256:${string}`): ExecutableResetApproval {
    return bindExecutableResetApproval({
      contract: "sk90-executable-reset-approval-v1",
      artifactDigest,
      manifestDigest,
      policyDigest,
      targetDatabaseFingerprint,
      targetStorageFingerprint: sha256Digest("storage-target"),
      resetPlanDigest: sha256Digest("plan"),
      migrationDigest: sha256Digest("migration"),
      privateEnvelopeDigest: sha256Digest("envelope"),
      approvalLedgerDirectoryFingerprint: approvalLedgerFingerprint,
      evidenceObservationDigest: sha256Digest("evidence"),
      preStorageNamespaceFingerprint: sha256Digest("storage-pre"),
      postStorageNamespaceFingerprint: sha256Digest("storage-post"),
      databaseRestorePointFingerprint: backupFingerprint,
      storageRestorePointFingerprint: sha256Digest("storage-restore"),
      approvalChallengeToken: protectValue(HMAC_KEY, `approval-${backupFingerprint}`),
      approvedAt: ISSUED_AT,
      expiresAt: EXPIRES_AT,
    });
  }

  function backupAuthorization(
    approval: ExecutableResetApproval,
    freshWindow?: Readonly<{ issuedAt: string; expiresAt: string; currentTime: string }>,
  ): DatabaseRecoveryAuthorization {
    authorizationSequence += 1;
    const fresh = freshAuthorization(
      "quarantine_objects",
      artifactDigest,
      targetObservationDigest,
      `bind-${String(authorizationSequence)}`,
      freshWindow,
    );
    return {
      executionApproval: approval,
      approvedExecutionDigest: approval.digest,
      freshAuthorization: fresh.authorization,
      actionChallengeToken: fresh.challengeToken,
      currentTime: freshWindow?.currentTime ?? CURRENT_TIME,
    };
  }

  function restoreAuthorization(
    approval: ExecutableResetApproval,
    rollbackPoint: DatabaseRestoreRollbackPoint,
    nonceLabel: string,
  ) {
    authorizationSequence += 1;
    const fresh = freshAuthorization(
      "restore",
      artifactDigest,
      targetObservationDigest,
      `restore-${String(authorizationSequence)}`,
    );
    return {
      approvalDigest: approval.digest,
      freshAuthorization: fresh.authorization,
      actionChallengeToken: fresh.challengeToken,
      currentTime: CURRENT_TIME,
      expectedRestorePointFingerprint: approval.databaseRestorePointFingerprint,
      expectedBaselineObservationDigest: baselineDatabaseFingerprint,
      exercise: {
        rollbackPoint,
        durableAction: `rollback_restore:${rollbackPoint}` as const,
        durableNonceConsumptionDigest: sha256Digest(`nonce-${nonceLabel}`),
      },
      forceReplay: true,
      resumePrepared: false,
    };
  }

  async function prepareAndApprove() {
    const prepared = await recovery.prepareBackup(preparationAuthorization());
    const approval = approvalFor(prepared.receipt.backupFingerprint);
    const approved = await recovery.requireApprovedBackup(backupAuthorization(approval));
    return { approval, approved, prepared };
  }

  return {
    approvalFor,
    approvalLedgerDirectory,
    artifactDigest,
    backupAuthorization,
    baselineDatabaseFingerprint,
    calls,
    directory,
    manifestDigest,
    policyDigest,
    prepareAndApprove,
    preparationAuthorization,
    recovery,
    restoreAuthorization,
    setDatabaseState(value: "baseline" | "post_reset") {
      databaseState = value;
    },
    setRecoveryNow(value: string) {
      recoveryNow = new Date(value);
    },
    driftDuringSnapshot() {
      driftDuringSnapshot = true;
    },
    expireBeforeSnapshotUse() {
      expireBeforeSnapshotUse = true;
    },
    failNextBaselineVerification() {
      failNextBaselineVerification = true;
    },
    failNextRestore() {
      failNextRestore = true;
    },
    failNextDump() {
      failNextDump = true;
    },
    expireDuringRestorePreparation() {
      expireDuringRestorePreparation = true;
    },
    clearRestorePreparedRecord() {
      restorePreparedRecord = null;
    },
    tamperRestorePreparedRecord() {
      if (restorePreparedRecord) {
        restorePreparedRecord = {
          ...restorePreparedRecord,
          markerJson: `${restorePreparedRecord.markerJson} `,
        };
      }
    },
    blockNextDump() {
      let markStarted: (() => void) | undefined;
      let release: (() => void) | undefined;
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      const wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      blockedDump = { started: () => markStarted?.(), wait };
      return { started, release: () => release?.() };
    },
    restoreProcessCount() {
      return restoreProcessCount;
    },
    restorePreparationCount() {
      return restorePreparationCount;
    },
  };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

function preparationPaths(test: Readonly<{ directory: string; artifactDigest: string }>) {
  const suffix = test.artifactDigest.slice("sha256:".length);
  return {
    backup: join(test.directory, `database-${suffix}.dump`),
    prepared: join(test.directory, `database-${suffix}.backup-prepared.json`),
    completion: join(test.directory, `database-${suffix}.backup-prepare-complete.json`),
    temporary: join(test.directory, `.database-${suffix}.preparing.dump`),
  };
}

describe("SK-90 PostgreSQL backup preparation and restore adapter", () => {
  it("prepares an exact exported-snapshot archive before any approval can bind it", async () => {
    const test = await fixture();
    const guessed = test.approvalFor(sha256Digest("guessed-before-pg-dump"));

    await expect(
      test.recovery.requireApprovedBackup(test.backupAuthorization(guessed)),
    ).rejects.toMatchObject({ code: "EXECUTION_APPROVAL_MISMATCH" });
    expect(test.calls).toHaveLength(0);

    const prepared = await test.recovery.prepareBackup(test.preparationAuthorization());
    const dumpCall = test.calls.find((call) => basename(call.binary) === "pg_dump");
    expect(dumpCall?.arguments).toContain("--snapshot=snapshot-1");
    expect(prepared.receipt).toMatchObject({
      artifactDigest: test.artifactDigest,
      manifestDigest: test.manifestDigest,
      policyDigest: test.policyDigest,
      authorizationAction: "prepare",
    });

    await expect(
      test.recovery.requireApprovedBackup(test.backupAuthorization(guessed)),
    ).rejects.toMatchObject({ code: "EXECUTION_APPROVAL_MISMATCH" });
    const exact = test.approvalFor(prepared.receipt.backupFingerprint);
    const approved = await test.recovery.requireApprovedBackup(test.backupAuthorization(exact));
    expect(approved.receipt.executionApprovalDigest).toBe(exact.digest);
    expect(approved.receipt.backupFingerprint).toBe(prepared.receipt.backupFingerprint);
    expect(await readFile(approved.backupPath, "utf8")).toBe("private custom-format backup");
  });

  it("consumes preparation challenges once and never replays a completed archive", async () => {
    const test = await fixture();
    const firstAuthorization = test.preparationAuthorization();
    await test.recovery.prepareBackup(firstAuthorization);

    await expect(test.recovery.prepareBackup(firstAuthorization)).rejects.toMatchObject({
      code: "FRESHNESS_NONCE_REUSED",
    });
    await expect(
      test.recovery.prepareBackup(test.preparationAuthorization()),
    ).rejects.toMatchObject({ code: "FRESHNESS_NONCE_REUSED" });
    expect(test.calls.filter((call) => basename(call.binary) === "pg_dump")).toHaveLength(1);
    expect(test.calls.filter((call) => call.arguments[0] === "--list")).toHaveLength(2);
    expect(test.calls[0]?.environment).toEqual({
      PGHOST: "isolated.invalid",
      PGDATABASE: "rehearsal",
      PGUSER: "isolated-user",
      PGPASSWORD: "isolated-password",
      LC_ALL: "C",
      LANG: "C",
    });
    expect(Object.values(test.calls[0]?.environment ?? {})).not.toContain(DATABASE_URL);
    expect(test.calls.every((call) => !call.arguments.join(" ").includes(DATABASE_URL))).toBe(true);
  });

  it("requires a new challenge after a failed dump and permits one exact retry", async () => {
    const test = await fixture();
    const failedAuthorization = test.preparationAuthorization();
    test.failNextDump();

    await expect(test.recovery.prepareBackup(failedAuthorization)).rejects.toMatchObject({
      code: "RESTORE_POINT_NOT_READY",
    });
    await expect(test.recovery.prepareBackup(failedAuthorization)).rejects.toMatchObject({
      code: "FRESHNESS_NONCE_REUSED",
    });
    await expect(
      test.recovery.prepareBackup(test.preparationAuthorization()),
    ).resolves.toMatchObject({ receipt: { authorizationAction: "prepare" } });
    expect(test.calls.filter((call) => basename(call.binary) === "pg_dump")).toHaveLength(2);
  });

  it("rechecks observed wall time after lock waits and starts no stale pg_dump", async () => {
    const test = await fixture();
    test.expireBeforeSnapshotUse();

    await expect(
      test.recovery.prepareBackup(test.preparationAuthorization()),
    ).rejects.toMatchObject({ code: "FRESHNESS_PROOF_INVALID" });
    expect(test.calls.filter((call) => basename(call.binary) === "pg_dump")).toHaveLength(0);
  });

  it("recovers a complete temporary archive after the dump-to-receipt crash gap", async () => {
    const test = await fixture();
    await test.recovery.prepareBackup(test.preparationAuthorization());
    const paths = preparationPaths(test);
    await unlink(paths.completion);
    await unlink(paths.prepared);
    await rename(paths.backup, paths.temporary);

    await expect(
      test.recovery.prepareBackup(test.preparationAuthorization()),
    ).resolves.toMatchObject({ receipt: { authorizationAction: "prepare" } });
    expect(test.calls.filter((call) => basename(call.binary) === "pg_dump")).toHaveLength(1);
    expect(await readFile(paths.backup, "utf8")).toBe("private custom-format backup");
  });

  it("repairs the receipt-to-hard-link and hard-link-to-cleanup crash gaps", async () => {
    const receiptGap = await fixture();
    await receiptGap.recovery.prepareBackup(receiptGap.preparationAuthorization());
    const receiptPaths = preparationPaths(receiptGap);
    await unlink(receiptPaths.completion);
    await rename(receiptPaths.backup, receiptPaths.temporary);

    await expect(
      receiptGap.recovery.prepareBackup(receiptGap.preparationAuthorization()),
    ).resolves.toBeDefined();
    expect(receiptGap.calls.filter((call) => basename(call.binary) === "pg_dump")).toHaveLength(1);

    const cleanupGap = await fixture();
    await cleanupGap.recovery.prepareBackup(cleanupGap.preparationAuthorization());
    const cleanupPaths = preparationPaths(cleanupGap);
    await unlink(cleanupPaths.completion);
    await copyFile(cleanupPaths.backup, cleanupPaths.temporary);
    await chmod(cleanupPaths.temporary, 0o600);

    await expect(
      cleanupGap.recovery.prepareBackup(cleanupGap.preparationAuthorization()),
    ).resolves.toBeDefined();
    await expect(readFile(cleanupPaths.temporary)).rejects.toMatchObject({ code: "ENOENT" });
    expect(cleanupGap.calls.filter((call) => basename(call.binary) === "pg_dump")).toHaveLength(1);
  });

  it("allows only one concurrent preparation to reach pg_dump", async () => {
    const test = await fixture();
    const gate = test.blockNextDump();
    const first = test.recovery.prepareBackup(test.preparationAuthorization());
    await gate.started;

    await expect(
      test.recovery.prepareBackup(test.preparationAuthorization()),
    ).rejects.toMatchObject({ code: "RESTORE_POINT_NOT_READY" });
    gate.release();
    await expect(first).resolves.toBeDefined();
    expect(test.calls.filter((call) => basename(call.binary) === "pg_dump")).toHaveLength(1);
  });

  it("rejects copied preparation state and ledger receipts in a new directory", async () => {
    const source = await fixture();
    const copied = await fixture();
    await source.recovery.prepareBackup(source.preparationAuthorization());

    for (const name of await readdir(source.directory)) {
      if (!name.includes("backup-") && !name.endsWith(".dump")) continue;
      await copyFile(join(source.directory, name), join(copied.directory, name));
      await chmod(join(copied.directory, name), 0o600);
    }
    for (const name of await readdir(source.approvalLedgerDirectory)) {
      await copyFile(
        join(source.approvalLedgerDirectory, name),
        join(copied.approvalLedgerDirectory, name),
      );
      await chmod(join(copied.approvalLedgerDirectory, name), 0o600);
    }

    await expect(
      copied.recovery.prepareBackup(copied.preparationAuthorization()),
    ).rejects.toMatchObject({ code: "FRESHNESS_NONCE_REUSED" });
    expect(copied.calls.filter((call) => basename(call.binary) === "pg_dump")).toHaveLength(0);
  });

  it("reuses the consumed approval binding after approval expiry with a fresh resume action", async () => {
    const test = await fixture();
    const { approval, approved } = await test.prepareAndApprove();
    const resumed = await test.recovery.requireApprovedBackup(
      test.backupAuthorization(approval, {
        issuedAt: "2026-07-17T12:59:00.000Z",
        expiresAt: "2026-07-17T13:04:00.000Z",
        currentTime: "2026-07-17T13:00:00.000Z",
      }),
    );

    expect(resumed.receipt.receiptDigest).toBe(approved.receipt.receiptDigest);
    expect(test.calls.filter((call) => basename(call.binary) === "pg_dump")).toHaveLength(1);
  });

  it("fails closed when the reviewed baseline drifts while the exported snapshot is held", async () => {
    const test = await fixture();
    test.driftDuringSnapshot();

    await expect(
      test.recovery.prepareBackup(test.preparationAuthorization()),
    ).rejects.toMatchObject({ code: "RESTORE_POINT_NOT_READY" });
    expect((await readdir(test.directory)).some((name) => name.endsWith(".backup-prepared.json"))).toBe(
      false,
    );
  });

  it("journals separate append-only restore generations for all rollback exercises", async () => {
    const test = await fixture();
    const { approval } = await test.prepareAndApprove();

    const beforeCommit = await test.recovery.restore(
      test.restoreAuthorization(approval, "before_database_commit", "before"),
    );
    expect(beforeCommit.restoreDisposition).toBe("executed");
    expect(test.restoreProcessCount()).toBe(1);
    expect(test.restorePreparationCount()).toBe(1);
    const restoreCall = test.calls.find(
      (call) => basename(call.binary) === "pg_restore" && call.arguments.includes("--clean"),
    );
    expect(restoreCall?.arguments).toContain("--dbname=rehearsal");
    expect(restoreCall?.arguments.join(" ")).not.toContain(DATABASE_URL);

    test.setDatabaseState("post_reset");
    const afterCommit = await test.recovery.restore(
      test.restoreAuthorization(
        approval,
        "after_database_commit_before_storage_delete",
        "post-db",
      ),
    );
    expect(afterCommit.restoreDisposition).toBe("executed");

    test.setDatabaseState("post_reset");
    const partialStorage = await test.recovery.restore(
      test.restoreAuthorization(approval, "after_partial_storage_delete", "partial-storage"),
    );
    expect(partialStorage.restoreDisposition).toBe("executed");
    expect(test.restoreProcessCount()).toBe(3);
    expect(test.restorePreparationCount()).toBe(3);
    expect(
      new Set([
        beforeCommit.receiptDigest,
        afterCommit.receiptDigest,
        partialStorage.receiptDigest,
      ]),
    ).toHaveLength(3);

    const provedBeforeCommit = await test.recovery.requireExecutedRestore({
      approvalDigest: approval.digest,
      expectedRestorePointFingerprint: approval.databaseRestorePointFingerprint,
      expectedBaselineObservationDigest: test.baselineDatabaseFingerprint,
      rollbackPoint: "before_database_commit",
      durableAction: "rollback_restore:before_database_commit",
    });
    expect(provedBeforeCommit.receiptDigest).toBe(beforeCommit.receiptDigest);

    const entries = await readdir(test.directory);
    expect(entries.filter((name) => name.endsWith(".intent.json"))).toHaveLength(3);
    expect(entries.filter((name) => name.endsWith(".receipt.json"))).toHaveLength(3);
  });

  it("runs pg_restore when the composed catalog probe observes a valid post-0027 database", async () => {
    const test = await fixture();
    const { approval } = await test.prepareAndApprove();
    test.setDatabaseState("post_reset");

    await expect(
      test.recovery.restore(
        test.restoreAuthorization(
          approval,
          "after_database_commit_before_storage_delete",
          "post-0027-catalog",
        ),
      ),
    ).resolves.toMatchObject({ restoreDisposition: "executed" });
    expect(test.restoreProcessCount()).toBe(1);
    expect(test.restorePreparationCount()).toBe(1);
  });

  it("rechecks freshness after archive validation and before destructive pg_restore", async () => {
    const test = await fixture();
    const { approval } = await test.prepareAndApprove();
    test.setRecoveryNow("2026-07-17T12:05:00.000Z");

    await expect(
      test.recovery.restore(
        test.restoreAuthorization(approval, "before_database_commit", "expired-restore"),
      ),
    ).rejects.toMatchObject({ code: "FRESHNESS_PROOF_INVALID" });
    expect(test.restoreProcessCount()).toBe(0);
  });

  it("fails closed when restore authorization expires during locked target preparation", async () => {
    const test = await fixture();
    const { approval } = await test.prepareAndApprove();
    test.setDatabaseState("post_reset");
    test.expireDuringRestorePreparation();

    await expect(
      test.recovery.restore(
        test.restoreAuthorization(
          approval,
          "after_database_commit_before_storage_delete",
          "expires-during-preparation",
        ),
      ),
    ).rejects.toMatchObject({ code: "FRESHNESS_PROOF_INVALID" });
    expect(test.restoreProcessCount()).toBe(0);
  });

  it("resumes only an exact authenticated crash-after-preparation generation", async () => {
    const test = await fixture();
    const { approval } = await test.prepareAndApprove();
    test.setDatabaseState("post_reset");
    test.failNextRestore();
    const first = test.restoreAuthorization(
      approval,
      "after_database_commit_before_storage_delete",
      "prepared-crash-first",
    );

    await expect(test.recovery.restore(first)).rejects.toMatchObject({
      code: "RESTORE_REQUIRED",
    });
    const selector = {
      approvalDigest: approval.digest,
      expectedRestorePointFingerprint: approval.databaseRestorePointFingerprint,
      expectedBaselineObservationDigest: test.baselineDatabaseFingerprint,
      rollbackPoint: "after_database_commit_before_storage_delete",
      durableAction: "rollback_restore:after_database_commit_before_storage_delete",
    } as const;
    await expect(test.recovery.requirePreparedRestore(selector)).resolves.toBeUndefined();

    const resumed = await test.recovery.restore({
      ...test.restoreAuthorization(
        approval,
        "after_database_commit_before_storage_delete",
        "prepared-crash-resume",
      ),
      resumePrepared: true,
    });
    expect(resumed.restoreDisposition).toBe("executed");
    expect(test.restoreProcessCount()).toBe(2);
  });

  it("rejects a tampered prepared marker before replay", async () => {
    const test = await fixture();
    const { approval } = await test.prepareAndApprove();
    test.setDatabaseState("post_reset");
    test.failNextRestore();
    await expect(
      test.recovery.restore(
        test.restoreAuthorization(
          approval,
          "after_database_commit_before_storage_delete",
          "prepared-tamper",
        ),
      ),
    ).rejects.toMatchObject({ code: "RESTORE_REQUIRED" });
    test.tamperRestorePreparedRecord();

    await expect(
      test.recovery.requirePreparedRestore({
        approvalDigest: approval.digest,
        expectedRestorePointFingerprint: approval.databaseRestorePointFingerprint,
        expectedBaselineObservationDigest: test.baselineDatabaseFingerprint,
        rollbackPoint: "after_database_commit_before_storage_delete",
        durableAction: "rollback_restore:after_database_commit_before_storage_delete",
      }),
    ).rejects.toMatchObject({ code: "RESTORE_PROOF_MISMATCH" });
  });

  it("force-replays the same restore generation after a post-commit crash", async () => {
    const test = await fixture();
    const { approval } = await test.prepareAndApprove();
    test.setDatabaseState("post_reset");
    test.failNextBaselineVerification();
    const firstAttempt = test.restoreAuthorization(
      approval,
      "after_database_commit_before_storage_delete",
      "crash-attempt",
    );

    await expect(test.recovery.restore(firstAttempt)).rejects.toMatchObject({
      code: "UNEXPECTED_FAILURE",
    });
    expect(test.restoreProcessCount()).toBe(1);

    const resumed = await test.recovery.restore({
      ...test.restoreAuthorization(
        approval,
        "after_database_commit_before_storage_delete",
        "crash-attempt",
      ),
      exercise: firstAttempt.exercise,
    });
    expect(resumed.restoreDisposition).toBe("executed");
    expect(test.restoreProcessCount()).toBe(2);
    await expect(
      test.recovery.requireExecutedRestore({
        approvalDigest: approval.digest,
        expectedRestorePointFingerprint: approval.databaseRestorePointFingerprint,
        expectedBaselineObservationDigest: test.baselineDatabaseFingerprint,
        rollbackPoint: "after_database_commit_before_storage_delete",
        durableAction: "rollback_restore:after_database_commit_before_storage_delete",
      }),
    ).resolves.toMatchObject({ restoreDisposition: "executed" });
  });

  it("rejects archive drift, wrong baseline binding, and wrong preparation action", async () => {
    const drifted = await fixture();
    const { approval, approved } = await drifted.prepareAndApprove();
    await writeFile(approved.backupPath, "substituted backup", { mode: 0o600 });
    await chmod(approved.backupPath, 0o600);
    await expect(
      drifted.recovery.revalidateApprovedBackup({
        executionApproval: approval,
        approvedExecutionDigest: approval.digest,
      }),
    ).rejects.toMatchObject({ code: "RESTORE_PROOF_MISMATCH" });
    await expect(
      drifted.recovery.restore(
        drifted.restoreAuthorization(approval, "before_database_commit", "drift"),
      ),
    ).rejects.toMatchObject({ code: "RESTORE_PROOF_MISMATCH" });
    expect(drifted.restoreProcessCount()).toBe(0);

    const wrong = await fixture();
    const wrongAction = freshAuthorization(
      "reset_database",
      wrong.artifactDigest,
      sha256Digest("target-observation"),
      "wrong-action",
    );
    await expect(
      wrong.recovery.prepareBackup({
        freshAuthorization: wrongAction.authorization,
        actionChallengeToken: wrongAction.challengeToken,
        targetObservationBindingDigest: sha256Digest("wrong-observation-binding"),
        currentTime: CURRENT_TIME,
      }),
    ).rejects.toMatchObject({ code: "FRESH_TARGET_AUTHORIZATION_INVALID" });
  });
});
