import { describe, expect, it } from "vitest";

import { sha256Digest } from "./canonical";
import {
  SK90_EXECUTABLE_REHEARSAL_ENV,
  SK90_REHEARSAL_ENV,
  readExecutableRehearsalEnvironment,
} from "./environment";

function exactEnvironment(): Record<string, string> {
  const namespace = "sk90-rehearsal/approved-sandbox";
  return {
    [SK90_REHEARSAL_ENV.targetDatabaseUrl]:
      "postgresql://private-user:private-password@isolated.invalid/rehearsal",
    [SK90_REHEARSAL_ENV.targetDatabaseFingerprint]: sha256Digest("isolated-database"),
    [SK90_REHEARSAL_ENV.targetStorageFingerprint]: sha256Digest("isolated-storage"),
    [SK90_REHEARSAL_ENV.targetStorageNamespace]: namespace,
    [SK90_REHEARSAL_ENV.manifestHmacKey]: "test-only-manifest-key-with-at-least-32-bytes",
    [SK90_REHEARSAL_ENV.approvalPolicyDigest]: sha256Digest("reviewed-policy"),
    [SK90_EXECUTABLE_REHEARSAL_ENV.storageEndpoint]:
      "https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.r2.cloudflarestorage.com",
    [SK90_EXECUTABLE_REHEARSAL_ENV.storageAccessKeyId]: "isolated-access-key",
    [SK90_EXECUTABLE_REHEARSAL_ENV.storageSecretAccessKey]:
      "isolated-secret-access-key-with-32-bytes",
    [SK90_EXECUTABLE_REHEARSAL_ENV.storageAudioBucket]: "sk90-audio-sandbox",
    [SK90_EXECUTABLE_REHEARSAL_ENV.storageDocsBucket]: "sk90-docs-sandbox",
    [SK90_EXECUTABLE_REHEARSAL_ENV.storageDataPrefix]: `${namespace}/data`,
    [SK90_EXECUTABLE_REHEARSAL_ENV.storageRecoveryPrefix]: `${namespace}/recovery`,
    [SK90_EXECUTABLE_REHEARSAL_ENV.privateApprovalFile]: "/private/sk90/approval.json",
    [SK90_EXECUTABLE_REHEARSAL_ENV.privateApprovalLedgerDirectory]:
      "/private/sk90/approval-ledger",
    [SK90_EXECUTABLE_REHEARSAL_ENV.privateStateDirectory]: "/private/sk90/state",
    [SK90_EXECUTABLE_REHEARSAL_ENV.pgDumpBinary]: "/usr/local/bin/pg_dump",
    [SK90_EXECUTABLE_REHEARSAL_ENV.pgRestoreBinary]: "/usr/local/bin/pg_restore",
    [SK90_EXECUTABLE_REHEARSAL_ENV.operatorConfirmation]: "isolated-nonproduction-only",
    [SK90_EXECUTABLE_REHEARSAL_ENV.approvedExecutionDigest]: sha256Digest("execution"),
  };
}

function without(environment: Record<string, string>, name: string): Record<string, string> {
  return Object.fromEntries(Object.entries(environment).filter(([key]) => key !== name));
}

describe("SK-90 executable adapter environment", () => {
  it("requires isolated database, dedicated storage, private state, and exact approval inputs", () => {
    const config = readExecutableRehearsalEnvironment(exactEnvironment(), "execute");

    expect(config.storage.audioBucket).toBe("sk90-audio-sandbox");
    expect(config.storage.dataPrefix).toBe("sk90-rehearsal/approved-sandbox/data/");
    expect(config.approvedExecutionDigest).toBe(sha256Digest("execution"));
    expect(config.privateApprovalLedgerDirectory).toBe("/private/sk90/approval-ledger");
  });

  it("requires an approved execution digest before plan can initialize durable state", () => {
    const environment = without(
      exactEnvironment(),
      SK90_EXECUTABLE_REHEARSAL_ENV.approvedExecutionDigest,
    );

    expect(() => readExecutableRehearsalEnvironment(environment, "plan")).toThrow(
      /configuration is missing/i,
    );
  });

  it("requires the preapproval backup stage to run without a reset approval digest", () => {
    const preparationEnvironment = without(
      exactEnvironment(),
      SK90_EXECUTABLE_REHEARSAL_ENV.approvedExecutionDigest,
    );
    const config = readExecutableRehearsalEnvironment(
      preparationEnvironment,
      "prepare-backup",
    );

    expect(config.targetDatabaseFingerprint).toBe(sha256Digest("isolated-database"));
    expect("approvedExecutionDigest" in config).toBe(false);
    expect(() =>
      readExecutableRehearsalEnvironment(exactEnvironment(), "prepare-backup"),
    ).toThrow(/approv/i);
  });

  it("rejects generic PostgreSQL/AWS selectors, shared prefixes, and missing execution approval", () => {
    expect(() =>
      readExecutableRehearsalEnvironment(
        { ...exactEnvironment(), PGHOST: "inherited.invalid" },
        "execute",
      ),
    ).toThrow(/generic connection environment/i);
    expect(() =>
      readExecutableRehearsalEnvironment(
        { ...exactEnvironment(), AWS_ACCESS_KEY_ID: "inherited" },
        "execute",
      ),
    ).toThrow(/generic connection environment/i);

    const samePrefix = exactEnvironment();
    samePrefix[SK90_EXECUTABLE_REHEARSAL_ENV.storageRecoveryPrefix] =
      samePrefix[SK90_EXECUTABLE_REHEARSAL_ENV.storageDataPrefix] ?? "";
    expect(() => readExecutableRehearsalEnvironment(samePrefix, "execute")).toThrow(
      /configuration is invalid/i,
    );

    const sharedLedgerAndState = exactEnvironment();
    sharedLedgerAndState[SK90_EXECUTABLE_REHEARSAL_ENV.privateStateDirectory] =
      sharedLedgerAndState[
        SK90_EXECUTABLE_REHEARSAL_ENV.privateApprovalLedgerDirectory
      ] ?? "";
    expect(() =>
      readExecutableRehearsalEnvironment(sharedLedgerAndState, "execute"),
    ).toThrow(/configuration is invalid/i);

    const substitutedPrefix = exactEnvironment();
    substitutedPrefix[SK90_EXECUTABLE_REHEARSAL_ENV.storageDataPrefix] =
      "sk90-rehearsal/approved-sandbox/substituted-data";
    expect(() => readExecutableRehearsalEnvironment(substitutedPrefix, "execute")).toThrow(
      /configuration is invalid/i,
    );

    const noApproval = without(
      exactEnvironment(),
      SK90_EXECUTABLE_REHEARSAL_ENV.approvedExecutionDigest,
    );
    expect(() => readExecutableRehearsalEnvironment(noApproval, "execute")).toThrow(
      /configuration is missing/i,
    );
  });
});
