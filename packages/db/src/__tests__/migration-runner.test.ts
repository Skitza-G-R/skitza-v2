import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// The production entry point stays plain ESM so Node can execute it without a
// build step. Its exported pure runner functions are exercised with an in-memory
// Neon-shaped client; this test never opens a database connection.
// @ts-expect-error -- apply-migrations.mjs intentionally has no generated declarations.
import * as migrationRunner from "../../apply-migrations.mjs";

const {
  applyMigration,
  applyMigrationInTransaction,
  chat3StructureVerificationStatement,
  createSk90AdapterApproval,
  cutoverFiles,
  databaseUrl,
  migrationDigest,
  splitStatements,
} = migrationRunner;

const CUTOVER_MIGRATION = readFileSync(
  join(process.cwd(), "drizzle", "0027_purchase_foundation.sql"),
  "utf8",
);
const STABLE_OWNERSHIP_MIGRATION = readFileSync(
  join(process.cwd(), "drizzle", "0028_stable_client_ownership.sql"),
  "utf8",
);

function adapterBinding() {
  return {
    artifactDigest: `sha256:${"a".repeat(64)}`,
    actionChallengeToken: `hmac-sha256:${"2".repeat(64)}`,
    executionApprovalDigest: `sha256:${"d".repeat(64)}`,
    freshAuthorizationDigest: `sha256:${"e".repeat(64)}`,
    manifestDigest: `sha256:${"b".repeat(64)}`,
    policyDigest: `sha256:${"c".repeat(64)}`,
    targetDatabaseFingerprint: `sha256:${"f".repeat(64)}`,
    targetObservationDigest: `sha256:${"1".repeat(64)}`,
  };
}

function adapterApprovalFor() {
  return createSk90AdapterApproval({
    ...adapterBinding(),
    filename: "0027_purchase_foundation.sql",
    migrationDigest: migrationDigest(CUTOVER_MIGRATION),
    targetClass: "isolated_nonproduction",
  });
}

type Query = { params: unknown[] | undefined; statement: string };

function fakeSql(
  options: { failStatement?: string; initialDigest?: string; laterMigration?: boolean } = {},
) {
  let relationExists = options.initialDigest !== undefined;
  let digest = options.initialDigest ?? null;
  const transactions: Array<{ options: unknown; queries: Query[] }> = [];

  const sql = (async (statement: string) => {
    if (statement.includes("to_regclass")) {
      return [{ ledger_relation: relationExists ? "internal-ledger" : null }];
    }
    if (statement.includes('SELECT "digest"')) {
      return digest === null ? [] : [{ digest }];
    }
    if (statement.includes('AS "later_migration"')) {
      return options.laterMigration ? [{ later_migration: 1 }] : [];
    }
    throw new Error("unexpected read query");
  }) as ((statement: string, params?: unknown[]) => Promise<unknown[]>) & {
    transaction: (
      factory: (transactionSql: (statement: string, params?: unknown[]) => Query) => Query[],
      options: unknown,
    ) => Promise<void>;
  };

  sql.transaction = async (factory, transactionOptions) => {
    const queries = factory((statement, params) => ({ params, statement }));
    transactions.push({ options: transactionOptions, queries });
    if (
      options.failStatement &&
      queries.some((query) => query.statement.includes(options.failStatement!))
    ) {
      throw new Error("duplicate_object");
    }

    const ledgerInsert = queries.find((query) =>
      query.statement.includes('INSERT INTO "skitza_migrations"."applied"'),
    );
    const nextDigest = ledgerInsert?.params?.[1];
    if (typeof nextDigest !== "string") throw new Error("missing ledger digest");
    relationExists = true;
    digest = nextDigest;
  };

  return {
    sql,
    state: {
      digest: () => digest,
      relationExists: () => relationExists,
      transactions,
    },
  };
}

