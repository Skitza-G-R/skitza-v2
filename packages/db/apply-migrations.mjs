// Applies the SK-90 schema cutover and later migrations through the approved
// migration path. The historical 0000-0026 files describe schemas that the
// isolated reset deliberately replaces; replaying them can recreate removed
// commercial/card objects before 0027 gets a chance to reject the target.
//
// Every cutover migration and its immutable digest-ledger record are submitted
// as one Neon HTTP transaction. A transaction-level advisory lock serializes
// even the first ledger bootstrap before catalog DDL. A failed migration
// therefore cannot leave a ledger table or partially committed statements
// behind. A matching ledger row makes later migrations a no-op; 0027 still
// runs its completed-target verifier so post-apply drift fails closed. A
// changed file fails before any migration SQL runs. Before 0028 runs, a
// read-only verifier derived from immutable 0027 checks the real Chat 3
// catalog under the same lock and transaction as 0028. Once a later immutable
// ledger entry exists, replaying the exact Chat 3 baseline would reject valid
// extensions, so only the matching later ledger entry is treated as a no-op.
//
// The generic CLI can verify an already-applied 0027 and apply later files.
// Only the isolated reset adapter may perform the initial 0027 cutover.

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

import { neon } from "@neondatabase/serverless";

const CUTOVER_FLOOR = "0027_purchase_foundation.sql";
const STABLE_OWNERSHIP_MIGRATION = "0028_stable_client_ownership.sql";
const LEDGER_RELATION = "skitza_migrations.applied";
const RUNNER_LOCK_SQL = "SELECT pg_advisory_xact_lock(7468258445703257129::bigint)";
const LEDGER_SCHEMA_SQL = 'CREATE SCHEMA IF NOT EXISTS "skitza_migrations"';
const LEDGER_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS "skitza_migrations"."applied" (
  "filename" text PRIMARY KEY,
  "digest" text NOT NULL,
  "applied_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "skitza_migrations_filename_shape"
    CHECK ("filename" ~ '^[0-9]{4}_[a-z0-9_]+[.]sql$'),
  CONSTRAINT "skitza_migrations_digest_sha256"
    CHECK ("digest" ~ '^[0-9a-f]{64}$')
)`;
const LEDGER_LOCK_SQL = 'LOCK TABLE "skitza_migrations"."applied" IN SHARE ROW EXCLUSIVE MODE';
const LEDGER_INSERT_SQL = `
INSERT INTO "skitza_migrations"."applied" ("filename", "digest")
VALUES ($1, $2)
ON CONFLICT ("filename") DO NOTHING`;
const LEDGER_VERIFY_SQL = `
INSERT INTO "skitza_migrations"."applied" ("filename", "digest")
SELECT 'SKITZA_MIGRATION_DIGEST_MISMATCH.sql', 'SKITZA_MIGRATION_DIGEST_MISMATCH'
WHERE NOT EXISTS (
  SELECT 1
  FROM "skitza_migrations"."applied"
  WHERE "filename" = $1 AND "digest" = $2
)`;
const SHA256_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const RAW_SHA256_PATTERN = /^[0-9a-f]{64}$/;
const PROTECTED_TOKEN_PATTERN = /^hmac-sha256:[0-9a-f]{64}$/;
const adapterApprovals = new WeakSet();
const ADAPTER_BINDING_DIGEST_FIELDS = [
  "artifactDigest",
  "manifestDigest",
  "policyDigest",
  "targetDatabaseFingerprint",
  "targetObservationDigest",
  "executionApprovalDigest",
  "freshAuthorizationDigest",
];

function fail(code, cause) {
  return new Error(code, cause === undefined ? undefined : { cause });
}

function cutoverFiles(filenames) {
  const sqlFiles = filenames.filter((filename) => filename.endsWith(".sql")).sort();
  if (!sqlFiles.includes(CUTOVER_FLOOR)) {
    throw fail("SKITZA_MIGRATION_CUTOVER_FLOOR_MISSING");
  }
  return sqlFiles.filter((filename) => filename >= CUTOVER_FLOOR);
}

function migrationDigest(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

const APPROVED_CUTOVER_CONTENT = readFileSync(
  new URL(`./drizzle/${CUTOVER_FLOOR}`, import.meta.url),
  "utf8",
);
const APPROVED_CUTOVER_DIGEST = migrationDigest(APPROVED_CUTOVER_CONTENT);

function replaceExactlyOnce(source, expected, replacement) {
  const start = source.indexOf(expected);
  if (start === -1 || source.indexOf(expected, start + expected.length) !== -1) {
    throw fail("SKITZA_CHAT3_VERIFIER_SOURCE_INVALID");
  }
  return `${source.slice(0, start)}${replacement}${source.slice(start + expected.length)}`;
}

/**
 * Keep the rehearsed 0027 immutable while extracting only its read-only
 * completed-target verifier. The PG17 catalog corrections are already part
 * of the approved 0027 content and digest.
 */
function chat3StructureVerificationStatement(cutoverContent) {
  if (migrationDigest(cutoverContent) !== APPROVED_CUTOVER_DIGEST) {
    throw fail("SKITZA_CHAT3_VERIFIER_SOURCE_INVALID");
  }

  const verifier = replaceExactlyOnce(
    cutoverContent,
    "IF to_regclass('public.purchases') IS NOT NULL THEN",
    `IF to_regclass('public.purchases') IS NULL THEN
    RAISE EXCEPTION 'SKITZA_CHAT3_STRUCTURE_REQUIRED';
  END IF;
  IF to_regclass('public.purchases') IS NOT NULL THEN`,
  );
  const completedTargetEnd = "    RETURN;\n  END IF;";
  const completedTargetEndAt = verifier.indexOf(completedTargetEnd);
  if (
    completedTargetEndAt === -1 ||
    verifier.indexOf(completedTargetEnd, completedTargetEndAt + completedTargetEnd.length) !== -1
  ) {
    throw fail("SKITZA_CHAT3_VERIFIER_SOURCE_INVALID");
  }
  const completedVerifier = `${verifier.slice(
    0,
    completedTargetEndAt + completedTargetEnd.length,
  )}\nEND\n$migration$;`;

  const statements = splitStatements(completedVerifier);
  if (statements.length !== 1) throw fail("SKITZA_CHAT3_VERIFIER_SOURCE_INVALID");
  return statements[0];
}

function postLockChat3StructureStatement(filename, digest) {
  const verifier = chat3StructureVerificationStatement(APPROVED_CUTOVER_CONTENT);
  const outerTag = `$skitza_chat3_${digest}$`;
  const statementTag = `$skitza_chat3_statement_${digest}$`;
  if (verifier.includes(outerTag) || verifier.includes(statementTag)) {
    throw fail("SKITZA_MIGRATION_SQL_TAG_COLLISION");
  }

  return `-- SKITZA_CHAT3_STRUCTURE_GUARD
