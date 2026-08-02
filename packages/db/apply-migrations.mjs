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
const PRIVATE_OFFER_RECIPIENT_MIGRATION = "0029_private_offer_recipient_identity.sql";
const APPROVED_HISTORICAL_CUTOVER_DIGEST =
  "7cd77f778f677d89ebfeeac3cc0eefed8ff5cfb0c0f68c2991733edd16ba5112";
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
const TRANSACTION_GUARD_SAVEPOINT_SQL = 'SAVEPOINT "skitza_migration_runner_transaction_guard"';
const TRANSACTION_GUARD_RELEASE_SQL =
  'RELEASE SAVEPOINT "skitza_migration_runner_transaction_guard"';
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
const productionAdapterApprovals = new WeakSet();
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
const APPROVED_CUTOVER_DIRECTORY = fileURLToPath(new URL("./drizzle/", import.meta.url));
const APPROVED_HISTORICAL_COMPATIBILITY_LEDGER = Object.freeze(
  [STABLE_OWNERSHIP_MIGRATION, PRIVATE_OFFER_RECIPIENT_MIGRATION].map((filename) => ({
    filename,
    digest: migrationDigest(
      readFileSync(new URL(`./drizzle/${filename}`, import.meta.url), "utf8"),
    ),
  })),
);
const APPROVED_CUTOVER_FILES = Object.freeze([
  "0027_purchase_foundation.sql",
  "0028_stable_client_ownership.sql",
  "0029_private_offer_recipient_identity.sql",
  "0030_song_release_state.sql",
  "0031_purchase_ledger_runtime.sql",
  "0032_purchase_session_allowance.sql",
  "0033_purchase_version_download_overrides.sql",
  "0034_song_public_access.sql",
]);
const APPROVED_CUTOVER_BUNDLE_DIGEST = `sha256:${createHash("sha256")
  .update(
    JSON.stringify(
      APPROVED_CUTOVER_FILES.map((filename) => ({
        filename,
        digest: migrationDigest(
          readFileSync(new URL(filename, pathToFileURL(`${APPROVED_CUTOVER_DIRECTORY}/`)), "utf8"),
        ),
      })),
    ),
    "utf8",
  )
  .digest("hex")}`;

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

/**
 * Verify the exact completed catalog shared by the approved historical and
 * current 0027 cutovers after the immutable 0028 and 0029 extensions. The two
 * 0027 files differ only in their accepted source tax_mode default and the
 * current file's explicit SET DEFAULT; both finish with tax_free. Every
 * extension below is pinned by name, definition, body, and inventory digest.
 */