function concurrentFakeSql() {
  let relationExists = false;
  let digest: string | null = null;
  let migrationExecutions = 0;
  let preflightReads = 0;
  let releasePreflight!: () => void;
  const preflightBarrier = new Promise<void>((resolve) => {
    releasePreflight = resolve;
  });
  let transactionTail = Promise.resolve();
  const transactions: Query[][] = [];

  const sql = (async (statement: string) => {
    if (statement.includes("to_regclass")) {
      if (!relationExists && preflightReads < 2) {
        preflightReads += 1;
        if (preflightReads === 2) releasePreflight();
        await preflightBarrier;
        return [{ ledger_relation: null }];
      }
      return [{ ledger_relation: relationExists ? "internal-ledger" : null }];
    }
    if (statement.includes('SELECT "digest"')) {
      return digest === null ? [] : [{ digest }];
    }
    throw new Error("unexpected concurrent read query");
  }) as ((statement: string, params?: unknown[]) => Promise<unknown[]>) & {
    transaction: (
      factory: (transactionSql: (statement: string, params?: unknown[]) => Query) => Query[],
      options: unknown,
    ) => Promise<void>;
  };

  sql.transaction = async (factory) => {
    const queries = factory((statement, params) => ({ params, statement }));
    transactions.push(queries);
    if (!queries[0]?.statement.includes("pg_advisory_xact_lock")) {
      throw new Error("first_run_catalog_bootstrap_race");
    }
    const previous = transactionTail;
    let releaseTransaction!: () => void;
    transactionTail = new Promise<void>((resolve) => {
      releaseTransaction = resolve;
    });
    await previous;
    try {
      relationExists = true;
      for (const query of queries) {
        if (query.statement.includes("CONCURRENT_MIGRATION_SENTINEL")) {
          const postLockGuard = query.statement.includes("SKITZA_MIGRATION_POST_LOCK_GUARD");
          if (!postLockGuard || digest === null) migrationExecutions += 1;
        }
        if (query.statement.includes('ON CONFLICT ("filename") DO NOTHING') && digest === null) {
          const nextDigest = query.params?.[1];
          if (typeof nextDigest !== "string") throw new Error("missing concurrent digest");
          digest = nextDigest;
        }
      }
    } finally {
      releaseTransaction();
    }
  };

  return {
    sql,
    state: {
      migrationExecutions: () => migrationExecutions,
      transactions,
    },
  };
}

function runnerSource(): string {
  const path = join(process.cwd(), "apply-migrations.mjs");
  expect(existsSync(path)).toBe(true);
  return readFileSync(path, "utf8");
}

function ciSource(): string {
  return readFileSync(join(process.cwd(), "..", "..", ".github", "workflows", "ci.yml"), "utf8");
}