DO ${outerTag}
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "skitza_migrations"."applied"
    WHERE "filename" = '${filename}' AND "digest" <> '${digest}'
  ) THEN
    RAISE EXCEPTION 'SKITZA_MIGRATION_DIGEST_MISMATCH';
  ELSIF NOT EXISTS (
    SELECT 1
    FROM "skitza_migrations"."applied"
    WHERE "filename" = '${filename}'
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "skitza_migrations"."applied"
      WHERE "filename" = '${CUTOVER_FLOOR}'
        AND "digest" = '${APPROVED_CUTOVER_DIGEST}'
    ) THEN
      RAISE EXCEPTION 'SKITZA_CHAT3_LEDGER_REQUIRED';
    END IF;
    EXECUTE ${statementTag}${verifier}${statementTag};
  END IF;
END
${outerTag}`;
}

function assertAdapterBindingShape(binding) {
  if (
    !binding ||
    typeof binding !== "object" ||
    ADAPTER_BINDING_DIGEST_FIELDS.some(
      (field) => !SHA256_DIGEST_PATTERN.test(binding[field] ?? ""),
    ) ||
    !PROTECTED_TOKEN_PATTERN.test(binding.actionChallengeToken ?? "")
  ) {
    throw fail("SKITZA_MIGRATION_ADAPTER_APPROVAL_INVALID");
  }
}

/**
 * Brand the exact 0027 file and reset artifact that the isolated rehearsal
 * adapter already approved. The generic migration CLI cannot mint or infer
 * this approval from a database URL.
 */
function createSk90AdapterApproval(input) {
  assertAdapterBindingShape(input);
  if (
    input?.targetClass !== "isolated_nonproduction" ||
    input.filename !== CUTOVER_FLOOR ||
    !SHA256_DIGEST_PATTERN.test(input.artifactDigest ?? "") ||
    !SHA256_DIGEST_PATTERN.test(input.manifestDigest ?? "") ||
    !SHA256_DIGEST_PATTERN.test(input.policyDigest ?? "") ||
    !RAW_SHA256_PATTERN.test(input.migrationDigest ?? "") ||
    input.migrationDigest !== APPROVED_CUTOVER_DIGEST
  ) {
    throw fail("SKITZA_MIGRATION_ADAPTER_APPROVAL_INVALID");
  }
  const approval = Object.freeze({ ...input });
  adapterApprovals.add(approval);
  return approval;
}

function assertSk90AdapterApproval(approval, filename, digest, expectedBinding) {
  if (!approval) throw fail("SKITZA_MIGRATION_ADAPTER_APPROVAL_REQUIRED");
  assertAdapterBindingShape(expectedBinding);
  if (
    typeof approval !== "object" ||
    !adapterApprovals.has(approval) ||
    approval.targetClass !== "isolated_nonproduction" ||
    approval.filename !== filename ||
    approval.migrationDigest !== digest ||
    ADAPTER_BINDING_DIGEST_FIELDS.some(
      (field) => approval[field] !== expectedBinding[field],
    ) ||
    approval.actionChallengeToken !== expectedBinding.actionChallengeToken
  ) {
    throw fail("SKITZA_MIGRATION_ADAPTER_APPROVAL_INVALID");
  }
}

function postLockMigrationStatement(filename, digest, statements) {
  if (!/^[0-9]{4}_[a-z0-9_]+[.]sql$/.test(filename)) {
    throw fail("SKITZA_MIGRATION_FILENAME_INVALID");
  }
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    throw fail("SKITZA_MIGRATION_DIGEST_INVALID");
  }

  const outerTag = `$skitza_runner_${digest}$`;
  const source = statements.join("\n");
  if (source.includes(outerTag)) throw fail("SKITZA_MIGRATION_SQL_TAG_COLLISION");
  const executions = statements.map((statement, index) => {
    const statementTag = `$skitza_statement_${digest}_${index}$`;
    if (statement.includes(statementTag)) throw fail("SKITZA_MIGRATION_SQL_TAG_COLLISION");
    return `      EXECUTE ${statementTag}${statement}${statementTag};`;
  });
  const matchingCutoverVerification =
    filename === CUTOVER_FLOOR
      ? `
    OR EXISTS (
      SELECT 1
      FROM "skitza_migrations"."applied"
      WHERE "filename" = '${filename}' AND "digest" = '${digest}'
    )`
      : "";

  return `-- SKITZA_MIGRATION_POST_LOCK_GUARD
