import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The approved runner remains plain ESM and intentionally has no declarations.
// @ts-expect-error -- exercised through its public migration entry point.
import * as migrationRunner from "../../apply-migrations.mjs";

const { applyMigration } = migrationRunner;

const MUTATION_ACK_ENV = "SK229_LOCAL_PG_MIGRATION_TEST_ACK";
const MUTATION_ACK = "I_ACKNOWLEDGE_SK229_OWNED_LOCAL_POSTGRES_MUTATION";
const configuredAck = process.env[MUTATION_ACK_ENV];

if (configuredAck !== undefined && configuredAck !== MUTATION_ACK) {
  throw new Error(
    `${MUTATION_ACK_ENV} is set but does not contain the exact mutation acknowledgement`,
  );
}

const describeWithMutationAck = configuredAck === MUTATION_ACK ? describe : describe.skip;
const migration0050 = readFileSync(
  join(process.cwd(), "drizzle", "0050_account_closure_foundation.sql"),
  "utf8",
);
const migration0051 = readFileSync(
  join(process.cwd(), "drizzle", "0051_clerk_identity_bindings.sql"),
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
  throw new Error("The local SK-229 adapter received an unsupported SQL parameter");
}

function bindParameters(statement: string, parameters: readonly unknown[] = []): string {
  return statement.replace(/\$(\d+)\b/g, (placeholder, positionText: string) => {
    const position = Number(positionText);
    if (!Number.isSafeInteger(position) || position < 1 || position > parameters.length) {
      throw new Error(`The local SK-229 adapter cannot bind ${placeholder}`);
    }
    return sqlLiteral(parameters[position - 1]);
  });
}

function withoutTrailingSemicolon(statement: string): string {
  return statement.trim().replace(/;+\s*$/, "");
}

