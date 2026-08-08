import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The production entry point remains plain ESM. This suite deliberately uses
// its exported applyMigration path with a real PostgreSQL-backed adapter.
// @ts-expect-error -- apply-migrations.mjs intentionally has no declarations.
import * as migrationRunner from "../../apply-migrations.mjs";

const { applyMigration, migrationDigest } = migrationRunner;

const MUTATION_ACK_ENV = "SK197_LOCAL_PG_MIGRATION_TEST_ACK";
const MUTATION_ACK = "I_ACKNOWLEDGE_SK197_LOCAL_POSTGRES_MUTATION";
const configuredAck = process.env[MUTATION_ACK_ENV];

if (configuredAck !== undefined && configuredAck !== MUTATION_ACK) {
  throw new Error(
    `${MUTATION_ACK_ENV} is set but does not contain the exact mutation acknowledgement`,
  );
}

const describeWithMutationAck = configuredAck === MUTATION_ACK ? describe : describe.skip;
const migration0044 = readFileSync(
  join(process.cwd(), "drizzle", "0044_generic_audio_upload_intents.sql"),
  "utf8",
);
const migration0039 = readFileSync(
  join(process.cwd(), "drizzle", "0039_atomic_first_version_uploads.sql"),
  "utf8",
);
const migration0041 = readFileSync(
  join(process.cwd(), "drizzle", "0041_beta_audio_storage_limits.sql"),
  "utf8",
);

type RunnerQuery = Readonly<{
  params: readonly unknown[] | undefined;
  statement: string;
}>;

type QueryRow = Record<string, unknown>;

function sqlLiteral(value: unknown): string {
  if (value === null) return "NULL";
  if (typeof value === "string") return `'${value.replaceAll("'", "''")}'`;
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  throw new Error("The local migration adapter received an unsupported SQL parameter");
}

function bindParameters(statement: string, parameters: readonly unknown[] = []): string {
  return statement.replace(/\$(\d+)\b/g, (placeholder, positionText: string) => {
    const position = Number(positionText);
    if (!Number.isSafeInteger(position) || position < 1 || position > parameters.length) {
      throw new Error(`The local migration adapter cannot bind ${placeholder}`);
    }
    return sqlLiteral(parameters[position - 1]);
  });
}

function withoutTrailingSemicolon(statement: string): string {
  return statement.trim().replace(/;+\s*$/, "");
}

