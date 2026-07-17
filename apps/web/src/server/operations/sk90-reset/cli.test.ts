import { describe, expect, it, vi } from "vitest";

import { protectValue, sha256Digest } from "./canonical";
import {
  assertExactBackupPreparationObservation,
  constructWithExecutableResourceCleanup,
  createSafeJsonCliReporter,
  ExecutableResourceScope,
  parseRunnerMode,
  runWithExecutableResourceCleanup,
  runSk90ResetCli,
  type SafeCliEvent,
} from "./cli";
import { Sk90ResetSafetyError } from "./errors";
import {
  assertRehearsalTarget,
  rehearsalTargetPolicyDigest,
  targetObservationDigest,
  type RehearsalTargetPolicy,
} from "./policy";
import type { RunnerMode, RunnerResult } from "./runner";
import { challengeBoundTargetObservationDigest } from "./target-observer";

const RESULT: RunnerResult = {
  phase: "verified",
  revision: 42,
  artifactDigest: sha256Digest("artifact"),
  manifestDigest: sha256Digest("manifest"),
  stateDigest: sha256Digest("state"),
  mutationTotals: { databaseRows: 102, storageCopies: 28, storageDeletes: 10 },
};

const PREPARED_BACKUP_RESULT = {
  artifactDigest: sha256Digest("artifact"),
  targetObservationDigest: sha256Digest("target-observation"),
  preparedBackupReceiptDigest: sha256Digest("prepared-receipt"),
  databaseRestorePointFingerprint: sha256Digest("database-backup"),
};