describe("SK-90 migration runner cutover", () => {
  it("keeps SK-91 trigger bodies intact when splitting the migration", () => {
    const statements = splitStatements(STABLE_OWNERSHIP_MIGRATION);
    expect(statements).toHaveLength(9);
    expect(
      statements.filter((statement: string) => statement.includes("CREATE TRIGGER")),
    ).toHaveLength(4);
  });

  it("starts at 0027 instead of replaying the legacy 0000-0026 chain", () => {
    const source = runnerSource();

    expect(
      cutoverFiles([
        "0027_purchase_foundation.sql",
        "0000_v3_init.sql",
        "0026_remove_legacy_project_share_token.sql",
        "0028_future.sql",
      ]),
    ).toEqual(["0027_purchase_foundation.sql", "0028_future.sql"]);
    expect(source).toMatch(/const CUTOVER_FLOOR = "0027_purchase_foundation\.sql"/);
    expect(source).toMatch(/filename >= CUTOVER_FLOOR/);
    expect(source).not.toMatch(/localeCompare/);
    expect(source).toMatch(/SKITZA_MIGRATION_CUTOVER_FLOOR_MISSING/);
    expect(source).not.toMatch(/laterMigrationPending/);
  });

  it("applies each cutover file and its ledger record in one transaction", async () => {
    const source = runnerSource();
    const client = fakeSql();
    const migration = CUTOVER_MIGRATION;

    await expect(
      applyMigration(client.sql, "0027_purchase_foundation.sql", migration, {
        adapterApproval: adapterApprovalFor(),
        adapterBinding: adapterBinding(),
      }),
    ).resolves.toBe("SKITZA_MIGRATION_APPLIED");

    expect(client.state.transactions).toHaveLength(1);
    expect(client.state.transactions[0]?.options).toEqual({ isolationLevel: "ReadCommitted" });
    const statements = client.state.transactions[0]?.queries.map((query) => query.statement) ?? [];
    expect(statements[0]).toContain("pg_advisory_xact_lock");
    expect(statements[1]).toContain('CREATE SCHEMA IF NOT EXISTS "skitza_migrations"');
    expect(statements[2]).toContain('CREATE TABLE IF NOT EXISTS "skitza_migrations"."applied"');
    expect(statements[4]).toContain("SKITZA_MIGRATION_POST_LOCK_GUARD");
    expect(statements[4]).toContain("SKITZA_0027_SOURCE_SCHEMA_DRIFT");
    expect(statements[5]).toContain('ON CONFLICT ("filename") DO NOTHING');
    expect(statements.at(-1)).toContain("SKITZA_MIGRATION_DIGEST_MISMATCH");

    expect(source).toMatch(/sql\.transaction\(/);
    expect(source).toMatch(/CREATE SCHEMA IF NOT EXISTS "skitza_migrations"/);
    expect(source).toMatch(/CREATE TABLE IF NOT EXISTS "skitza_migrations"\."applied"/);
    expect(source).toMatch(/INSERT INTO "skitza_migrations"\."applied"/);
    expect(source).toMatch(/pg_advisory_xact_lock/);
    expect(source).toMatch(/isolationLevel: "ReadCommitted"/);
    expect(source).not.toMatch(/Strip BEGIN\/COMMIT wrappers/);
    expect(source).not.toMatch(/await sql\(raw\)/);
  });

  it("uses an immutable digest ledger so later matching migrations remain no-ops", async () => {
    const source = runnerSource();
    const client = fakeSql();
    const filename = "0028_future.sql";
    const migration = "SELECT 28;";

    await expect(applyMigration(client.sql, filename, migration)).resolves.toBe(
      "SKITZA_MIGRATION_APPLIED",
    );
    await expect(applyMigration(client.sql, filename, migration)).resolves.toBe(
      "SKITZA_MIGRATION_ALREADY_APPLIED",
    );
    expect(client.state.transactions).toHaveLength(1);
    expect(client.state.digest()).toBe(migrationDigest(migration));
    await expect(applyMigration(client.sql, filename, `${migration}\n-- changed`)).rejects.toThrow(
      "SKITZA_MIGRATION_DIGEST_MISMATCH",
    );
    expect(client.state.transactions).toHaveLength(1);

    expect(source).toMatch(/createHash\("sha256"\)/);
    expect(source).toMatch(/SKITZA_MIGRATION_DIGEST_MISMATCH/);
    expect(source).toMatch(/SKITZA_MIGRATION_ALREADY_APPLIED/);
    expect(source).toMatch(/ON CONFLICT \("filename"\) DO NOTHING/);
    expect(source).toMatch(/WHERE NOT EXISTS \([\s\S]*"filename" = \$1 AND "digest" = \$2/);
  });

  it("re-runs the matching 0027 completed-target verifier under the lock", async () => {
    const filename = "0027_purchase_foundation.sql";
    const migration = CUTOVER_MIGRATION;
    const matching = fakeSql({ initialDigest: migrationDigest(migration) });

    await expect(applyMigration(matching.sql, filename, migration)).resolves.toBe(
      "SKITZA_MIGRATION_VERIFIED",
    );
    expect(matching.state.transactions).toHaveLength(1);
    expect(matching.state.transactions[0]?.queries[0]?.statement).toMatch(/pg_advisory_xact_lock/);
    expect(matching.state.transactions[0]?.queries[4]?.statement).toContain(
      "SKITZA_CHAT3_STRUCTURE_REQUIRED",
    );

    const drifted = fakeSql({
      initialDigest: migrationDigest(migration),
      failStatement: "SKITZA_0027_TARGET_SCHEMA_DRIFT",
    });

    await expect(applyMigration(drifted.sql, filename, migration)).rejects.toThrow(
      "SKITZA_MIGRATION_FAILED",
    );
    expect(drifted.state.transactions).toHaveLength(1);

    const invalidChangedSql = "SELECT 'unterminated";
    const changed = fakeSql({ initialDigest: migrationDigest(`${invalidChangedSql}\n-- old`) });
    await expect(applyMigration(changed.sql, filename, invalidChangedSql)).rejects.toThrow(
      "SKITZA_MIGRATION_DIGEST_MISMATCH",
    );
    expect(changed.state.transactions).toHaveLength(0);
  });

  it("does not replay the exact 0027 baseline verifier after a later migration", async () => {
    const filename = "0027_purchase_foundation.sql";
    const migration = CUTOVER_MIGRATION;
    const client = fakeSql({
      initialDigest: migrationDigest(migration),
      laterMigration: true,
    });

    await expect(applyMigration(client.sql, filename, migration)).resolves.toBe(
      "SKITZA_MIGRATION_ALREADY_APPLIED",
    );
    expect(client.state.transactions).toHaveLength(0);
  });

  it("derives a fail-closed Chat 3 verifier from the rehearsed immutable 0027 migration", () => {
    const verifier = chat3StructureVerificationStatement(CUTOVER_MIGRATION);

    expect(verifier).toContain("SKITZA_CHAT3_STRUCTURE_REQUIRED");
    expect(verifier).toContain("SKITZA_0027_TARGET_SCHEMA_DRIFT");
    expect(verifier).not.toContain("SKITZA_0027_SOURCE_SCHEMA_DRIFT");
    expect(verifier).toContain("pg_constraint.contype <> 't'");
    expect(verifier).toContain("5d6d90e934209fdc0cad9740a75464c0");
    expect(verifier).not.toContain("expected_constraint_structure_md5 CONSTANT text := 'eb03a328");
    expect(verifier).toContain('AS approved_check("table_name", "constraint_name")');
    expect(verifier).not.toContain("ratePct.*BETWEEN 0 AND 100");
    expect(() =>
      chat3StructureVerificationStatement(`${CUTOVER_MIGRATION}\n-- changed`),
    ).toThrow("SKITZA_CHAT3_VERIFIER_SOURCE_INVALID");
  });

  it("checks the rehearsed real Chat 3 structure under the lock before 0028 can run", async () => {
    const client = fakeSql();

    await expect(
      applyMigration(
        client.sql,
        "0028_stable_client_ownership.sql",
        STABLE_OWNERSHIP_MIGRATION,
      ),
    ).resolves.toBe("SKITZA_MIGRATION_APPLIED");

    const statements = client.state.transactions[0]?.queries.map((query) => query.statement) ?? [];
    expect(statements[0]).toContain("pg_advisory_xact_lock");
    expect(statements[4]).toContain("SKITZA_CHAT3_STRUCTURE_GUARD");
    expect(statements[4]).toContain("0027_purchase_foundation.sql");
    expect(statements[4]).toContain("SKITZA_CHAT3_STRUCTURE_REQUIRED");
    expect(statements[4]).toContain("SKITZA_0027_TARGET_SCHEMA_DRIFT");
    expect(statements[5]).toContain("SKITZA_MIGRATION_POST_LOCK_GUARD");
    expect(statements[5]).toContain("SKITZA_CLIENT_OWNER_IMMUTABLE");
  });

  it("aborts 0028 and its ledger entry when the Chat 3 structure check fails", async () => {
    const client = fakeSql({ failStatement: "SKITZA_CHAT3_STRUCTURE_GUARD" });

    await expect(
      applyMigration(
        client.sql,
        "0028_stable_client_ownership.sql",
        STABLE_OWNERSHIP_MIGRATION,
      ),
    ).rejects.toThrow("SKITZA_MIGRATION_FAILED");
    expect(client.state.transactions).toHaveLength(1);
    expect(client.state.relationExists()).toBe(false);
    expect(client.state.digest()).toBeNull();
  });

  it("serializes first-run bootstrap before DDL and executes a concurrent digest once", async () => {
    const client = concurrentFakeSql();
    const filename = "0028_future.sql";
    const migration = "SELECT 'CONCURRENT_MIGRATION_SENTINEL';";

    await Promise.all([
      applyMigration(client.sql, filename, migration),
      applyMigration(client.sql, filename, migration),
    ]);

    expect(client.state.transactions).toHaveLength(2);
    expect(client.state.migrationExecutions()).toBe(1);
    for (const transaction of client.state.transactions) {
      expect(transaction[0]?.statement).toMatch(/pg_advisory_xact_lock/);
      expect(transaction[1]?.statement).toMatch(/CREATE SCHEMA IF NOT EXISTS/);
      const guardedMigration = transaction.find((query) =>
        query.statement.includes("CONCURRENT_MIGRATION_SENTINEL"),
      );
      expect(guardedMigration?.statement).toMatch(/SKITZA_MIGRATION_POST_LOCK_GUARD/);
      expect(guardedMigration?.statement).toMatch(/IF NOT EXISTS[\s\S]*EXECUTE/);
    }
  });

  it("never suppresses a 0027 error or leaves the ledger bootstrap committed", async () => {
    const source = runnerSource();
    const client = fakeSql({ failStatement: "SKITZA_0027_SOURCE_SCHEMA_DRIFT" });

    await expect(
      applyMigration(client.sql, "0027_purchase_foundation.sql", CUTOVER_MIGRATION, {
        adapterApproval: adapterApprovalFor(),
        adapterBinding: adapterBinding(),
      }),
    ).rejects.toThrow("SKITZA_MIGRATION_FAILED");
    expect(client.state.transactions).toHaveLength(1);
    expect(client.state.relationExists()).toBe(false);
    expect(client.state.digest()).toBeNull();

    expect(source).not.toMatch(/already exists\|duplicate_object/);
    expect(source).not.toMatch(/const benign/);
    expect(source).not.toMatch(/process\.exit\(1\)/);
    expect(source).toMatch(/throw fail\("SKITZA_MIGRATION_FAILED", cause\)/);
  });

  it("keeps dollar-quoted bodies and string/comment semicolons intact", () => {
    expect(
      splitStatements(
        "-- header;\nDO $migration$ BEGIN PERFORM ';'; /* ; */ END $migration$; SELECT 2;",
      ),
    ).toEqual([
      "-- header;\nDO $migration$ BEGIN PERFORM ';'; /* ; */ END $migration$",
      "SELECT 2",
    ]);

    const purchaseFoundation = readFileSync(
      join(process.cwd(), "drizzle", "0027_purchase_foundation.sql"),
      "utf8",
    );
    expect(splitStatements(purchaseFoundation)).toHaveLength(1);
  });

  it("does not let CI treat its ambient test URL as cutover approval", () => {
    const source = ciSource();

    expect(source).not.toMatch(/node apply-migrations\.mjs/);
    expect(source).not.toMatch(/DATABASE_URL:\s*\$\{\{ secrets\.DATABASE_URL_TEST \}\}/);
    expect(source).toMatch(/CI must never infer/);
  });

  it("blocks an initial 0027 cutover unless the isolated reset adapter approves it", async () => {
    const client = fakeSql();
    const migration = CUTOVER_MIGRATION;

    await expect(
      applyMigration(client.sql, "0027_purchase_foundation.sql", migration),
    ).rejects.toThrow("SKITZA_MIGRATION_ADAPTER_APPROVAL_REQUIRED");
    expect(client.state.transactions).toHaveLength(0);

    const exactApproval = adapterApprovalFor();
    expect(() =>
      createSk90AdapterApproval({
        ...exactApproval,
        migrationDigest: migrationDigest(`${migration}\n-- different`),
      }),
    ).toThrow("SKITZA_MIGRATION_ADAPTER_APPROVAL_INVALID");
    await expect(
      applyMigration(client.sql, "0027_purchase_foundation.sql", `${migration}\n-- different`, {
        adapterApproval: exactApproval,
        adapterBinding: adapterBinding(),
      }),
    ).rejects.toThrow("SKITZA_MIGRATION_ADAPTER_APPROVAL_INVALID");
    await expect(
      applyMigration(client.sql, "0027_purchase_foundation.sql", migration, {
        adapterApproval: exactApproval,
        adapterBinding: {
          ...adapterBinding(),
          targetDatabaseFingerprint: `sha256:${"9".repeat(64)}`,
        },
      }),
    ).rejects.toThrow("SKITZA_MIGRATION_ADAPTER_APPROVAL_INVALID");
    expect(client.state.transactions).toHaveLength(0);
  });

  it("runs an approved cutover inside the adapter's existing transaction", async () => {
    const migration = CUTOVER_MIGRATION;
    const client = fakeSql();
    const statements: Query[] = [];
    let ledgerDigest: string | null = null;
    const transactionClient = {
      query: async (statement: string, params?: unknown[]) => {
        statements.push({ statement, params });
        if (statement.includes('SELECT "digest"')) {
          return { rows: ledgerDigest === null ? [] : [{ digest: ledgerDigest }] };
        }
        if (statement.includes('INSERT INTO "skitza_migrations"."applied"')) {
          ledgerDigest = String(params?.[1]);
        }
        return { rows: [] };
      },
    };

    await expect(
      applyMigrationInTransaction(
        transactionClient,
        "0027_purchase_foundation.sql",
        migration,
        adapterApprovalFor(),
        adapterBinding(),
      ),
    ).resolves.toBe("SKITZA_MIGRATION_APPLIED");

    expect(client.state.transactions).toHaveLength(0);
    expect(statements[0]?.statement).toContain("pg_advisory_xact_lock");
    expect(
      statements.some((entry) => entry.statement.includes("SKITZA_0027_SOURCE_SCHEMA_DRIFT")),
    ).toBe(true);
    expect(statements.some((entry) => entry.statement.includes("ON CONFLICT"))).toBe(true);
  });

  it("rejects ambiguous generic migration selectors", () => {
    expect(() =>
      databaseUrl({ DATABASE_URL: "postgres://one/db", POSTGRES_URL: "postgres://two/db" }),
    ).toThrow("SKITZA_MIGRATION_DATABASE_URL_AMBIGUOUS");
    expect(databaseUrl({ DATABASE_URL: "postgres://one/db" })).toBe("postgres://one/db");
    expect(runnerSource()).toMatch(/SKITZA_MIGRATION_DATABASE_URL_AMBIGUOUS/);
  });
});