describeWithMutationAck("SK-197 migration 0044 — owned local PostgreSQL", () => {
  const ownedPrefix = resolve(join(tmpdir(), "skitza-sk197-local-pg-"));
  const databaseName = "skitza_sk197";
  const databaseUser = "skitza_test";
  const producerId = randomUUID();
  const projectId = randomUUID();
  const purchaseId = randomUUID();
  const legacyActiveOperation = `sk197-legacy-active-${randomUUID()}`;
  const legacyCompletedOperation = `sk197-legacy-completed-${randomUUID()}`;

  let ownedRoot: string | null = null;
  let dataDirectory: string | null = null;
  let socketDirectory: string | null = null;
  let postgresStarted = false;
  let initialMigrationStatus: string | null = null;

  function assertOwnedPath(path: string): void {
    const normalized = resolve(path);
    if (normalized === ownedPrefix || !normalized.startsWith(ownedPrefix)) {
      throw new Error("Refusing to operate on a PostgreSQL path not owned by the SK-197 harness");
    }
  }

  function postgresArguments(extra: readonly string[] = []): string[] {
    if (!socketDirectory) throw new Error("The owned PostgreSQL socket is unavailable");
    assertOwnedPath(socketDirectory);
    return [
      "--no-psqlrc",
      "--quiet",
      "--tuples-only",
      "--no-align",
      "--set=ON_ERROR_STOP=1",
      `--host=${socketDirectory}`,
      `--username=${databaseUser}`,
      `--dbname=${databaseName}`,
      ...extra,
    ];
  }

  function runPsql(source: string): string {
    return execFileSync("psql", postgresArguments(), {
      encoding: "utf8",
      input: source,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    });
  }

  function attemptPsql(source: string): Readonly<{
    status: number | null;
    stderr: string;
    stdout: string;
  }> {
    const result = spawnSync("psql", postgresArguments(), {
      encoding: "utf8",
      input: source,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (result.error) throw result.error;
    return {
      status: result.status,
      stderr: result.stderr,
      stdout: result.stdout,
    };
  }

  function queryRows<T extends QueryRow>(statement: string): T[] {
    const source = `
      SELECT COALESCE(json_agg(row_to_json(result_row)), '[]'::json)::text
      FROM (${withoutTrailingSemicolon(statement)}) AS result_row;
    `;
    const output = runPsql(source).trim();
    if (!output) throw new Error("The local PostgreSQL query returned no JSON result");
    return JSON.parse(output) as T[];
  }

  function createRunnerSql() {
    const sql = async (statement: string, parameters?: readonly unknown[]) =>
      queryRows(bindParameters(statement, parameters));

    sql.transaction = async (
      factory: (
        transactionSql: (statement: string, params?: readonly unknown[]) => RunnerQuery,
      ) => RunnerQuery[],
      options: unknown,
    ): Promise<void> => {
      if (JSON.stringify(options) !== JSON.stringify({ isolationLevel: "ReadCommitted" })) {
        throw new Error("The local adapter refuses an unexpected migration transaction mode");
      }
      const queries = factory((statement, params) => ({ statement, params }));
      if (!Array.isArray(queries) || queries.length === 0) {
        throw new Error("The migration runner produced no transactional queries");
      }
      runPsql(
        [
          "BEGIN ISOLATION LEVEL READ COMMITTED;",
          ...queries.map(
            ({ statement, params }) =>
              `${withoutTrailingSemicolon(bindParameters(statement, params))};`,
          ),
          "COMMIT;",
        ].join("\n"),
      );
    };

    return sql;
  }

  function insertLegacyIntent(
    input: Readonly<{
      completed: boolean;
      operationKey: string;
    }>,
  ): void {
    runPsql(`
      INSERT INTO "first_version_upload_intents" (
        "id", "producer_id", "project_id", "purchase_id", "operation_key",
        "request_digest", "track_id", "version_id", "title", "artist", "label",
        "description", "staging_audio_r2_key", "audio_r2_key", "audio_content_type",
        "audio_size_bytes", "duration_ms", "completion_token", "expires_at",
        "completed_at"
      ) VALUES (
        ${sqlLiteral(randomUUID())}, ${sqlLiteral(producerId)}, ${sqlLiteral(projectId)},
        ${sqlLiteral(purchaseId)}, ${sqlLiteral(input.operationKey)},
        ${sqlLiteral(`sha256:${"a".repeat(64)}`)}, ${sqlLiteral(randomUUID())},
        ${sqlLiteral(randomUUID())}, 'Legacy Song', 'Legacy Artist', 'V1', NULL,
        ${sqlLiteral(`staging/${randomUUID()}`)}, ${sqlLiteral(`audio/${randomUUID()}`)},
        'audio/wav', 4096, 120000, ${sqlLiteral("b".repeat(64))},
        now() + interval '1 hour', ${input.completed ? "now()" : "NULL"}
      );
    `);
  }

  function stagedInsert(
    input: Readonly<{
      completed?: boolean;
      operationKey: string;
      projectId?: string | null;
      purchaseId?: string | null;
      title?: string | null;
      label?: string | null;
      trackId: string;
    }>,
  ): string {
    const id = randomUUID();
    return `
      INSERT INTO "first_version_upload_intents" (
        "id", "producer_id", "project_id", "purchase_id", "operation_key",
        "request_digest", "track_id", "version_id", "title", "artist", "label",
        "description", "staging_audio_r2_key", "audio_r2_key", "audio_content_type",
        "audio_size_bytes", "duration_ms", "completion_token", "expires_at",
        "completed_at"
      ) VALUES (
        ${sqlLiteral(id)}, ${sqlLiteral(producerId)}, ${sqlLiteral(input.projectId ?? null)},
        ${sqlLiteral(input.purchaseId ?? null)}, ${sqlLiteral(input.operationKey)},
        ${sqlLiteral(`sha256:${"c".repeat(64)}`)}, ${sqlLiteral(input.trackId)},
        ${sqlLiteral(randomUUID())}, ${sqlLiteral(input.title ?? null)}, NULL,
        ${sqlLiteral(input.label ?? null)}, NULL, ${sqlLiteral(`staging/${randomUUID()}`)},
        ${sqlLiteral(`audio/${randomUUID()}`)}, 'audio/flac', 8192, NULL,
        ${sqlLiteral("d".repeat(64))}, now() + interval '1 hour',
        ${input.completed ? "now()" : "NULL"}
      );
    `;
  }

  function stopAndRemoveOwnedCluster(): void {
    if (!ownedRoot || !dataDirectory) return;
    assertOwnedPath(ownedRoot);
    assertOwnedPath(dataDirectory);

    const status = spawnSync("pg_ctl", ["--pgdata", dataDirectory, "status"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (postgresStarted || status.status === 0) {
      execFileSync("pg_ctl", ["--pgdata", dataDirectory, "--mode=immediate", "--wait", "stop"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      postgresStarted = false;
    }

    rmSync(ownedRoot, { force: true, recursive: true });
    ownedRoot = null;
    dataDirectory = null;
    socketDirectory = null;
  }

  beforeAll(async () => {
    for (const tool of ["initdb", "pg_ctl", "createdb", "psql"]) {
      const availability = spawnSync(tool, ["--version"], { encoding: "utf8" });
      if (availability.error || availability.status !== 0) {
        throw new Error(`${tool} is required when ${MUTATION_ACK_ENV} is acknowledged`);
      }
    }

    ownedRoot = mkdtempSync(join(tmpdir(), "skitza-sk197-local-pg-"));
    assertOwnedPath(ownedRoot);
    dataDirectory = join(ownedRoot, "data");
    socketDirectory = join(ownedRoot, "socket");
    mkdirSync(socketDirectory);
    const logPath = join(ownedRoot, "postgres.log");

    try {
      execFileSync(
        "initdb",
        [
          `--pgdata=${dataDirectory}`,
          `--username=${databaseUser}`,
          "--auth-local=trust",
          "--auth-host=reject",
          "--encoding=UTF8",
          "--locale=C",
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
      execFileSync(
        "pg_ctl",
        [
          `--pgdata=${dataDirectory}`,
          `--log=${logPath}`,
          "--wait",
          "--options",
          `-F -k ${socketDirectory} -c listen_addresses=''`,
          "start",
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
      postgresStarted = true;
      execFileSync(
        "createdb",
        [`--host=${socketDirectory}`, `--username=${databaseUser}`, databaseName],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );

      // 0039 and 0041 are fixture sources here, not migration operations. They
      // produce the exact intent relation immediately before 0044 without
      // replaying the historical 0000-0038 chain or mutating another target.
      runPsql(`
        CREATE TABLE "producers" (
          "id" uuid PRIMARY KEY
        );
        CREATE TABLE "projects" (
          "id" uuid PRIMARY KEY,
          "producer_id" uuid NOT NULL REFERENCES "producers"("id") ON DELETE CASCADE,
          CONSTRAINT "projects_id_producer_unique" UNIQUE ("id", "producer_id")
        );
        CREATE TABLE "purchases" (
          "id" uuid PRIMARY KEY,
          "producer_id" uuid NOT NULL REFERENCES "producers"("id") ON DELETE CASCADE,
          "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
          CONSTRAINT "purchases_id_project_unique" UNIQUE ("id", "project_id"),
          CONSTRAINT "purchases_id_producer_unique" UNIQUE ("id", "producer_id")
        );
        CREATE TABLE "track_versions" (
          "id" uuid PRIMARY KEY,
          "producer_id" uuid NOT NULL,
          "size_bytes" bigint,
          "pending_audio_size_bytes" bigint,
          "pending_audio_complete_attempted_at" timestamp with time zone,
          "audio_deleted_at" timestamp with time zone
        );
      `);
      runPsql(migration0039);
      runPsql(migration0041);
      runPsql(`
        INSERT INTO "producers" ("id") VALUES (${sqlLiteral(producerId)});
        INSERT INTO "projects" ("id", "producer_id")
          VALUES (${sqlLiteral(projectId)}, ${sqlLiteral(producerId)});
        INSERT INTO "purchases" ("id", "producer_id", "project_id")
          VALUES (${sqlLiteral(purchaseId)}, ${sqlLiteral(producerId)}, ${sqlLiteral(projectId)});
      `);
      insertLegacyIntent({ completed: false, operationKey: legacyActiveOperation });
      insertLegacyIntent({ completed: true, operationKey: legacyCompletedOperation });

      initialMigrationStatus = await applyMigration(
        createRunnerSql(),
        "0044_generic_audio_upload_intents.sql",
        migration0044,
      );
    } catch (error) {
      stopAndRemoveOwnedCluster();
      throw error;
    }
  }, 30_000);

  afterAll(() => {
    stopAndRemoveOwnedCluster();
  }, 30_000);

  it("applies 0044 through the real exported migration-runner boundary", () => {
    expect(initialMigrationStatus).toBe("SKITZA_MIGRATION_APPLIED");

    const ledger = queryRows<{ digest: string; filename: string }>(`
      SELECT "filename", "digest"
      FROM "skitza_migrations"."applied"
      WHERE "filename" = '0044_generic_audio_upload_intents.sql'
    `);
    expect(ledger).toEqual([
      {
        filename: "0044_generic_audio_upload_intents.sql",
        digest: migrationDigest(migration0044),
      },
    ]);
  });

  it("backfills active and completed legacy intents", () => {
    const rows = queryRows<{
      creates_track: boolean;
      finalization_digest: string;
      operation_key: string;
      request_digest: string;
    }>(`
      SELECT "operation_key", "request_digest", "finalization_digest", "creates_track"
      FROM "first_version_upload_intents"
      WHERE "operation_key" IN (
        ${sqlLiteral(legacyActiveOperation)},
        ${sqlLiteral(legacyCompletedOperation)}
      )
      ORDER BY "operation_key"
    `);

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.creates_track).toBe(true);
      expect(row.finalization_digest).toBe(row.request_digest);
    }
  });

  it("upgrades an old-server rolling write before enforcing the new shape", () => {
    const operationKey = `sk197-rolling-${randomUUID()}`;
    insertLegacyIntent({ completed: false, operationKey });

    expect(
      queryRows<{
        creates_track: boolean;
        finalization_matches: boolean;
      }>(`
        SELECT
          "creates_track",
          "finalization_digest" = "request_digest" AS "finalization_matches"
        FROM "first_version_upload_intents"
        WHERE "operation_key" = ${sqlLiteral(operationKey)}
      `),
    ).toEqual([{ creates_track: true, finalization_matches: true }]);
  });

  it("accepts generic unbound intents and permits provisional track-id reuse", () => {
    const sharedTrackId = randomUUID();
    const firstOperation = `sk197-generic-a-${randomUUID()}`;
    const secondOperation = `sk197-generic-b-${randomUUID()}`;

    runPsql(stagedInsert({ operationKey: firstOperation, trackId: sharedTrackId }));
    runPsql(stagedInsert({ operationKey: secondOperation, trackId: sharedTrackId }));

    expect(
      queryRows<{
        creates_track: boolean | null;
        destination_unbound: boolean;
        finalization_digest: string | null;
        intent_count: number;
      }>(`
        SELECT
          count(*)::integer AS "intent_count",
          bool_and(
            "project_id" IS NULL
            AND "purchase_id" IS NULL
            AND "title" IS NULL
            AND "label" IS NULL
          ) AS "destination_unbound",
          min("creates_track"::text)::boolean AS "creates_track",
          min("finalization_digest") AS "finalization_digest"
        FROM "first_version_upload_intents"
        WHERE "track_id" = ${sqlLiteral(sharedTrackId)}
      `),
    ).toEqual([
      {
        intent_count: 2,
        destination_unbound: true,
        creates_track: null,
        finalization_digest: null,
      },
    ]);
  });

  it("binds an unbound intent to an existing Song destination before completion", () => {
    const operationKey = `sk197-bind-existing-${randomUUID()}`;
    const finalizationDigest = `sha256:${"e".repeat(64)}`;
    runPsql(stagedInsert({ operationKey, trackId: randomUUID() }));

    runPsql(`
      UPDATE "first_version_upload_intents"
      SET
        "project_id" = ${sqlLiteral(projectId)},
        "purchase_id" = ${sqlLiteral(purchaseId)},
        "title" = 'Existing Song',
        "label" = 'V2',
        "creates_track" = false,
        "finalization_digest" = ${sqlLiteral(finalizationDigest)}
      WHERE "operation_key" = ${sqlLiteral(operationKey)};
    `);

    expect(
      queryRows<{
        completed_at: string | null;
        creates_track: boolean;
        finalization_digest: string;
        project_id: string;
        purchase_id: string;
      }>(`
        SELECT
          "project_id", "purchase_id", "creates_track", "finalization_digest", "completed_at"
        FROM "first_version_upload_intents"
        WHERE "operation_key" = ${sqlLiteral(operationKey)}
      `),
    ).toEqual([
      {
        project_id: projectId,
        purchase_id: purchaseId,
        creates_track: false,
        finalization_digest: finalizationDigest,
        completed_at: null,
      },
    ]);

    runPsql(`
      UPDATE "first_version_upload_intents"
      SET "completed_at" = now()
      WHERE "operation_key" = ${sqlLiteral(operationKey)};
    `);
    expect(
      queryRows<{ completed: boolean }>(`
        SELECT "completed_at" IS NOT NULL AS "completed"
        FROM "first_version_upload_intents"
        WHERE "operation_key" = ${sqlLiteral(operationKey)}
      `),
    ).toEqual([{ completed: true }]);
  });

  it("rejects a cross-producer destination and leaves the intent unbound", () => {
    const foreignProducerId = randomUUID();
    const foreignProjectId = randomUUID();
    const foreignPurchaseId = randomUUID();
    const operationKey = `sk197-cross-producer-${randomUUID()}`;
    runPsql(`
      INSERT INTO "producers" ("id") VALUES (${sqlLiteral(foreignProducerId)});
      INSERT INTO "projects" ("id", "producer_id")
        VALUES (${sqlLiteral(foreignProjectId)}, ${sqlLiteral(foreignProducerId)});
      INSERT INTO "purchases" ("id", "producer_id", "project_id")
        VALUES (
          ${sqlLiteral(foreignPurchaseId)},
          ${sqlLiteral(foreignProducerId)},
          ${sqlLiteral(foreignProjectId)}
        );
    `);
    runPsql(stagedInsert({ operationKey, trackId: randomUUID() }));

    const crossProducerBinding = attemptPsql(`
      UPDATE "first_version_upload_intents"
      SET
        "project_id" = ${sqlLiteral(foreignProjectId)},
        "purchase_id" = ${sqlLiteral(foreignPurchaseId)},
        "title" = 'Foreign Song',
        "label" = 'V2',
        "creates_track" = false,
        "finalization_digest" = ${sqlLiteral(`sha256:${"f".repeat(64)}`)}
      WHERE "operation_key" = ${sqlLiteral(operationKey)};
    `);
    expect(crossProducerBinding.status).not.toBe(0);
    expect(crossProducerBinding.stderr).toMatch(
      /first_version_upload_intents_(?:project_producer|purchase_producer)_fk/,
    );

    expect(
      queryRows<{
        creates_track: boolean | null;
        finalization_digest: string | null;
        label: string | null;
        project_id: string | null;
        purchase_id: string | null;
        title: string | null;
      }>(`
        SELECT
          "project_id", "purchase_id", "title", "label", "creates_track", "finalization_digest"
        FROM "first_version_upload_intents"
        WHERE "operation_key" = ${sqlLiteral(operationKey)}
      `),
    ).toEqual([
      {
        project_id: null,
        purchase_id: null,
        title: null,
        label: null,
        creates_track: null,
        finalization_digest: null,
      },
    ]);
  });

  it("rejects completed-unbound and partially bound generic states", () => {
    const completedOperation = `sk197-invalid-completed-${randomUUID()}`;
    const completed = attemptPsql(
      stagedInsert({ completed: true, operationKey: completedOperation, trackId: randomUUID() }),
    );
    expect(completed.status).not.toBe(0);
    expect(completed.stderr).toContain("first_version_upload_intents_finalization_shape");

    const partialOperation = `sk197-invalid-partial-${randomUUID()}`;
    const partial = attemptPsql(
      stagedInsert({
        operationKey: partialOperation,
        projectId,
        purchaseId,
        title: null,
        label: null,
        trackId: randomUUID(),
      }),
    );
    expect(partial.status).not.toBe(0);
    expect(partial.stderr).toContain("first_version_upload_intents_finalization_shape");

    expect(
      queryRows<{ invalid_count: number }>(`
        SELECT count(*)::integer AS "invalid_count"
        FROM "first_version_upload_intents"
        WHERE "operation_key" IN (
          ${sqlLiteral(completedOperation)},
          ${sqlLiteral(partialOperation)}
        )
      `),
    ).toEqual([{ invalid_count: 0 }]);
  });

  it("retains Version uniqueness, foreign keys, and the non-unique track lookup", () => {
    const constraints = queryRows<{ conname: string; contype: string }>(`
      SELECT "conname", "contype"
      FROM "pg_constraint"
      WHERE "conrelid" = 'first_version_upload_intents'::regclass
      ORDER BY "conname"
    `);
    const names = constraints.map(({ conname }) => conname);
    expect(names).not.toContain("first_version_upload_intents_track_unique");
    expect(names).toEqual(
      expect.arrayContaining([
        "first_version_upload_intents_version_unique",
        "first_version_upload_intents_project_producer_fk",
        "first_version_upload_intents_purchase_project_fk",
        "first_version_upload_intents_purchase_producer_fk",
        "first_version_upload_intents_finalization_shape",
      ]),
    );

    expect(
      queryRows<{ indisunique: boolean; indexname: string }>(`
        SELECT "indexname", "indisunique"
        FROM "pg_indexes"
        INNER JOIN "pg_class" AS index_relation
          ON index_relation."relname" = "pg_indexes"."indexname"
        INNER JOIN "pg_index"
          ON "pg_index"."indexrelid" = index_relation."oid"
        WHERE "pg_indexes"."schemaname" = 'public'
          AND "pg_indexes"."tablename" = 'first_version_upload_intents'
          AND "pg_indexes"."indexname" = 'first_version_upload_intents_track_idx'
      `),
    ).toEqual([{ indexname: "first_version_upload_intents_track_idx", indisunique: false }]);
  });

  it("is idempotent through the same exported runner path", async () => {
    await expect(
      applyMigration(createRunnerSql(), "0044_generic_audio_upload_intents.sql", migration0044),
    ).resolves.toBe("SKITZA_MIGRATION_ALREADY_APPLIED");

    expect(
      queryRows<{ ledger_count: number }>(`
        SELECT count(*)::integer AS "ledger_count"
        FROM "skitza_migrations"."applied"
        WHERE "filename" = '0044_generic_audio_upload_intents.sql'
      `),
    ).toEqual([{ ledger_count: 1 }]);
  });
});