function historicalChat3StructureVerificationStatement() {
  let verifier = chat3StructureVerificationStatement(APPROVED_CUTOVER_CONTENT);

  for (const [expected, replacement] of [
    ["a9e205f4f1b636413e899e76147a1756", "41fed0c25ee45d713867ca511e26dd98"],
    ["ed847cb606dd766f90c2b1de0e798785", "30ed03952efd543b08e01888bfffbdce"],
    ["d80c8a527557cd653f3838bbdda546d6", "4e522999a4d4af73005780672c1a0f87"],
    ["2f4f547b09747ee6481fabe09b2fd3b7", "7469e719f0ae9ec49eebb308e6117826"],
    ["SKITZA_0027_TARGET_SCHEMA_DRIFT", "SKITZA_0027_HISTORICAL_TARGET_SCHEMA_DRIFT"],
  ]) {
    verifier = replaceExactlyOnce(verifier, expected, replacement);
  }

  verifier = replaceExactlyOnce(
    verifier,
    "('private_offers', 'id:pg_catalog.uuid:NO:gen_random_uuid(),producer_id:pg_catalog.uuid:NO:<none>,client_contact_id:pg_catalog.uuid:NO:<none>,target_project_id:pg_catalog.uuid:YES:<none>,product_id:pg_catalog.uuid:YES:<none>,status:public.private_offer_status:NO:draft,commercial_draft:pg_catalog.jsonb:NO:<none>,expires_at:pg_catalog.timestamptz:NO:<none>,accepted_at:pg_catalog.timestamptz:YES:<none>,created_at:pg_catalog.timestamptz:NO:now(),updated_at:pg_catalog.timestamptz:NO:now()')",
    "('private_offers', 'id:pg_catalog.uuid:NO:gen_random_uuid(),producer_id:pg_catalog.uuid:NO:<none>,client_contact_id:pg_catalog.uuid:NO:<none>,target_project_id:pg_catalog.uuid:YES:<none>,product_id:pg_catalog.uuid:YES:<none>,status:public.private_offer_status:NO:draft,commercial_draft:pg_catalog.jsonb:NO:<none>,expires_at:pg_catalog.timestamptz:NO:<none>,accepted_at:pg_catalog.timestamptz:YES:<none>,created_at:pg_catalog.timestamptz:NO:now(),updated_at:pg_catalog.timestamptz:NO:now(),recipient_email:pg_catalog.text:NO:<none>,recipient_email_hash:pg_catalog.text:NO:<none>')",
  );
  verifier = replaceExactlyOnce(
    verifier,
    "      OR to_regclass('public.agreement_acceptances') IS NOT NULL",
    `      OR (
        SELECT string_agg(
          column_name || ':' || udt_schema || '.' || udt_name || ':' || is_nullable || ':' ||
            COALESCE(
              CASE
                WHEN column_default ~ '^''[^'']*''::' THEN
                  regexp_replace(column_default, '^''([^'']*)''::.*$', '\\1')
                ELSE column_default
              END,
              '<none>'
            ),
          ',' ORDER BY ordinal_position
        )
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'client_contacts'
      ) IS DISTINCT FROM 'id:pg_catalog.uuid:NO:gen_random_uuid(),producer_id:pg_catalog.uuid:NO:<none>,email_hash:pg_catalog.text:NO:<none>,email:pg_catalog.text:NO:<none>,name:pg_catalog.text:NO:<none>,first_seen_at:pg_catalog.timestamptz:NO:now(),last_seen_at:pg_catalog.timestamptz:NO:now(),tags:pg_catalog._text:NO:{},notes:pg_catalog.text:YES:<none>,referral_source:pg_catalog.text:YES:<none>,clerk_user_id:pg_catalog.text:YES:<none>,archived_at:pg_catalog.timestamptz:YES:<none>,invited_at:pg_catalog.timestamptz:YES:<none>,position:pg_catalog.int4:NO:0,phone:pg_catalog.text:YES:<none>,producer_archived_at:pg_catalog.timestamptz:YES:<none>'
      OR to_regclass('public.agreement_acceptances') IS NOT NULL`,
  );
  verifier = replaceExactlyOnce(
    verifier,
    "          ('private_offers', 'private_offers_product_producer_fk'),",
    `          ('private_offers', 'private_offers_product_producer_fk'),
          ('private_offers', 'private_offers_recipient_email_hash_shape'),`,
  );
  verifier = replaceExactlyOnce(
    verifier,
    "      OR EXISTS (\n        SELECT 1\n        FROM (VALUES\n          ('projects', 'projects_producer_lifecycle_idx'",
    `      OR NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE pg_constraint.conrelid = 'public.private_offers'::regclass
          AND pg_constraint.conname = 'private_offers_recipient_email_hash_shape'
          AND pg_constraint.contype = 'c'
          AND pg_constraint.convalidated
          AND NOT pg_constraint.connoinherit
          AND pg_get_constraintdef(pg_constraint.oid, false) =
            $historical_check$CHECK ((recipient_email_hash ~ '^[0-9a-f]{64}$'::text))$historical_check$
      )
      OR EXISTS (
        SELECT 1
        FROM (VALUES
          ('projects', 'projects_producer_lifecycle_idx'`,
  );
  verifier = replaceExactlyOnce(
    verifier,
    "          ('private_offers', 'private_offers_producer_status_expiry_idx', $index$CREATE INDEX private_offers_producer_status_expiry_idx ON public.private_offers USING btree (producer_id, status, expires_at)$index$),",
    `          ('private_offers', 'private_offers_producer_status_expiry_idx', $index$CREATE INDEX private_offers_producer_status_expiry_idx ON public.private_offers USING btree (producer_id, status, expires_at)$index$),
          ('private_offers', 'private_offers_recipient_status_expiry_idx', $index$CREATE INDEX private_offers_recipient_status_expiry_idx ON public.private_offers USING btree (recipient_email_hash, status, expires_at)$index$),`,
  );
  verifier = replaceExactlyOnce(
    verifier,
    "          ('bookings', 'bookings_protect_identity', 'protect_booking_identity', 27),",
    `          ('bookings', 'bookings_protect_identity', 'protect_booking_identity', 27),
          ('client_contacts', 'client_contacts_empty_draft_delete_only', 'skitza_guard_client_contact_delete', 11),
          ('client_contacts', 'client_contacts_owner_immutable', 'skitza_guard_client_contact_owner', 19),
          ('private_offers', 'private_offers_recipient_identity_immutable', 'skitza_guard_private_offer_recipient_identity', 19),
          ('projects', 'projects_empty_draft_delete_only', 'skitza_guard_project_delete', 11),
          ('projects', 'projects_owner_immutable', 'skitza_guard_project_owner', 19),`,
  );
  verifier = replaceExactlyOnce(
    verifier,
    "      OR EXISTS (\n        SELECT 1\n        FROM (VALUES\n          ('prevent_append_only_mutation', '02474ebe9014c9c5269a35b4469682f6')",
    `      OR EXISTS (
        SELECT 1
        FROM (VALUES
          ('client_contacts', 'client_contacts_empty_draft_delete_only', $trigger$CREATE TRIGGER client_contacts_empty_draft_delete_only BEFORE DELETE ON public.client_contacts FOR EACH ROW EXECUTE FUNCTION skitza_guard_client_contact_delete()$trigger$),
          ('client_contacts', 'client_contacts_owner_immutable', $trigger$CREATE TRIGGER client_contacts_owner_immutable BEFORE UPDATE OF producer_id, clerk_user_id ON public.client_contacts FOR EACH ROW EXECUTE FUNCTION skitza_guard_client_contact_owner()$trigger$),
          ('private_offers', 'private_offers_recipient_identity_immutable', $trigger$CREATE TRIGGER private_offers_recipient_identity_immutable BEFORE UPDATE OF recipient_email, recipient_email_hash ON public.private_offers FOR EACH ROW EXECUTE FUNCTION skitza_guard_private_offer_recipient_identity()$trigger$),
          ('projects', 'projects_empty_draft_delete_only', $trigger$CREATE TRIGGER projects_empty_draft_delete_only BEFORE DELETE ON public.projects FOR EACH ROW EXECUTE FUNCTION skitza_guard_project_delete()$trigger$),
          ('projects', 'projects_owner_immutable', $trigger$CREATE TRIGGER projects_owner_immutable BEFORE UPDATE OF producer_id, client_contact_id ON public.projects FOR EACH ROW EXECUTE FUNCTION skitza_guard_project_owner()$trigger$)
        ) AS historical_trigger("table_name", "trigger_name", "trigger_definition")
        WHERE NOT EXISTS (
          SELECT 1
          FROM pg_trigger
          WHERE pg_trigger.tgrelid = to_regclass(format('public.%I', historical_trigger."table_name"))
            AND pg_trigger.tgname = historical_trigger."trigger_name"
            AND pg_get_triggerdef(pg_trigger.oid, false) = historical_trigger."trigger_definition"
            AND NOT pg_trigger.tgisinternal
        )
      )
      OR EXISTS (
        SELECT 1
        FROM (VALUES
          ('prevent_append_only_mutation', '02474ebe9014c9c5269a35b4469682f6')`,
  );
  verifier = replaceExactlyOnce(
    verifier,
    "          ('protect_session_allowance_terms', '358913a6c660186afa4c8f6e0ab28801'),",
    `          ('protect_session_allowance_terms', '358913a6c660186afa4c8f6e0ab28801'),
          ('skitza_guard_client_contact_delete', 'be4215c158bee47e248ad10447f96099'),
          ('skitza_guard_client_contact_owner', 'eccc2a2d3cc17e9655f2688d8ec32e84'),
          ('skitza_guard_private_offer_recipient_identity', '8c6ae01a7a3226e2a34bf6bc4fb277ce'),
          ('skitza_guard_project_delete', 'e11e166bbae07013aea1b2b81ccf8bd4'),
          ('skitza_guard_project_owner', '06e08a8bbf293b37ec1c55f24483b439'),`,
  );

  const statements = splitStatements(verifier);
  if (statements.length !== 1) throw fail("SKITZA_CHAT3_VERIFIER_SOURCE_INVALID");
  return statements[0];
}