describeWithMutationAck("SK-229 closure and Clerk identity migrations — owned PostgreSQL", () => {
  const ownedPrefix = resolve(join(tmpdir(), "skitza-sk229-local-pg-"));
  const databaseName = "skitza_sk229";
  const databaseUser = "skitza_test";

  let ownedRoot: string | null = null;
  let dataDirectory: string | null = null;
  let socketDirectory: string | null = null;
  let postgresStarted = false;

  function assertOwnedPath(path: string): void {
    const normalized = resolve(path);
    if (normalized === ownedPrefix || !normalized.startsWith(ownedPrefix)) {
      throw new Error("Refusing to operate on a PostgreSQL path not owned by SK-229");
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
    return { status: result.status, stderr: result.stderr, stdout: result.stdout };
  }

  function queryRows<T extends QueryRow>(statement: string): T[] {
    const output = runPsql(`
      SELECT COALESCE(json_agg(row_to_json(result_row)), '[]'::json)::text
      FROM (${withoutTrailingSemicolon(statement)}) AS result_row;
    `).trim();
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
        throw new Error("The local adapter refuses an unexpected transaction mode");
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

  beforeAll(() => {
    for (const tool of ["initdb", "pg_ctl", "createdb", "psql"]) {
      const availability = spawnSync(tool, ["--version"], { encoding: "utf8" });
      if (availability.error || availability.status !== 0) {
        throw new Error(`${tool} is required when ${MUTATION_ACK_ENV} is acknowledged`);
      }
    }

    ownedRoot = mkdtempSync(join(tmpdir(), "skitza-sk229-local-pg-"));
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

      runPsql(`
        CREATE SCHEMA "skitza_migrations";
        CREATE TABLE "skitza_migrations"."applied" (
          "filename" text PRIMARY KEY,
          "digest" text NOT NULL,
          "applied_at" timestamp with time zone NOT NULL DEFAULT now(),
          CONSTRAINT "skitza_migrations_filename_shape"
            CHECK ("filename" ~ '^[0-9]{4}_[a-z0-9_]+[.]sql$'),
          CONSTRAINT "skitza_migrations_digest_sha256"
            CHECK ("digest" ~ '^[0-9a-f]{64}$')
        );
        INSERT INTO "skitza_migrations"."applied" ("filename", "digest")
        VALUES ('0049_producer_invitation_grants.sql', '${"9".repeat(64)}');

        CREATE FUNCTION "prevent_append_only_mutation"()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          RAISE EXCEPTION 'append-only relation';
        END;
        $$;

        CREATE TABLE "producers" (
          "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          "clerk_user_id" text NOT NULL UNIQUE,
          "slug" text NOT NULL UNIQUE,
          "updated_at" timestamp with time zone NOT NULL DEFAULT now()
        );

        CREATE TABLE "registered_accounts" (
          "clerk_user_id" text PRIMARY KEY,
          "primary_email" text,
          "display_name" text,
          "email_verified" boolean,
          "audience_type" text NOT NULL DEFAULT 'unknown',
          "provider_state" text NOT NULL DEFAULT 'needs_sync',
          "provider_created_at" timestamp with time zone,
          "provider_updated_at" timestamp with time zone,
          "last_sign_in_at" timestamp with time zone,
          "last_webhook_event_id" text,
          "synced_at" timestamp with time zone,
          "created_at" timestamp with time zone NOT NULL DEFAULT now(),
          "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
          CONSTRAINT "registered_accounts_identity_shape" CHECK (
            "clerk_user_id" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'
          ),
          CONSTRAINT "registered_accounts_sync_shape" CHECK (
            (
              "provider_state" = 'needs_sync'
              AND "provider_updated_at" IS NULL
              AND "last_webhook_event_id" IS NULL
              AND "synced_at" IS NULL
            ) OR (
              "provider_state" <> 'needs_sync'
              AND "provider_updated_at" IS NOT NULL
              AND "last_webhook_event_id" IS NOT NULL
              AND "synced_at" IS NOT NULL
            )
          )
        );

        CREATE TABLE "clerk_user_sync_receipts" (
          "event_id" text PRIMARY KEY,
          "event_digest" text NOT NULL,
          "event_type" text NOT NULL,
          "clerk_user_id" text NOT NULL,
          "clerk_instance_id" text NOT NULL,
          "provider_updated_at" timestamp with time zone NOT NULL,
          "processed_at" timestamp with time zone NOT NULL DEFAULT now(),
          CONSTRAINT "clerk_user_sync_receipts_shape" CHECK (
            NULLIF(btrim("event_id"), '') IS NOT NULL
          )
        );
        CREATE TRIGGER "clerk_user_sync_receipts_append_only"
          BEFORE UPDATE OR DELETE ON "clerk_user_sync_receipts"
          FOR EACH ROW EXECUTE FUNCTION "prevent_append_only_mutation"();

        CREATE TABLE "producer_invitation_grants" (
          "clerk_invitation_id" text PRIMARY KEY,
          "clerk_user_id" text NOT NULL,
          "clerk_instance_id" text NOT NULL,
          "invited_email_hash" text NOT NULL,
          "invitation_created_at" timestamp with time zone NOT NULL,
          "provider_updated_at" timestamp with time zone NOT NULL,
          "granted_at" timestamp with time zone NOT NULL DEFAULT now(),
          CONSTRAINT "producer_invitation_grants_clerk_user_unique" UNIQUE ("clerk_user_id"),
          CONSTRAINT "producer_invitation_grants_identity_shape" CHECK (
            "clerk_user_id" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'
          )
        );
        CREATE TRIGGER "producer_invitation_grants_append_only"
          BEFORE UPDATE OR DELETE ON "producer_invitation_grants"
          FOR EACH ROW EXECUTE FUNCTION "prevent_append_only_mutation"();

        INSERT INTO "producers" ("clerk_user_id", "slug")
        VALUES ('user_existing_producer', 'existing-producer');

        INSERT INTO "registered_accounts" (
          "clerk_user_id", "provider_state", "provider_updated_at",
          "last_webhook_event_id", "synced_at"
        ) VALUES
          ('user_with_receipt', 'active', now(), 'evt_with_receipt', now()),
          ('user_missing_receipt', 'active', now(), 'evt_missing_receipt', now());

        INSERT INTO "clerk_user_sync_receipts" (
          "event_id", "event_digest", "event_type", "clerk_user_id",
          "clerk_instance_id", "provider_updated_at"
        ) VALUES (
          'evt_with_receipt', 'sha256:${"a".repeat(64)}', 'user.updated',
          'user_with_receipt', 'ins_source', now()
        );

        INSERT INTO "producer_invitation_grants" (
          "clerk_invitation_id", "clerk_user_id", "clerk_instance_id",
          "invited_email_hash", "invitation_created_at", "provider_updated_at"
        ) VALUES (
          'inv_existing', 'user_existing_producer', 'ins_source',
          '${"b".repeat(64)}', now() - interval '1 minute', now()
        );
      `);
    } catch (error) {
      stopAndRemoveOwnedCluster();
      throw error;
    }
  }, 30_000);

  afterAll(() => {
    stopAndRemoveOwnedCluster();
  });

  it("applies 0050 through the approved runner and enforces one-way closure", async () => {
    const sql = createRunnerSql();
    await expect(
      applyMigration(sql, "0050_account_closure_foundation.sql", migration0050),
    ).resolves.toBe("SKITZA_MIGRATION_APPLIED");
    await expect(
      applyMigration(sql, "0050_account_closure_foundation.sql", migration0050),
    ).resolves.toBe("SKITZA_MIGRATION_ALREADY_APPLIED");

    expect(
      queryRows<{ exists: boolean }>(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'producers'
            AND column_name = 'closed_at'
        ) AS "exists"
      `),
    ).toEqual([{ exists: true }]);

    runPsql(`
      UPDATE "producers" SET "closed_at" = now()
      WHERE "clerk_user_id" = 'user_existing_producer';
    `);
    const reopen = attemptPsql(`
      UPDATE "producers" SET "closed_at" = NULL
      WHERE "clerk_user_id" = 'user_existing_producer';
    `);
    expect(reopen.status).not.toBe(0);
    expect(reopen.stderr).toContain("closed producer access is one-way");
  });

  it("rolls back 0051 without exact receipt evidence, then backfills and guards it", async () => {
    const sql = createRunnerSql();
    await expect(
      applyMigration(sql, "0051_clerk_identity_bindings.sql", migration0051),
    ).rejects.toThrow("SKITZA_MIGRATION_FAILED");

    expect(
      queryRows<{ relation: string | null }>(
        `SELECT to_regclass('public.clerk_identity_bindings')::text AS "relation"`,
      ),
    ).toEqual([{ relation: null }]);
    expect(
      queryRows<{ count: number }>(`
        SELECT count(*)::integer AS "count"
        FROM "skitza_migrations"."applied"
        WHERE "filename" = '0051_clerk_identity_bindings.sql'
      `),
    ).toEqual([{ count: 0 }]);

    runPsql(`
      INSERT INTO "clerk_user_sync_receipts" (
        "event_id", "event_digest", "event_type", "clerk_user_id",
        "clerk_instance_id", "provider_updated_at"
      ) VALUES (
        'evt_missing_receipt', 'sha256:${"c".repeat(64)}', 'user.updated',
        'user_missing_receipt', 'ins_source', now()
      );
    `);

    await expect(
      applyMigration(sql, "0051_clerk_identity_bindings.sql", migration0051),
    ).resolves.toBe("SKITZA_MIGRATION_APPLIED");
    await expect(
      applyMigration(sql, "0051_clerk_identity_bindings.sql", migration0051),
    ).resolves.toBe("SKITZA_MIGRATION_ALREADY_APPLIED");

    expect(
      queryRows<{
        clerkInstanceId: string;
        clerkUserId: string;
        providerClerkUserId: string;
      }>(`
        SELECT
          "clerk_user_id" AS "clerkUserId",
          "provider_clerk_user_id" AS "providerClerkUserId",
          "clerk_instance_id" AS "clerkInstanceId"
        FROM "registered_accounts"
        ORDER BY "clerk_user_id"
      `),
    ).toEqual([
      {
        clerkInstanceId: "ins_source",
        clerkUserId: "user_missing_receipt",
        providerClerkUserId: "user_missing_receipt",
      },
      {
        clerkInstanceId: "ins_source",
        clerkUserId: "user_with_receipt",
        providerClerkUserId: "user_with_receipt",
      },
    ]);

    expect(
      queryRows<{ canonicalClerkUserId: string; clerkUserId: string }>(`
        SELECT
          "clerk_user_id" AS "clerkUserId",
          "canonical_clerk_user_id" AS "canonicalClerkUserId"
        FROM "clerk_user_sync_receipts"
        ORDER BY "event_id"
      `),
    ).toEqual([
      {
        canonicalClerkUserId: "user_missing_receipt",
        clerkUserId: "user_missing_receipt",
      },
      {
        canonicalClerkUserId: "user_with_receipt",
        clerkUserId: "user_with_receipt",
      },
    ]);

    expect(
      queryRows<{ canonical: string; provider: string }>(`
        SELECT "clerk_user_id" AS "canonical", "provider_clerk_user_id" AS "provider"
        FROM "producer_invitation_grants"
      `),
    ).toEqual([{ canonical: "user_existing_producer", provider: "user_existing_producer" }]);

    const receiptMutation = attemptPsql(`
      UPDATE "clerk_user_sync_receipts"
      SET "canonical_clerk_user_id" = 'user_changed'
      WHERE "event_id" = 'evt_with_receipt';
    `);
    expect(receiptMutation.status).not.toBe(0);
    expect(receiptMutation.stderr).toContain("append-only relation");
  });

  it("supports atomic activation, audited staging rejection, and immutable evidence", () => {
    const batchId = randomUUID();
    const rejectedBatchId = randomUUID();
    const emailHash = `sha256:${"d".repeat(64)}`;
    const manifestDigest = `sha256:${"e".repeat(64)}`;

    const activeWithoutTimestamp = attemptPsql(`
      INSERT INTO "clerk_identity_bindings" (
        "clerk_instance_id", "provider_clerk_user_id", "canonical_clerk_user_id",
        "kind", "status", "batch_id", "verified_email_hash", "manifest_digest",
        "evidence_ref"
      ) VALUES (
        'ins_invalid_active', 'user_invalid_active', 'user_invalid_active', 'native',
        'active', gen_random_uuid(), ${sqlLiteral(emailHash)},
        ${sqlLiteral(manifestDigest)}, 'case:sk229/invalid-active'
      );
    `);
    expect(activeWithoutTimestamp.status).not.toBe(0);
    expect(activeWithoutTimestamp.stderr).toContain("clerk_identity_bindings_lifecycle_shape");

    const revokedWithoutTimestamp = attemptPsql(`
      INSERT INTO "clerk_identity_bindings" (
        "clerk_instance_id", "provider_clerk_user_id", "canonical_clerk_user_id",
        "kind", "status", "batch_id", "verified_email_hash", "manifest_digest",
        "evidence_ref"
      ) VALUES (
        'ins_invalid_revoked', 'user_invalid_revoked', 'user_invalid_revoked', 'native',
        'revoked', gen_random_uuid(), ${sqlLiteral(emailHash)},
        ${sqlLiteral(manifestDigest)}, 'case:sk229/invalid-revoked'
      );
    `);
    expect(revokedWithoutTimestamp.status).not.toBe(0);
    expect(revokedWithoutTimestamp.stderr).toContain("clerk_identity_bindings_lifecycle_shape");

    const activeRelinkInsert = attemptPsql(`
      INSERT INTO "clerk_identity_bindings" (
        "clerk_instance_id", "provider_clerk_user_id", "canonical_clerk_user_id",
        "kind", "status", "batch_id", "verified_email_hash", "source_clerk_instance_id",
        "source_provider_clerk_user_id", "manifest_digest", "evidence_ref", "activated_at"
      ) VALUES (
        'ins_invalid_relink', 'user_invalid_relink', 'user_invalid_canonical', 'relink',
        'active', gen_random_uuid(), ${sqlLiteral(emailHash)}, 'ins_source',
        'user_invalid_canonical', ${sqlLiteral(manifestDigest)},
        'case:sk229/invalid-active-relink', now()
      );
    `);
    expect(activeRelinkInsert.status).not.toBe(0);
    expect(activeRelinkInsert.stderr).toContain("clerk relink bindings must be inserted staged");

    runPsql(`
      INSERT INTO "clerk_identity_bindings" (
        "clerk_instance_id", "provider_clerk_user_id", "canonical_clerk_user_id",
        "kind", "status", "batch_id", "verified_email_hash", "manifest_digest",
        "evidence_ref", "activated_at"
      ) VALUES (
        'ins_source', 'user_canonical', 'user_canonical', 'native', 'active',
        ${sqlLiteral(batchId)}, ${sqlLiteral(emailHash)}, ${sqlLiteral(manifestDigest)},
        'case:sk229/source', now()
      );

      INSERT INTO "clerk_identity_bindings" (
        "clerk_instance_id", "provider_clerk_user_id", "canonical_clerk_user_id",
        "kind", "batch_id", "verified_email_hash", "source_clerk_instance_id",
        "source_provider_clerk_user_id", "manifest_digest", "evidence_ref"
      ) VALUES
        (
          'ins_target', 'user_target', 'user_canonical', 'relink',
          ${sqlLiteral(batchId)}, ${sqlLiteral(emailHash)}, 'ins_source', 'user_canonical',
          ${sqlLiteral(manifestDigest)}, 'case:sk229/target'
        ),
        (
          'ins_rejected', 'user_wrong', 'user_canonical', 'relink',
          ${sqlLiteral(rejectedBatchId)}, ${sqlLiteral(emailHash)}, 'ins_source',
          'user_canonical', ${sqlLiteral(manifestDigest)}, 'case:sk229/rejected'
        );

      UPDATE "clerk_identity_bindings"
      SET "status" = 'revoked', "revoked_at" = now()
      WHERE "batch_id" = ${sqlLiteral(rejectedBatchId)};

      BEGIN;
      SELECT pg_advisory_xact_lock(7468258445703257229::bigint);
      UPDATE "clerk_identity_bindings"
      SET "status" = 'active', "activated_at" = now()
      WHERE "batch_id" = ${sqlLiteral(batchId)}
        AND "kind" = 'relink'
        AND "status" = 'staged';
      COMMIT;
    `);

    expect(
      queryRows<{
        activatedAt: string | null;
        clerkInstanceId: string;
        revokedAt: string | null;
        status: string;
      }>(`
        SELECT
          "clerk_instance_id" AS "clerkInstanceId",
          "status"::text AS "status",
          "activated_at"::text AS "activatedAt",
          "revoked_at"::text AS "revokedAt"
        FROM "clerk_identity_bindings"
        ORDER BY "clerk_instance_id"
      `),
    ).toEqual([
      {
        activatedAt: null,
        clerkInstanceId: "ins_rejected",
        revokedAt: expect.any(String) as string,
        status: "revoked",
      },
      {
        activatedAt: expect.any(String) as string,
        clerkInstanceId: "ins_source",
        revokedAt: null,
        status: "active",
      },
      {
        activatedAt: expect.any(String) as string,
        clerkInstanceId: "ins_target",
        revokedAt: null,
        status: "active",
      },
    ]);

    const evidenceMutation = attemptPsql(`
      UPDATE "clerk_identity_bindings"
      SET "evidence_ref" = 'case:sk229/changed'
      WHERE "clerk_instance_id" = 'ins_target';
    `);
    expect(evidenceMutation.status).not.toBe(0);
    expect(evidenceMutation.stderr).toContain("clerk identity binding evidence is immutable");

    const duplicateProvider = attemptPsql(`
      INSERT INTO "clerk_identity_bindings" (
        "clerk_instance_id", "provider_clerk_user_id", "canonical_clerk_user_id",
        "kind", "batch_id", "verified_email_hash", "source_clerk_instance_id",
        "source_provider_clerk_user_id", "manifest_digest", "evidence_ref"
      ) VALUES (
        'ins_target', 'user_target', 'user_other', 'relink', gen_random_uuid(),
        ${sqlLiteral(emailHash)}, 'ins_source', 'user_other',
        ${sqlLiteral(manifestDigest)}, 'case:sk229/duplicate'
      );
    `);
    expect(duplicateProvider.status).not.toBe(0);
    expect(duplicateProvider.stderr).toContain("clerk provider identity ownership is immutable");

    const rejectedOwnerBatch = randomUUID();
    runPsql(`
      INSERT INTO "clerk_identity_bindings" (
        "clerk_instance_id", "provider_clerk_user_id", "canonical_clerk_user_id",
        "kind", "batch_id", "verified_email_hash", "source_clerk_instance_id",
        "source_provider_clerk_user_id", "manifest_digest", "evidence_ref"
      ) VALUES (
        'ins_owner', 'user_owned_provider', 'user_first_owner', 'relink',
        ${sqlLiteral(rejectedOwnerBatch)}, ${sqlLiteral(emailHash)}, 'ins_source',
        'user_first_owner', ${sqlLiteral(manifestDigest)}, 'case:sk229/first-owner'
      );
      UPDATE "clerk_identity_bindings"
      SET "status" = 'revoked', "revoked_at" = now()
      WHERE "batch_id" = ${sqlLiteral(rejectedOwnerBatch)};
    `);
    const differentOwner = attemptPsql(`
      INSERT INTO "clerk_identity_bindings" (
        "clerk_instance_id", "provider_clerk_user_id", "canonical_clerk_user_id",
        "kind", "batch_id", "verified_email_hash", "source_clerk_instance_id",
        "source_provider_clerk_user_id", "manifest_digest", "evidence_ref"
      ) VALUES (
        'ins_owner', 'user_owned_provider', 'user_second_owner', 'relink', gen_random_uuid(),
        ${sqlLiteral(emailHash)}, 'ins_source', 'user_second_owner',
        ${sqlLiteral(manifestDigest)}, 'case:sk229/second-owner'
      );
    `);
    expect(differentOwner.status).not.toBe(0);
    expect(differentOwner.stderr).toContain("clerk provider identity ownership is immutable");

    const duplicateAccountProvider = attemptPsql(`
      INSERT INTO "registered_accounts" (
        "clerk_user_id", "provider_clerk_user_id", "clerk_instance_id", "provider_state",
        "provider_updated_at", "last_webhook_event_id", "synced_at"
      ) VALUES (
        'user_duplicate_canonical', 'user_with_receipt', 'ins_source', 'active', now(),
        'evt_duplicate_provider', now()
      );
    `);
    expect(duplicateAccountProvider.status).not.toBe(0);
    expect(duplicateAccountProvider.stderr).toContain(
      "registered_accounts_provider_identity_unique",
    );
  });
});