describe("SK-90 explicit safe CLI boundary", () => {
  it("accepts only the exact challenge-bound prepare observation", () => {
    const databaseFingerprint = sha256Digest("prepare-database");
    const storageFingerprint = sha256Digest("prepare-storage");
    const policy: RehearsalTargetPolicy = {
      targetClass: "isolated_nonproduction",
      database: {
        observed: databaseFingerprint,
        approved: databaseFingerprint,
        forbidden: [
          sha256Digest("forbidden-database-one"),
          sha256Digest("forbidden-database-two"),
        ],
      },
      storage: {
        observed: storageFingerprint,
        approved: storageFingerprint,
        forbidden: [sha256Digest("forbidden-storage")],
      },
      isolation: {
        databaseRestorePointReady: true,
        storageRestorePointReady: true,
        exclusiveStorageNamespace: true,
        exclusiveStorageWriter: true,
      },
    };
    const approvedTarget = assertRehearsalTarget(
      policy,
      rehearsalTargetPolicyDigest(policy),
    );
    const challengeToken = protectValue(
      "cli-prepare-observation-test-hmac-key-at-least-32-bytes",
      "prepare-challenge",
    );
    const request = {
      action: "prepare" as const,
      challengeToken,
      issuedAt: "2026-07-17T10:00:00.000Z",
      expiresAt: "2026-07-17T10:04:00.000Z",
      policy,
    };
    const observation = {
      ...request,
      bindingDigest: challengeBoundTargetObservationDigest(request),
    };
    const expected = {
      challengeToken,
      issuedAt: request.issuedAt,
      expiresAt: request.expiresAt,
      approvedTarget,
    };

    expect(assertExactBackupPreparationObservation(observation, expected)).toBe(
      targetObservationDigest(approvedTarget),
    );
    const wrongAction = { ...request, action: "database_reset" as const };
    expect(() =>
      assertExactBackupPreparationObservation(
        {
          ...wrongAction,
          bindingDigest: challengeBoundTargetObservationDigest(wrongAction),
        },
        expected,
      ),
    ).toThrow(expect.objectContaining({ code: "FRESH_TARGET_AUTHORIZATION_INVALID" }));
    expect(() =>
      assertExactBackupPreparationObservation(
        { ...observation, bindingDigest: sha256Digest("corrupt-binding") },
        expected,
      ),
    ).toThrow(expect.objectContaining({ code: "FRESH_TARGET_AUTHORIZATION_INVALID" }));
    const wrongTime = {
      ...request,
      expiresAt: "2026-07-17T10:03:00.000Z",
    };
    expect(() =>
      assertExactBackupPreparationObservation(
        {
          ...wrongTime,
          bindingDigest: challengeBoundTargetObservationDigest(wrongTime),
        },
        expected,
      ),
    ).toThrow(expect.objectContaining({ code: "FRESH_TARGET_AUTHORIZATION_INVALID" }));
  });

  it("requires exactly one recognized explicit mode", () => {
    expect(parseRunnerMode(["plan"])).toBe("plan");
    expect(parseRunnerMode(["execute"])).toBe("execute");
    expect(parseRunnerMode(["resume"])).toBe("resume");
    expect(parseRunnerMode(["restore"])).toBe("restore");
    expect(parseRunnerMode([])).toBeNull();
    expect(parseRunnerMode(["execute", "extra"])).toBeNull();
    expect(parseRunnerMode(["production-reset"])).toBeNull();
  });

  it("performs zero runner construction or external work with no explicit mode", async () => {
    const events: SafeCliEvent[] = [];
    const createRunner = vi.fn();
    expect(
      await runSk90ResetCli([], {
        createRunner,
        reporter: { emit: (event) => events.push(event) },
      }),
    ).toBe(2);
    expect(createRunner).not.toHaveBeenCalled();
    expect(events).toEqual([
      {
        kind: "error",
        error: {
          ok: false,
          code: "PHASE_STATE_INVALID",
          message: "The reset phase journal and observed state do not agree.",
        },
      },
    ]);
  });

  it.each(["plan", "execute", "resume", "restore"] as const)(
    "constructs and invokes the runner only for explicit %s mode",
    async (mode: RunnerMode) => {
      const events: SafeCliEvent[] = [];
      const run = vi.fn(() => Promise.resolve(RESULT));
      const createRunner = vi.fn(() => Promise.resolve({ run }));
      expect(
        await runSk90ResetCli([mode], {
          createRunner,
          reporter: { emit: (event) => events.push(event) },
        }),
      ).toBe(0);
      expect(createRunner).toHaveBeenCalledWith(mode);
      expect(run).toHaveBeenCalledWith(mode);
      expect(events).toEqual([{ kind: "success", mode, result: RESULT }]);
    },
  );

  it("runs the distinct preapproval backup stage without constructing a reset runner", async () => {
    const events: SafeCliEvent[] = [];
    const createRunner = vi.fn();
    const prepareBackup = vi.fn(() => Promise.resolve(PREPARED_BACKUP_RESULT));

    expect(
      await runSk90ResetCli(["prepare-backup"], {
        createRunner,
        prepareBackup,
        reporter: { emit: (event) => events.push(event) },
      }),
    ).toBe(0);
    expect(createRunner).not.toHaveBeenCalled();
    expect(prepareBackup).toHaveBeenCalledOnce();
    expect(events).toEqual([
      { kind: "success", mode: "prepare-backup", result: PREPARED_BACKUP_RESULT },
    ]);
  });

  it("drops unknown error messages before reporting", async () => {
    const privateValue = "postgres://secret@host/private/raw-object-key";
    const lines: string[] = [];
    const exitCode = await runSk90ResetCli(["execute"], {
      createRunner: () =>
        Promise.resolve({
          run: () => Promise.reject(new Error(privateValue)),
        }),
      reporter: createSafeJsonCliReporter((line) => lines.push(line)),
    });
    expect(exitCode).toBe(1);
    expect(lines.join("\n")).not.toContain(privateValue);
    expect(lines.join("\n")).toContain("UNEXPECTED_FAILURE");
  });

  it("closes the first pool when later client construction fails", async () => {
    const scope = new ExecutableResourceScope();
    const end = vi.fn(() => Promise.resolve());
    const constructionError = new Error("second pool failed");

    await expect(
      constructWithExecutableResourceCleanup(scope, () => {
        scope.trackPool({ end });
        return Promise.reject(constructionError);
      }),
    ).rejects.toBe(constructionError);
    expect(end).toHaveBeenCalledOnce();
  });

  it("attempts every cleanup and preserves a construction failure", async () => {
    const scope = new ExecutableResourceScope();
    const firstEnd = vi.fn(() => Promise.reject(new Error("private pool failure")));
    const secondEnd = vi.fn(() => Promise.resolve());
    const destroy = vi.fn(() => {
      throw new Error("private storage failure");
    });
    const constructionError = new Sk90ResetSafetyError("TARGET_POLICY_MISMATCH");

    await expect(
      constructWithExecutableResourceCleanup(scope, () => {
        scope.trackPool({ end: firstEnd });
        scope.trackPool({ end: secondEnd });
        scope.trackStorageClient({ destroy });
        return Promise.reject(constructionError);
      }),
    ).rejects.toBe(constructionError);
    expect(firstEnd).toHaveBeenCalledOnce();
    expect(secondEnd).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("preserves the runner failure even when cleanup also fails", async () => {
    const scope = new ExecutableResourceScope();
    const end = vi.fn(() => Promise.reject(new Error("private cleanup failure")));
    const runnerError = new Sk90ResetSafetyError("DATABASE_VERIFICATION_MISMATCH");
    scope.trackPool({ end });

    await expect(
      runWithExecutableResourceCleanup(scope, () => Promise.reject(runnerError)),
    ).rejects.toBe(runnerError);
    expect(end).toHaveBeenCalledOnce();
  });

  it("reports a sanitized failure when only successful-run cleanup fails", async () => {
    const scope = new ExecutableResourceScope();
    scope.trackPool({ end: () => Promise.reject(new Error("private cleanup failure")) });

    await expect(
      runWithExecutableResourceCleanup(scope, () => Promise.resolve(RESULT)),
    ).rejects.toMatchObject({ code: "UNEXPECTED_FAILURE" });
  });
});