function historicalCutoverCompatibilityStatement() {
  const verifier = historicalChat3StructureVerificationStatement();
  const outerTag = "$skitza_historical_cutover$";
  const statementTag = "$skitza_historical_cutover_statement$";
  const exactLedgerPredicates = [
    { filename: CUTOVER_FLOOR, digest: APPROVED_HISTORICAL_CUTOVER_DIGEST },
    ...APPROVED_HISTORICAL_COMPATIBILITY_LEDGER,
  ]
    .map(
      ({ filename, digest }) =>
        `NOT EXISTS (SELECT 1 FROM "skitza_migrations"."applied" WHERE "filename" = '${filename}' AND "digest" = '${digest}')`,
    )
    .join("\n    OR ");

  return `-- SKITZA_0027_HISTORICAL_COMPATIBILITY_GUARD
DO ${outerTag}
BEGIN
  IF ${exactLedgerPredicates} THEN
    RAISE EXCEPTION 'SKITZA_MIGRATION_DIGEST_MISMATCH';
  END IF;
  EXECUTE ${statementTag}${verifier}${statementTag};
END
${outerTag}`;
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

/**
 * Brand the exact 0027 file and fresh production-cutover contract approved by
 * SK-104. The caller must supply both the independently observed database
 * fingerprint and the exact canonical fingerprint recorded in that contract;
 * raw provider identifiers never enter this runner.
 */
function createSk104ProductionAdapterApproval(input) {
  assertAdapterBindingShape(input);
  if (
    input?.targetClass !== "canonical_production" ||
    input.filename !== CUTOVER_FLOOR ||
    !SHA256_DIGEST_PATTERN.test(input.canonicalProductionTargetDatabaseFingerprint ?? "") ||
    input.targetDatabaseFingerprint !== input.canonicalProductionTargetDatabaseFingerprint ||
    input.migrationBundleDigest !== APPROVED_CUTOVER_BUNDLE_DIGEST ||
    !RAW_SHA256_PATTERN.test(input.migrationDigest ?? "") ||
    input.migrationDigest !== APPROVED_CUTOVER_DIGEST
  ) {
    throw fail("SKITZA_MIGRATION_ADAPTER_APPROVAL_INVALID");
  }
  const approval = Object.freeze({ ...input });
  productionAdapterApprovals.add(approval);
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
    ADAPTER_BINDING_DIGEST_FIELDS.some((field) => approval[field] !== expectedBinding[field]) ||
    approval.actionChallengeToken !== expectedBinding.actionChallengeToken
  ) {
    throw fail("SKITZA_MIGRATION_ADAPTER_APPROVAL_INVALID");
  }
}

