import {
  appendFile,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rmdir,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { sha256Digest } from "../sk90-reset/canonical";
import {
  bindSk104ProductionTarget,
  buildSk104ProductionManifest,
  sk104ProductionTargetPolicyDigest,
} from "./contract";
import {
  parseSk104PgRestoreList,
  prepareSk104DatabaseBackup,
  sk104DatabaseBackupArchivePath,
  sk104LibpqEnvironment,
  sk104PublicSchemaRestorePrelude,
  restoreSk104DatabaseBackup,
  type Sk104DatabaseBackupRuntime,
  verifySk104DatabaseBackup,
} from "./backup";
import {
  SK104_CANONICAL_DATABASE_FINGERPRINT,
  SK104_FROZEN_DATABASE_FINGERPRINT,
} from "./target-observer";
import { SK104_CHILD_RESTORE_ADVISORY_LOCK_KEY } from "./database";

const HMAC_KEY = "sk104-database-backup-test-key-long-enough";
const PARENT_PROOF_LOCK = "1234567890123456789";

function manifest() {
  const boundary = {
    targetClass: "canonical_production" as const,
    approvedDatabaseFingerprint: SK104_CANONICAL_DATABASE_FINGERPRINT,
    forbiddenDatabaseFingerprint: SK104_FROZEN_DATABASE_FINGERPRINT,
    approvedStorageFingerprint: sha256Digest("approved-storage"),
    forbiddenStorageFingerprint: sha256Digest("forbidden-storage"),
  };
  const target = bindSk104ProductionTarget(boundary, sk104ProductionTargetPolicyDigest(boundary));
  return buildSk104ProductionManifest({
    target,
    sourceSchemaFingerprint: sha256Digest("source"),
    targetSchemaFingerprint: sha256Digest("target"),
    resetRowsFingerprint: sha256Digest("rows"),
    preservedRowCountsFingerprint: sha256Digest("counts"),
    preservedBusinessFingerprint: sha256Digest("business"),
    storageReferencesFingerprint: sha256Digest("refs"),
    storageEnumerationFingerprint: sha256Digest("objects"),
    mockEvidenceFingerprint: sha256Digest("mock"),
  });
}

describe("SK-104 production database backup", () => {
  it("binds one owner-only pg_dump archive to the verified snapshot and manifest", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sk104-backup-"));
    await chmod(directory, 0o700);
    const runPgDump = vi.fn(async ({ archivePath }: { archivePath: string }) => {
      await appendFile(archivePath, Buffer.from("PGDMPtest-archive"));
    });
    const verifyPgRestoreList = vi.fn(() =>
      Promise.resolve({ archiveCreatesPublicSchema: true as const }),
    );
    const activeManifest = manifest();
    const receipt = await prepareSk104DatabaseBackup({
      manifest: activeManifest,
      targetDatabaseFingerprint: SK104_CANONICAL_DATABASE_FINGERPRINT,
      targetDatabaseUrl: "postgresql://private.invalid/database",
      privateBackupDirectory: directory,
      pgDumpBinary: "/private/bin/pg_dump",
      pgRestoreBinary: "/private/bin/pg_restore",
      hmacKey: HMAC_KEY,
      preparedAt: "2026-07-22T10:00:00.000Z",
      snapshotPort: {
        withVerifiedExportedSnapshot: (useSnapshot) => useSnapshot("private-snapshot"),
      },
      runtime: { runPgDump, verifyPgRestoreList, runPgRestore: vi.fn() },
    });

    expect(runPgDump).toHaveBeenCalledOnce();
    expect(verifyPgRestoreList).toHaveBeenCalledTimes(2);
    expect(receipt.archiveCreatesPublicSchema).toBe(true);
    expect(JSON.stringify(receipt)).not.toContain("private-snapshot");
    await expect(
      prepareSk104DatabaseBackup({
        manifest: activeManifest,
        targetDatabaseFingerprint: SK104_CANONICAL_DATABASE_FINGERPRINT,
        targetDatabaseUrl: "postgresql://private.invalid/database",
        privateBackupDirectory: directory,
        pgDumpBinary: "/private/bin/pg_dump",
        pgRestoreBinary: "/private/bin/pg_restore",
        hmacKey: HMAC_KEY,
        preparedAt: "2026-07-22T10:01:00.000Z",
        snapshotPort: {
          withVerifiedExportedSnapshot: () =>
            Promise.reject(new Error("an existing verified backup must be reused")),
        },
        runtime: { runPgDump, verifyPgRestoreList, runPgRestore: vi.fn() },
      }),
    ).resolves.toEqual(receipt);
    expect(runPgDump).toHaveBeenCalledOnce();
    await expect(
      verifySk104DatabaseBackup({
        manifest: activeManifest,
        privateBackupDirectory: directory,
        hmacKey: HMAC_KEY,
      }),
    ).resolves.toEqual(receipt);
  });

  it("fails before dump for a non-canonical target", async () => {
    const runPgDump = vi.fn();
    await expect(
      prepareSk104DatabaseBackup({
        manifest: manifest(),
        targetDatabaseFingerprint: SK104_FROZEN_DATABASE_FINGERPRINT,
        targetDatabaseUrl: "postgresql://private.invalid/database",
        privateBackupDirectory: await mkdtemp(join(tmpdir(), "sk104-backup-")),
        pgDumpBinary: "/private/bin/pg_dump",
        pgRestoreBinary: "/private/bin/pg_restore",
        hmacKey: HMAC_KEY,
        preparedAt: "2026-07-22T10:00:00.000Z",
        snapshotPort: { withVerifiedExportedSnapshot: vi.fn() },
        runtime: {
          runPgDump,
          verifyPgRestoreList: vi.fn(() =>
            Promise.resolve({ archiveCreatesPublicSchema: false as const }),
          ),
          runPgRestore: vi.fn(),
        },
      }),
    ).rejects.toMatchObject({ code: "SK104_TARGET_INVALID" });
    expect(runPgDump).not.toHaveBeenCalled();
  });

  it("replaces public atomically from the exact verified archive", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sk104-backup-"));
    await chmod(directory, 0o700);
    const activeManifest = manifest();
    const runtime: Sk104DatabaseBackupRuntime = {
      runPgDump: vi.fn(async ({ archivePath }: { archivePath: string }) => {
        await appendFile(archivePath, Buffer.from("PGDMPtest-archive"));
      }),
      verifyPgRestoreList: vi.fn(() =>
        Promise.resolve({ archiveCreatesPublicSchema: false as const }),
      ),
      runPgRestore: vi.fn(
        async (
          input: Parameters<Sk104DatabaseBackupRuntime["runPgRestore"]>[0],
        ) => {
          await input.assertAuthorizationFresh();
        },
      ),
    };
    const common = {
      manifest: activeManifest,
      targetDatabaseFingerprint: SK104_CANONICAL_DATABASE_FINGERPRINT,
      targetDatabaseUrl: "postgresql://private.invalid/database",
      privateBackupDirectory: directory,
      pgRestoreBinary: "/private/bin/pg_restore",
      psqlBinary: "/private/bin/psql",
      parentProofAdvisoryLockKey: PARENT_PROOF_LOCK,
      assertAuthorizationFresh: vi.fn(),
      hmacKey: HMAC_KEY,
      runtime,
    };
    await prepareSk104DatabaseBackup({
      ...common,
      pgDumpBinary: "/private/bin/pg_dump",
      preparedAt: "2026-07-22T10:00:00.000Z",
      snapshotPort: {
        withVerifiedExportedSnapshot: async (useSnapshot) => useSnapshot("private-snapshot"),
      },
    });
    const receipt = await restoreSk104DatabaseBackup({
      ...common,
      restoredAt: "2026-07-22T10:04:00.000Z",
    });
    expect(runtime.runPgRestore).toHaveBeenCalledOnce();
    expect(vi.mocked(runtime.runPgRestore).mock.calls[0]?.[0]).toMatchObject({
      pgRestoreBinary: "/private/bin/pg_restore",
      psqlBinary: "/private/bin/psql",
      databaseUrl: "postgresql://private.invalid/database",
      archivePath: sk104DatabaseBackupArchivePath(directory, activeManifest.digest),
      archiveCreatesPublicSchema: false,
      expectedDatabaseName: "database",
      parentProofAdvisoryLockKey: PARENT_PROOF_LOCK,
    });
    expect(typeof vi.mocked(runtime.runPgRestore).mock.calls[0]?.[0].assertAuthorizationFresh).toBe(
      "function",
    );
    expect(common.assertAuthorizationFresh).toHaveBeenCalledTimes(1);
    expect(receipt.backupRestorePointFingerprint).toMatch(/^sha256:/);
  });

  it("recognizes only the exact public SCHEMA archive entry", () => {
    expect(
      parseSk104PgRestoreList(
        [
          "; Archive created at 2026-07-22",
          "5; 2615 2200 SCHEMA - public owner",
          "6; 0 0 ACL - SCHEMA public owner",
        ].join("\n"),
      ),
    ).toEqual({ archiveCreatesPublicSchema: true });
    expect(parseSk104PgRestoreList("6; 0 0 ACL - SCHEMA public owner\n")).toEqual({
      archiveCreatesPublicSchema: false,
    });
    expect(() =>
      parseSk104PgRestoreList(
        "5; 2615 2200 SCHEMA - public owner\n7; 2615 2200 SCHEMA - public owner\n",
      ),
    ).toThrow(expect.objectContaining({ code: "SK104_CONTRACT_INVALID" }));
  });

  it("passes connection fields to libpq without treating the private URL as a database name", () => {
    expect(
      sk104LibpqEnvironment(
        "postgresql://owner%40example:p%40ssword@database.invalid:6432/production?sslmode=require&channel_binding=require",
      ),
    ).toEqual({
      LC_ALL: "C",
      LANG: "C",
      NODE_ENV: "production",
      PGHOST: "database.invalid",
      PGPORT: "6432",
      PGUSER: "owner@example",
      PGPASSWORD: "p@ssword",
      PGDATABASE: "production",
      PGSSLMODE: "require",
      PGCHANNELBINDING: "require",
    });
    expect(() =>
      sk104LibpqEnvironment(
        "postgresql://owner:password@database.invalid/production?application_name=unsafe",
      ),
    ).toThrow(expect.objectContaining({ code: "SK104_ENV_INVALID" }));
  });

  it("leaves an incomplete orphan untouched and publishes a fresh independent archive", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sk104-backup-"));
    await chmod(directory, 0o700);
    const activeManifest = manifest();
    let stagingArchivePath = "";
    const firstRuntime = {
      runPgDump: vi.fn(async ({ archivePath }: { archivePath: string }) => {
        stagingArchivePath = archivePath;
        expect(
          (await readdir(directory)).some((name) => name.endsWith("backup-staging.json")),
        ).toBe(true);
        await appendFile(archivePath, Buffer.from("PGDMPcompleted-orphan-stage"));
      }),
      verifyPgRestoreList: vi.fn(() => Promise.reject(new Error("simulated parent loss"))),
      runPgRestore: vi.fn(),
    };
    const common = {
      manifest: activeManifest,
      targetDatabaseFingerprint: SK104_CANONICAL_DATABASE_FINGERPRINT,
      targetDatabaseUrl: "postgresql://private.invalid/database",
      privateBackupDirectory: directory,
      pgDumpBinary: "/private/bin/pg_dump",
      pgRestoreBinary: "/private/bin/pg_restore",
      hmacKey: HMAC_KEY,
      preparedAt: "2026-07-22T10:00:00.000Z",
    };
    await expect(
      prepareSk104DatabaseBackup({
        ...common,
        snapshotPort: {
          withVerifiedExportedSnapshot: (useSnapshot) => useSnapshot("private-snapshot"),
        },
        runtime: firstRuntime,
      }),
    ).rejects.toThrow("simulated parent loss");
    expect(stagingArchivePath).not.toBe("");
    const orphanBefore = await readFile(stagingArchivePath);
    const orphanInode = (await stat(stagingArchivePath)).ino;
    expect(await readdir(directory)).not.toContain(
      basename(sk104DatabaseBackupArchivePath(directory, activeManifest.digest)),
    );

    const retryRuntime = {
      runPgDump: vi.fn(async ({ archivePath }: { archivePath: string }) => {
        expect(archivePath).not.toBe(stagingArchivePath);
        await appendFile(archivePath, Buffer.from("PGDMPfresh-retry-stage"));
      }),
      verifyPgRestoreList: vi.fn(() =>
        Promise.resolve({ archiveCreatesPublicSchema: false as const }),
      ),
      runPgRestore: vi.fn(),
    };
    const receipt = await prepareSk104DatabaseBackup({
      ...common,
      snapshotPort: {
        withVerifiedExportedSnapshot: (useSnapshot) => useSnapshot("fresh-private-snapshot"),
      },
      runtime: retryRuntime,
    });
    expect(retryRuntime.runPgDump).toHaveBeenCalledOnce();
    expect(retryRuntime.verifyPgRestoreList).toHaveBeenCalledTimes(2);
    expect((await stat(stagingArchivePath)).ino).toBe(orphanInode);
    expect(await readFile(stagingArchivePath)).toEqual(orphanBefore);

    await appendFile(stagingArchivePath, Buffer.from("orphan-wrote-late"));
    await expect(
      verifySk104DatabaseBackup({
        manifest: activeManifest,
        privateBackupDirectory: directory,
        hmacKey: HMAC_KEY,
      }),
    ).resolves.toEqual(receipt);
  });

  it("finalizes a completed bound stage after a receipt-publication crash", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sk104-backup-"));
    await chmod(directory, 0o700);
    const activeManifest = manifest();
    const finalArchive = sk104DatabaseBackupArchivePath(directory, activeManifest.digest);
    const receiptPath = finalArchive.replace(/\.dump$/, ".backup.json");
    let inspectionCalls = 0;
    const firstRuntime = {
      runPgDump: vi.fn(async ({ archivePath }: { archivePath: string }) => {
        await appendFile(archivePath, Buffer.from("PGDMPcompleted-bound-stage"));
      }),
      verifyPgRestoreList: vi.fn(async () => {
        inspectionCalls += 1;
        if (inspectionCalls === 2) await mkdir(receiptPath);
        return { archiveCreatesPublicSchema: true as const };
      }),
      runPgRestore: vi.fn(),
    };
    const common = {
      manifest: activeManifest,
      targetDatabaseFingerprint: SK104_CANONICAL_DATABASE_FINGERPRINT,
      targetDatabaseUrl: "postgresql://private.invalid/database",
      privateBackupDirectory: directory,
      pgDumpBinary: "/private/bin/pg_dump",
      pgRestoreBinary: "/private/bin/pg_restore",
      hmacKey: HMAC_KEY,
      preparedAt: "2026-07-22T10:00:00.000Z",
    };
    await expect(
      prepareSk104DatabaseBackup({
        ...common,
        snapshotPort: {
          withVerifiedExportedSnapshot: (useSnapshot) => useSnapshot("private-snapshot"),
        },
        runtime: firstRuntime,
      }),
    ).rejects.toBeDefined();
    await rmdir(receiptPath);

    const retryRuntime = {
      runPgDump: vi.fn(),
      verifyPgRestoreList: vi.fn(() =>
        Promise.resolve({ archiveCreatesPublicSchema: true as const }),
      ),
      runPgRestore: vi.fn(),
    };
    await expect(
      prepareSk104DatabaseBackup({
        ...common,
        snapshotPort: {
          withVerifiedExportedSnapshot: () =>
            Promise.reject(new Error("completed stage must not request another snapshot")),
        },
        runtime: retryRuntime,
      }),
    ).resolves.toMatchObject({ archiveCreatesPublicSchema: true });
    expect(retryRuntime.runPgDump).not.toHaveBeenCalled();
    expect(retryRuntime.verifyPgRestoreList).toHaveBeenCalledTimes(2);
  });

  it("drops public in one transaction and creates it only when absent from the archive", () => {
    const withoutSchema = sk104PublicSchemaRestorePrelude({
      archiveCreatesPublicSchema: false,
      expectedDatabaseName: "database",
      parentProofAdvisoryLockKey: PARENT_PROOF_LOCK,
    });
    const withSchema = sk104PublicSchemaRestorePrelude({
      archiveCreatesPublicSchema: true,
      expectedDatabaseName: "database",
      parentProofAdvisoryLockKey: PARENT_PROOF_LOCK,
    });
    for (const sql of [withoutSchema, withSchema]) {
      expect(sql).toContain("BEGIN;\n");
      expect(sql).toContain("current_database() IS DISTINCT FROM 'database'");
      expect(sql).toContain(`pg_try_advisory_xact_lock(${PARENT_PROOF_LOCK})`);
      expect(sql).toContain(`pg_try_advisory_xact_lock(${SK104_CHILD_RESTORE_ADVISORY_LOCK_KEY})`);
      expect(sql).toContain("DROP SCHEMA IF EXISTS skitza_migrations CASCADE;");
      expect(sql).toContain("DROP SCHEMA IF EXISTS public CASCADE;");
      expect(
        sql.indexOf(`pg_try_advisory_xact_lock(${SK104_CHILD_RESTORE_ADVISORY_LOCK_KEY})`),
      ).toBeLessThan(sql.indexOf(`pg_try_advisory_xact_lock(${PARENT_PROOF_LOCK})`));
      expect(sql.indexOf(`pg_try_advisory_xact_lock(${PARENT_PROOF_LOCK})`)).toBeLessThan(
        sql.indexOf("current_database()"),
      );
      expect(sql.indexOf("current_database()")).toBeLessThan(
        sql.indexOf("DROP SCHEMA IF EXISTS skitza_migrations"),
      );
    }
    expect(withoutSchema).toContain("CREATE SCHEMA public;\n");
    expect(withSchema).not.toContain("CREATE SCHEMA public;\n");
  });

  it("preserves database ownership and privileges and rechecks approval before restore commit", async () => {
    const implementation = await readFile(new URL("./backup.ts", import.meta.url), "utf8");

    expect(implementation).not.toContain('"--no-owner"');
    expect(implementation).not.toContain('"--no-privileges"');
    expect(implementation).toMatch(
      /for await \(const chunk[\s\S]*await input\.assertAuthorizationFresh\(\);[\s\S]*writeInput\(childInput, "\\nCOMMIT;\\n"\)/,
    );
  });
});