DO ${outerTag}
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "skitza_migrations"."applied"
    WHERE "filename" = '${filename}' AND "digest" <> '${digest}'
  ) THEN
    RAISE EXCEPTION 'SKITZA_MIGRATION_DIGEST_MISMATCH';
  ELSIF NOT EXISTS (
    SELECT 1
    FROM "skitza_migrations"."applied"
    WHERE "filename" = '${filename}'
  )${matchingCutoverVerification} THEN
${executions.join("\n")}
  END IF;
END
${outerTag}`;
}

function splitStatements(source) {
  const statements = [];
  let buffer = "";
  let dollarTag = null;
  let singleQuoted = false;
  let doubleQuoted = false;
  let lineComment = false;
  let blockCommentDepth = 0;

  for (let index = 0; index < source.length; ) {
    const current = source[index];
    const next = source[index + 1];

    if (lineComment) {
      buffer += current;
      index += 1;
      if (current === "\n") lineComment = false;
      continue;
    }

    if (blockCommentDepth > 0) {
      if (current === "/" && next === "*") {
        buffer += "/*";
        blockCommentDepth += 1;
        index += 2;
      } else if (current === "*" && next === "/") {
        buffer += "*/";
        blockCommentDepth -= 1;
        index += 2;
      } else {
        buffer += current;
        index += 1;
      }
      continue;
    }

    if (dollarTag !== null) {
      if (source.startsWith(dollarTag, index)) {
        buffer += dollarTag;
        index += dollarTag.length;
        dollarTag = null;
      } else {
        buffer += current;
        index += 1;
      }
      continue;
    }

    if (singleQuoted) {
      buffer += current;
      index += 1;
      if (current !== "'") continue;
      if (source[index] === "'") {
        buffer += "'";
        index += 1;
      } else {
        singleQuoted = false;
      }
      continue;
    }

    if (doubleQuoted) {
      buffer += current;
      index += 1;
      if (current !== '"') continue;
      if (source[index] === '"') {
        buffer += '"';
        index += 1;
      } else {
        doubleQuoted = false;
      }
      continue;
    }

    if (current === "-" && next === "-") {
      buffer += "--";
      lineComment = true;
      index += 2;
      continue;
    }
    if (current === "/" && next === "*") {
      buffer += "/*";
      blockCommentDepth = 1;
      index += 2;
      continue;
    }
    if (current === "'") {
      buffer += current;
      singleQuoted = true;
      index += 1;
      continue;
    }
    if (current === '"') {
      buffer += current;
      doubleQuoted = true;
      index += 1;
      continue;
    }
    if (current === "$") {
      const match = source.slice(index).match(/^\$([A-Za-z0-9_]*)\$/);
      if (match) {
        dollarTag = match[0];
        buffer += dollarTag;
        index += dollarTag.length;
        continue;
      }
    }
    if (current === ";") {
      if (buffer.trim()) statements.push(buffer.trim());
      buffer = "";
      index += 1;
      continue;
    }

    buffer += current;
    index += 1;
  }

  if (dollarTag !== null || singleQuoted || doubleQuoted || blockCommentDepth > 0) {
    throw fail("SKITZA_MIGRATION_SQL_UNTERMINATED");
  }
  if (buffer.trim()) statements.push(buffer.trim());
  if (statements.length === 0) throw fail("SKITZA_MIGRATION_SQL_EMPTY");
  if (statements.some((statement) => /^(?:BEGIN|COMMIT|ROLLBACK)\b/i.test(statement))) {
    throw fail("SKITZA_MIGRATION_TRANSACTION_WRAPPER_FORBIDDEN");
  }
  return statements;
}

async function appliedDigest(sql, filename) {
  const relationRows = await sql("SELECT to_regclass($1) AS ledger_relation", [LEDGER_RELATION]);
  if (!Array.isArray(relationRows) || relationRows.length !== 1) {
    throw fail("SKITZA_MIGRATION_LEDGER_DISCOVERY_INVALID");
  }
  const relation = relationRows[0]?.ledger_relation;
  if (relation === null) return null;
  if (typeof relation !== "string" || relation.length === 0) {
    throw fail("SKITZA_MIGRATION_LEDGER_DISCOVERY_INVALID");
  }

  const rows = await sql(
    'SELECT "digest" FROM "skitza_migrations"."applied" WHERE "filename" = $1',
    [filename],
  );
  if (!Array.isArray(rows) || rows.length > 1) {
    throw fail("SKITZA_MIGRATION_LEDGER_STATE_INVALID");
  }
  if (rows.length === 0) return null;
  const digest = rows[0]?.digest;
  if (typeof digest !== "string" || !/^[0-9a-f]{64}$/.test(digest)) {
    throw fail("SKITZA_MIGRATION_LEDGER_STATE_INVALID");
  }
  return digest;
}

async function hasAppliedLaterMigration(sql, filename) {
  const rows = await sql(
    `SELECT 1 AS "later_migration"
     FROM "skitza_migrations"."applied"
     WHERE "filename" > $1
     ORDER BY "filename"
     LIMIT 1`,
    [filename],
  );
  if (!Array.isArray(rows) || rows.length > 1) {
    throw fail("SKITZA_MIGRATION_LEDGER_STATE_INVALID");
  }
  return rows.length === 1 && rows[0]?.later_migration === 1;
}

async function applyMigration(sql, filename, content, options = {}) {
  const digest = migrationDigest(content);
  const recordedDigest = await appliedDigest(sql, filename);
  if (recordedDigest !== null) {
    if (recordedDigest !== digest) {
      throw fail("SKITZA_MIGRATION_DIGEST_MISMATCH");
    }
    if (filename !== CUTOVER_FLOOR) return "SKITZA_MIGRATION_ALREADY_APPLIED";
    if (await hasAppliedLaterMigration(sql, filename)) {
      return "SKITZA_MIGRATION_ALREADY_APPLIED";
    }
  }
  if (filename === CUTOVER_FLOOR && recordedDigest === null) {
    assertSk90AdapterApproval(
      options.adapterApproval,
      filename,
      digest,
      options.adapterBinding,
    );
  }

  const statements =
    filename === CUTOVER_FLOOR && recordedDigest === digest
      ? [chat3StructureVerificationStatement(content)]
      : splitStatements(content);
  const guardedMigration = postLockMigrationStatement(filename, digest, statements);
  const chat3StructureGuard =
    filename === STABLE_OWNERSHIP_MIGRATION && recordedDigest === null
      ? postLockChat3StructureStatement(filename, digest)
      : null;
  try {
    await sql.transaction(
      (transactionSql) => [
        // This must be the first statement: concurrent first runs cannot race
        // CREATE SCHEMA/TABLE before the ledger exists. Read Committed gives
        // every post-wait statement a fresh view of the winning transaction.
        transactionSql(RUNNER_LOCK_SQL),
        transactionSql(LEDGER_SCHEMA_SQL),
        transactionSql(LEDGER_TABLE_SQL),
        transactionSql(LEDGER_LOCK_SQL),
        ...(chat3StructureGuard === null ? [] : [transactionSql(chat3StructureGuard)]),
        transactionSql(guardedMigration),
        transactionSql(LEDGER_INSERT_SQL, [filename, digest]),
        // A concurrent invocation may have passed the read-only preflight
        // before this transaction acquired the advisory lock. The impossible
        // sentinel violates both ledger shape checks on a digest conflict,
        // rolling the migration and ledger bootstrap back together.
        transactionSql(LEDGER_VERIFY_SQL, [filename, digest]),
      ],
      { isolationLevel: "ReadCommitted" },
    );
  } catch (cause) {
    throw fail("SKITZA_MIGRATION_FAILED", cause);
  }

  const committedDigest = await appliedDigest(sql, filename);
  if (committedDigest !== digest) {
    throw fail("SKITZA_MIGRATION_LEDGER_COMMIT_INVALID");
  }
  return recordedDigest === digest ? "SKITZA_MIGRATION_VERIFIED" : "SKITZA_MIGRATION_APPLIED";
}

async function transactionRows(client, statement, parameters) {
  const result = await client.query(statement, parameters);
  if (!result || !Array.isArray(result.rows)) {
    throw fail("SKITZA_MIGRATION_LEDGER_STATE_INVALID");
  }
  return result.rows;
}

/**
 * Apply 0027 and its immutable ledger entry inside an already-open adapter
 * transaction. This keeps row reset, schema cutover, ledger, and post-checks
 * in one atomic boundary on one interactive Neon Pool session.
 */
async function applyMigrationInTransaction(
  client,
  filename,
  content,
  adapterApproval,
  adapterBinding,
) {
  const digest = migrationDigest(content);
  assertSk90AdapterApproval(adapterApproval, filename, digest, adapterBinding);
  const statements = splitStatements(content);
  const guardedMigration = postLockMigrationStatement(filename, digest, statements);

  await client.query(RUNNER_LOCK_SQL);
  await client.query(LEDGER_SCHEMA_SQL);
  await client.query(LEDGER_TABLE_SQL);
  await client.query(LEDGER_LOCK_SQL);
  const existing = await transactionRows(
    client,
    'SELECT "digest" FROM "skitza_migrations"."applied" WHERE "filename" = $1',
    [filename],
  );
  if (existing.length > 1) throw fail("SKITZA_MIGRATION_LEDGER_STATE_INVALID");
  const recordedDigest = existing[0]?.digest ?? null;
  if (recordedDigest !== null && recordedDigest !== digest) {
    throw fail("SKITZA_MIGRATION_DIGEST_MISMATCH");
  }

  try {
    await client.query(guardedMigration);
    await client.query(LEDGER_INSERT_SQL, [filename, digest]);
    await client.query(LEDGER_VERIFY_SQL, [filename, digest]);
  } catch (cause) {
    throw fail("SKITZA_MIGRATION_FAILED", cause);
  }

  const committed = await transactionRows(
    client,
    'SELECT "digest" FROM "skitza_migrations"."applied" WHERE "filename" = $1',
    [filename],
  );
  if (committed.length !== 1 || committed[0]?.digest !== digest) {
    throw fail("SKITZA_MIGRATION_LEDGER_COMMIT_INVALID");
  }
  return recordedDigest === digest ? "SKITZA_MIGRATION_VERIFIED" : "SKITZA_MIGRATION_APPLIED";
}

async function applyCutoverMigrations(sql, directory) {
  const files = cutoverFiles(readdirSync(directory));
  const results = [];
  for (const filename of files) {
    const content = readFileSync(new URL(filename, pathToFileURL(`${directory}/`)), "utf8");
    results.push({ filename, status: await applyMigration(sql, filename, content) });
  }
  return results;
}

function databaseUrl(environment) {
  const configured = [
    environment.DATABASE_URL,
    environment.DATABASE_URL_NEON,
    environment.POSTGRES_URL_NON_POOLING,
    environment.POSTGRES_URL,
  ].filter((value) => typeof value === "string" && value.trim().length > 0);
  if (configured.length > 1) throw fail("SKITZA_MIGRATION_DATABASE_URL_AMBIGUOUS");
  return configured[0] ?? null;
}

async function main() {
  const dbUrl = databaseUrl(process.env);
  if (!dbUrl) throw fail("SKITZA_MIGRATION_DATABASE_URL_MISSING");

  const sql = neon(dbUrl);
  const directory = fileURLToPath(new URL("./drizzle/", import.meta.url));
  const results = await applyCutoverMigrations(sql, directory);
  for (const result of results) {
    console.log(`${result.filename}: ${result.status}`);
  }
}

const isMain =
  typeof process.argv[1] === "string" && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  main().catch((error) => {
    const code = error instanceof Error ? error.message : "SKITZA_MIGRATION_FAILED";
    console.error(code.startsWith("SKITZA_MIGRATION_") ? code : "SKITZA_MIGRATION_FAILED");
    process.exitCode = 1;
  });
}

export {
  CUTOVER_FLOOR,
  applyCutoverMigrations,
  applyMigration,
  applyMigrationInTransaction,
  chat3StructureVerificationStatement,
  createSk90AdapterApproval,
  cutoverFiles,
  databaseUrl,
  hasAppliedLaterMigration,
  migrationDigest,
  postLockMigrationStatement,
  splitStatements,
};
