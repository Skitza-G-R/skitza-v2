import { describe, expect, it } from "vitest";

import { sha256Digest } from "../sk90-reset/canonical";
import {
  SK104_CUTOVER_ENV,
  SK104_MOCK_TEST_ATTESTATION,
  SK104_NO_WRITER_CONFIRMATION,
  SK104_OPERATOR_CONFIRMATION,
  Sk104CutoverSafetyError,
  readSk104CutoverEnvironment,
} from "./environment";
import {
  SK104_CANONICAL_DATABASE_FINGERPRINT,
  SK104_FROZEN_DATABASE_FINGERPRINT,
} from "./target-observer";

function exactEnvironment(includeExecutionApproval = true): Record<string, string> {
  const environment: Record<string, string> = {
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
  if (includeExecutionApproval) {
    environment[SK104_CUTOVER_ENV.approvedExecutionDigest] = sha256Digest("execution");
    environment[SK104_CUTOVER_ENV.noWriterConfirmation] = SK104_NO_WRITER_CONFIRMATION;
  }
  return environment;
}

describe("SK-104 production-cutover environment", () => {
  it("accepts only the dedicated canonical-production boundary", () => {
    const config = readSk104CutoverEnvironment(exactEnvironment(), "execute");

    expect(config.targetClass).toBe("canonical_production");
    expect(config.approvedDatabaseFingerprint).toBe(SK104_CANONICAL_DATABASE_FINGERPRINT);
    expect(config.forbiddenDatabaseFingerprint).toBe(SK104_FROZEN_DATABASE_FINGERPRINT);
    expect(config.storage.recoveryPrefix).toBe("sk104-cutover/approved-snapshot/recovery/");
    expect(config.approvedExecutionDigest).toBe(sha256Digest("execution"));
    expect(config.psqlBinary).toBe("/usr/local/bin/psql");
    expect(Object.values(SK104_CUTOVER_ENV).every((name) => name.startsWith("SK104_"))).toBe(true);
  });

  it("requires a dedicated absolute psql binary", () => {
    const missing: Record<string, string | undefined> = exactEnvironment();
    missing[SK104_CUTOVER_ENV.psqlBinary] = undefined;
    expect(() => readSk104CutoverEnvironment(missing, "execute")).toThrow(
      expect.objectContaining({ code: "SK104_ENV_MISSING" }),
    );

    const relative = exactEnvironment();
    relative[SK104_CUTOVER_ENV.psqlBinary] = "bin/psql";
    expect(() => readSk104CutoverEnvironment(relative, "execute")).toThrow(
      expect.objectContaining({ code: "SK104_ENV_INVALID" }),
    );
  });

  it("rejects pooled and arbitrary database hosts", () => {
    for (const target of [
      "postgresql://private-user:private-password@ep-canonical-production-pooler.us-east-2.aws.neon.tech/production?sslmode=require",
      "postgresql://private-user:private-password@canonical.invalid/production?sslmode=require",
      "postgresql://private-user:private-password@ep-canonical-production.us-east-2.aws.neon.tech/production?sslmode=require&host=ep-bypass-pooler.us-east-2.aws.neon.tech",
    ]) {
      const environment = exactEnvironment();
      environment[SK104_CUTOVER_ENV.targetDatabaseUrl] = target;
      expect(() => readSk104CutoverEnvironment(environment, "execute")).toThrow(
        expect.objectContaining({ code: "SK104_ENV_INVALID" }),
      );
    }
  });

  it("keeps inspection and backup preparation separate from execution approval", () => {
    expect(
      readSk104CutoverEnvironment(exactEnvironment(false), "inspect").approvedExecutionDigest,
    ).toBeNull();
    expect(
      readSk104CutoverEnvironment(exactEnvironment(false), "prepare-backup")
        .approvedExecutionDigest,
    ).toBeNull();
    expect(
      readSk104CutoverEnvironment(exactEnvironment(false), "plan").approvedExecutionDigest,
    ).toBeNull();
    expect(() => readSk104CutoverEnvironment(exactEnvironment(false), "execute")).toThrow(
      expect.objectContaining({ code: "SK104_ENV_INVALID" }),
    );
    expect(() => readSk104CutoverEnvironment(exactEnvironment(), "inspect")).toThrow(
      expect.objectContaining({ code: "SK104_ENV_INVALID" }),
    );
  });

  it("rejects ambient selectors, a non-production class, and the wrong operator phrase", () => {
    expect(() =>
      readSk104CutoverEnvironment(
        { ...exactEnvironment(), DATABASE_URL: "postgresql://inherited.invalid/db" },
        "execute",
      ),
    ).toThrow(expect.objectContaining({ code: "SK104_AMBIENT_ENV_FORBIDDEN" }));

    expect(() =>
      readSk104CutoverEnvironment(
        { ...exactEnvironment(), [SK104_CUTOVER_ENV.targetClass]: "isolated_nonproduction" },
        "execute",
      ),
    ).toThrow(expect.objectContaining({ code: "SK104_ENV_INVALID" }));

    expect(() =>
      readSk104CutoverEnvironment(
        { ...exactEnvironment(), [SK104_CUTOVER_ENV.operatorConfirmation]: "yes" },
        "execute",
      ),
    ).toThrow(expect.objectContaining({ code: "SK104_ENV_INVALID" }));
  });

  it("requires distinct approved and forbidden targets plus separate private paths", () => {
    const substitutedDatabase = exactEnvironment();
    substitutedDatabase[SK104_CUTOVER_ENV.approvedDatabaseFingerprint] = sha256Digest(
      "substituted-production-database",
    );
    expect(() => readSk104CutoverEnvironment(substitutedDatabase, "execute")).toThrow(
      expect.objectContaining({ code: "SK104_ENV_INVALID" }),
    );

    const sameDatabase = exactEnvironment();
    sameDatabase[SK104_CUTOVER_ENV.forbiddenDatabaseFingerprint] =
      sameDatabase[SK104_CUTOVER_ENV.approvedDatabaseFingerprint] ?? "";
    expect(() => readSk104CutoverEnvironment(sameDatabase, "execute")).toThrow(
      expect.objectContaining({ code: "SK104_ENV_INVALID" }),
    );

    const nestedState = exactEnvironment();
    nestedState[SK104_CUTOVER_ENV.privateStateDirectory] = "/private/sk104-ledger/state";
    expect(() => readSk104CutoverEnvironment(nestedState, "execute")).toThrow(
      expect.objectContaining({ code: "SK104_ENV_INVALID" }),
    );

    const nestedApprovalFile = exactEnvironment();
    nestedApprovalFile[SK104_CUTOVER_ENV.privateApprovalFile] =
      "/private/sk104-state/approval.json";
    expect(() => readSk104CutoverEnvironment(nestedApprovalFile, "execute")).toThrow(
      expect.objectContaining({ code: "SK104_ENV_INVALID" }),
    );
  });

  it("never places a secret input in an error", () => {
    const privateValue = "do-not-expose-this-private-value";
    let error: unknown;
    try {
      readSk104CutoverEnvironment(
        {
          ...exactEnvironment(),
          [SK104_CUTOVER_ENV.targetDatabaseUrl]: privateValue,
        },
        "execute",
      );
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Sk104CutoverSafetyError);
    expect(String(error)).not.toContain(privateValue);
  });
});
