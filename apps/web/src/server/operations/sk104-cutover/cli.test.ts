import { describe, expect, it, vi } from "vitest";

import { protectValue, sha256Digest } from "../sk90-reset/canonical";
import type { NeonPoolClientLike } from "../sk90-reset/database-adapter";
import {
  createSk104SafeJsonReporter,
  parseSk104CutoverMode,
  runSk104CutoverCli,
  type Sk104SafeCliEvent,
} from "./cli";
import {
  createExecutableSk104ProductionCutoverRunner,
  createFixedSk104MigrationPort,
  type Sk104ExecutableRuntime,
} from "./index";
import {
  SK104_CUTOVER_ENV,
  SK104_MOCK_TEST_ATTESTATION,
  SK104_OPERATOR_CONFIRMATION,
  type Sk104CutoverMode,
} from "./environment";
import {
  SK104_CANONICAL_DATABASE_FINGERPRINT,
  SK104_FROZEN_DATABASE_FINGERPRINT,
} from "./target-observer";
import { SK104_APPROVED_MIGRATION_FILES } from "./database";

const modes: readonly Sk104CutoverMode[] = [
  "inspect",
  "prepare-backup",
  "plan",
  "authorize-execute",
  "authorize-restore",
  "execute",
  "resume",
  "restore",
];

function inspectEnvironment(): Record<string, string> {
  return {
    [SK104_CUTOVER_ENV.targetClass]: "canonical_production",
    [SK104_CUTOVER_ENV.targetDatabaseUrl]:
      "postgresql://private-user:private-password@ep-canonical-production.us-east-2.aws.neon.tech/production?sslmode=require",
    [SK104_CUTOVER_ENV.approvedDatabaseFingerprint]: SK104_CANONICAL_DATABASE_FINGERPRINT,
    [SK104_CUTOVER_ENV.forbiddenDatabaseFingerprint]: SK104_FROZEN_DATABASE_FINGERPRINT,
    [SK104_CUTOVER_ENV.targetSchemaFingerprint]: sha256Digest("target-schema"),
    [SK104_CUTOVER_ENV.approvedStorageFingerprint]: sha256Digest("canonical-storage"),
    [SK104_CUTOVER_ENV.forbiddenStorageFingerprint]: sha256Digest("forbidden-storage"),
    [SK104_CUTOVER_ENV.manifestHmacKey]: "test-only-production-manifest-key-32-bytes",
    [SK104_CUTOVER_ENV.approvalPolicyDigest]: sha256Digest("production-policy"),
    [SK104_CUTOVER_ENV.storageEndpoint]:
      "https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.r2.cloudflarestorage.com",
    [SK104_CUTOVER_ENV.storageAccessKeyId]: "production-access-key",
    [SK104_CUTOVER_ENV.storageSecretAccessKey]: "production-secret-access-key-with-32-bytes",
    [SK104_CUTOVER_ENV.storageAudioBucket]: "skitza-audio-production",
    [SK104_CUTOVER_ENV.storageDocsBucket]: "skitza-docs-production",
    [SK104_CUTOVER_ENV.storageRecoveryPrefix]: "sk104-cutover/approved-snapshot/recovery",
    [SK104_CUTOVER_ENV.privateApprovalFile]: "/private/sk104/approval.json",
    [SK104_CUTOVER_ENV.privateApprovalLedgerDirectory]: "/private/sk104-ledger",
    [SK104_CUTOVER_ENV.privateStateDirectory]: "/private/sk104-state",
    [SK104_CUTOVER_ENV.pgDumpBinary]: "/usr/local/bin/pg_dump",
    [SK104_CUTOVER_ENV.pgRestoreBinary]: "/usr/local/bin/pg_restore",
    [SK104_CUTOVER_ENV.psqlBinary]: "/usr/local/bin/psql",
    [SK104_CUTOVER_ENV.operatorConfirmation]: SK104_OPERATOR_CONFIRMATION,
    [SK104_CUTOVER_ENV.mockTestAttestation]: SK104_MOCK_TEST_ATTESTATION,
    [SK104_CUTOVER_ENV.releaseCommit]: "a".repeat(40),
  };
}