function assertSk104ProductionAdapterApproval(approval, filename, digest, expectedBinding) {
  if (!approval) throw fail("SKITZA_MIGRATION_ADAPTER_APPROVAL_REQUIRED");
  assertAdapterBindingShape(expectedBinding);
  if (
    typeof approval !== "object" ||
    !productionAdapterApprovals.has(approval) ||
    approval.targetClass !== "canonical_production" ||
    approval.filename !== filename ||
    approval.migrationDigest !== digest ||
    !SHA256_DIGEST_PATTERN.test(
      expectedBinding.canonicalProductionTargetDatabaseFingerprint ?? "",
    ) ||
    expectedBinding.targetDatabaseFingerprint !==
      expectedBinding.canonicalProductionTargetDatabaseFingerprint ||
    approval.canonicalProductionTargetDatabaseFingerprint !==
      expectedBinding.canonicalProductionTargetDatabaseFingerprint ||
    approval.migrationBundleDigest !== APPROVED_CUTOVER_BUNDLE_DIGEST ||
    expectedBinding.migrationBundleDigest !== APPROVED_CUTOVER_BUNDLE_DIGEST ||
    ADAPTER_BINDING_DIGEST_FIELDS.some((field) => approval[field] !== expectedBinding[field]) ||
    approval.actionChallengeToken !== expectedBinding.actionChallengeToken
  ) {
    throw fail("SKITZA_MIGRATION_ADAPTER_APPROVAL_INVALID");
  }
}