describe("SK-104 cutover CLI", () => {
  it("accepts exactly one exact mode", () => {
    for (const mode of modes) expect(parseSk104CutoverMode([mode])).toBe(mode);
    for (const arguments_ of [[], ["inspect", "plan"], ["INSPECT"], [" inspect"]]) {
      expect(parseSk104CutoverMode(arguments_)).toBeNull();
    }
  });

  it("does no construction for invalid arguments and emits only a safe error", async () => {
    const events: Sk104SafeCliEvent[] = [];
    const createRunner = vi.fn();
    await expect(
      runSk104CutoverCli([], {
        createRunner,
        reporter: { emit: (event) => events.push(event) },
      }),
    ).resolves.toBe(2);
    expect(createRunner).not.toHaveBeenCalled();
    expect(events).toEqual([
      {
        kind: "error",
        error: {
          code: "PHASE_STATE_INVALID",
          message: "The reset phase journal and observed state do not agree.",
        },
      },
    ]);
  });

  it("redacts unknown failures and serializes only the safe event", async () => {
    const privateValue = "postgresql://secret-user:secret-password@private.invalid/live";
    const lines: string[] = [];
    const exitCode = await runSk104CutoverCli(["inspect"], {
      createRunner: () => Promise.reject(new Error(privateValue)),
      reporter: createSk104SafeJsonReporter((line) => lines.push(line)),
    });
    expect(exitCode).toBe(1);
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain(privateValue);
    expect(JSON.parse(lines[0] ?? "null")).toEqual({
      kind: "error",
      error: {
        code: "UNEXPECTED_FAILURE",
        message: "The reset safety check failed without exposing private details.",
      },
    });
  });

  it("binds the exact migration tuple and module approval before applying", async () => {
    const bundleDigest = sha256Digest("fixed-0027-0034-bundle");
    const createApproval = vi.fn((input: unknown) => ({ input }));
    const apply = vi.fn(() => Promise.resolve());
    const port = createFixedSk104MigrationPort({
      module: {
        APPROVED_CUTOVER_BUNDLE_DIGEST: bundleDigest,
        createSk104ProductionAdapterApproval: createApproval,
        applyApprovedCutoverBundleInTransaction: apply,
      },
      migrationDirectory: "/private/repository/packages/db/drizzle",
      cutoverFloorContent: "SELECT 'immutable-cutover';\n",
    });
    const binding = {
      artifactDigest: sha256Digest("artifact"),
      manifestDigest: sha256Digest("manifest"),
      policyDigest: sha256Digest("policy"),
      targetDatabaseFingerprint: SK104_CANONICAL_DATABASE_FINGERPRINT,
      canonicalProductionTargetDatabaseFingerprint: SK104_CANONICAL_DATABASE_FINGERPRINT,
      targetObservationDigest: sha256Digest("target-observation"),
      executionApprovalDigest: sha256Digest("execution-approval"),
      freshAuthorizationDigest: sha256Digest("fresh-authorization"),
      migrationBundleDigest: bundleDigest,
      actionChallengeToken: protectValue("test-hmac-key-longer-than-thirty-two-bytes", "challenge"),
    };
    const client = { query: vi.fn(), release: vi.fn() } as unknown as NeonPoolClientLike;

    expect(port.filenames).toEqual(SK104_APPROVED_MIGRATION_FILES);
    expect(port.bundleDigest).toBe(bundleDigest);
    await port.applyApprovedBundleInTransaction(client, binding);
    expect(createApproval).toHaveBeenCalledOnce();
    const approvalInput = createApproval.mock.calls[0]?.[0];
    if (typeof approvalInput !== "object" || approvalInput === null) {
      throw new Error("expected migration approval input");
    }
    const approvalRecord = approvalInput as Record<string, unknown>;
    expect(approvalRecord).toMatchObject({
      ...binding,
      targetClass: "canonical_production",
      filename: "0027_purchase_foundation.sql",
    });
    expect(approvalRecord.migrationDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(apply).toHaveBeenCalledWith(
      client,
      "/private/repository/packages/db/drizzle",
      expect.any(Object),
      binding,
    );
    await expect(
      port.applyApprovedBundleInTransaction(client, {
        ...binding,
        migrationBundleDigest: sha256Digest("wrong-bundle"),
      }),
    ).rejects.toThrow(expect.objectContaining({ code: "MIGRATION_DIGEST_MISMATCH" }));
    expect(apply).toHaveBeenCalledOnce();
  });

  it("loads only local migration inputs and leaves Neon and R2 uncreated until used", async () => {
    const createPool = vi.fn();
    const createStorageClient = vi.fn();
    const runtime: Sk104ExecutableRuntime = {
      environment: inspectEnvironment(),
      loadMigrationModule: () =>
        Promise.resolve({
          APPROVED_CUTOVER_BUNDLE_DIGEST: sha256Digest("fixed-bundle"),
          createSk104ProductionAdapterApproval: vi.fn(),
          applyApprovedCutoverBundleInTransaction: vi.fn(),
        }),
      readCutoverFloor: () => Promise.resolve("SELECT 'cutover';\n"),
      migrationDirectory: "/private/repository/packages/db/drizzle",
      createPool,
      createStorageClient,
      now: () => new Date("2026-07-22T10:00:00.000Z"),
      randomNonce: () => "a".repeat(64),
    };

    await createExecutableSk104ProductionCutoverRunner("inspect", runtime);
    expect(createPool).not.toHaveBeenCalled();
    expect(createStorageClient).not.toHaveBeenCalled();
  });
});