function assertTransactionalCutoverAdapterApproval(approval, filename, digest, expectedBinding) {
  if (!approval) throw fail("SKITZA_MIGRATION_ADAPTER_APPROVAL_REQUIRED");
  if (adapterApprovals.has(approval)) {
    assertSk90AdapterApproval(approval, filename, digest, expectedBinding);
    return;
  }
  assertSk104ProductionAdapterApproval(approval, filename, digest, expectedBinding);
}

async function assertCallerTransaction(client) {
  try {
    await client.query(TRANSACTION_GUARD_SAVEPOINT_SQL);
    await client.query(TRANSACTION_GUARD_RELEASE_SQL);
  } catch (cause) {
    throw fail("SKITZA_MIGRATION_CALLER_TRANSACTION_REQUIRED", cause);
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

async function assertHistoricalCompatibilityLedger(sql) {
  for (const { filename, digest } of APPROVED_HISTORICAL_COMPATIBILITY_LEDGER) {
    if ((await appliedDigest(sql, filename)) !== digest) {
      throw fail("SKITZA_MIGRATION_DIGEST_MISMATCH");
    }
  }
}

async function verifyHistoricalCutoverCompatibility(sql) {
  const statement = historicalCutoverCompatibilityStatement();
  try {
    await sql.transaction(
      (transactionSql) => [
        transactionSql(RUNNER_LOCK_SQL),
        transactionSql(LEDGER_SCHEMA_SQL),
        transactionSql(LEDGER_TABLE_SQL),
        transactionSql(LEDGER_LOCK_SQL),
        transactionSql(statement),
      ],
      { isolationLevel: "ReadCommitted" },
    );
  } catch (cause) {
    throw fail("SKITZA_MIGRATION_FAILED", cause);
  }

  if ((await appliedDigest(sql, CUTOVER_FLOOR)) !== APPROVED_HISTORICAL_CUTOVER_DIGEST) {
    throw fail("SKITZA_MIGRATION_LEDGER_COMMIT_INVALID");
  }
  await assertHistoricalCompatibilityLedger(sql);
  return "SKITZA_MIGRATION_VERIFIED";
}

async function applyMigration(sql, filename, content, options = {}) {
  const digest = migrationDigest(content);
  const recordedDigest = await appliedDigest(sql, filename);
  if (recordedDigest !== null) {
    const isHistoricalCutover =
      filename === CUTOVER_FLOOR && recordedDigest === APPROVED_HISTORICAL_CUTOVER_DIGEST;
    if (recordedDigest !== digest && !isHistoricalCutover) {
      throw fail("SKITZA_MIGRATION_DIGEST_MISMATCH");
    }
    if (isHistoricalCutover) {
      await assertHistoricalCompatibilityLedger(sql);
      if (await hasAppliedLaterMigration(sql, PRIVATE_OFFER_RECIPIENT_MIGRATION)) {
        return "SKITZA_MIGRATION_ALREADY_APPLIED";
      }
      return verifyHistoricalCutoverCompatibility(sql);
    }
    if (filename !== CUTOVER_FLOOR) return "SKITZA_MIGRATION_ALREADY_APPLIED";
    if (await hasAppliedLaterMigration(sql, filename)) {
      return "SKITZA_MIGRATION_ALREADY_APPLIED";
    }
  }
  if (filename === CUTOVER_FLOOR && recordedDigest === null) {
    assertSk90AdapterApproval(options.adapterApproval, filename, digest, options.adapterBinding);
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
  assertTransactionalCutoverAdapterApproval(adapterApproval, filename, digest, adapterBinding);
  await assertCallerTransaction(client);
  return applyApprovedMigrationInActiveTransaction(client, filename, content, digest);
}

async function applyApprovedMigrationInActiveTransaction(client, filename, content, digest) {
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

async function applyLaterMigrationInTransaction(client, filename, content) {
  if (filename <= CUTOVER_FLOOR) throw fail("SKITZA_MIGRATION_FILENAME_INVALID");
  const digest = migrationDigest(content);
  const statements = splitStatements(content);
  const guardedMigration = postLockMigrationStatement(filename, digest, statements);
  const chat3StructureGuard =
    filename === STABLE_OWNERSHIP_MIGRATION
      ? postLockChat3StructureStatement(filename, digest)
      : null;

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
    if (chat3StructureGuard !== null) await client.query(chat3StructureGuard);
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

/**
 * Apply the exact approved 0027-0034 bundle inside the caller-owned production
 * transaction. The caller must roll back on any failure and commit only after
 * its reset and preserved-data checks also pass.
 */
async function applyApprovedCutoverBundleInTransaction(
  client,
  directory,
  productionApproval,
  productionBinding,
) {
  const files = cutoverFiles(readdirSync(directory));
  if (JSON.stringify(files) !== JSON.stringify(APPROVED_CUTOVER_FILES)) {
    throw fail("SKITZA_MIGRATION_DIGEST_MISMATCH");
  }
  const capturedMigrations = files.map((filename) => {
    const content = readFileSync(new URL(filename, pathToFileURL(`${directory}/`)), "utf8");
    return { filename, content, digest: migrationDigest(content) };
  });
  const observedBundleDigest = `sha256:${createHash("sha256")
    .update(
      JSON.stringify(
        capturedMigrations.map(({ filename, digest }) => ({
          filename,
          digest,
        })),
      ),
      "utf8",
    )
    .digest("hex")}`;
  if (observedBundleDigest !== APPROVED_CUTOVER_BUNDLE_DIGEST) {
    throw fail("SKITZA_MIGRATION_DIGEST_MISMATCH");
  }

  const cutoverFloor = capturedMigrations[0];
  if (!cutoverFloor || cutoverFloor.filename !== CUTOVER_FLOOR) {
    throw fail("SKITZA_MIGRATION_DIGEST_MISMATCH");
  }
  assertSk104ProductionAdapterApproval(
    productionApproval,
    cutoverFloor.filename,
    cutoverFloor.digest,
    productionBinding,
  );
  await assertCallerTransaction(client);

  const results = [];
  for (const { filename, content, digest } of capturedMigrations) {
    const status =
      filename === CUTOVER_FLOOR
        ? await applyApprovedMigrationInActiveTransaction(client, filename, content, digest)
        : await applyLaterMigrationInTransaction(client, filename, content);
    results.push({ filename, status });
  }
  return results;
}

async function applyCutoverMigrations(sql, directory) {
  const files = cutoverFiles(readdirSync(directory));
  const results = [];
  for (const filename of files) {
    const content = readFileSync(new URL(filename, pathToFileURL(`${directory}/`)), "utf8");
    results.push({
      filename,
      status: await applyMigration(sql, filename, content),
    });
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
  APPROVED_CUTOVER_BUNDLE_DIGEST,
  CUTOVER_FLOOR,
  applyApprovedCutoverBundleInTransaction,
  applyCutoverMigrations,
  applyMigration,
  applyMigrationInTransaction,
  chat3StructureVerificationStatement,
  createSk104ProductionAdapterApproval,
  createSk90AdapterApproval,
  cutoverFiles,
  databaseUrl,
  hasAppliedLaterMigration,
  migrationDigest,
  postLockMigrationStatement,
  splitStatements,
};
