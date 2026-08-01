import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";

import { SAFE_FOUNDATION_METADATA_KEYS } from "../event-foundation";
import {
  adminActionHistory,
  adminActionOutcome,
  adminActionReceipts,
  adminDataEnvironment,
  adminSensitiveRevealReason,
  adminSupportNotes,
  domainEvents,
  operationalRunKind,
  operationalRuns,
  operationalRunStatus,
  systemProblems,
  systemProblemState,
} from "../schema";

const migration = readFileSync(
  join(process.cwd(), "drizzle/0036_admin_operational_foundation.sql"),
  "utf8",
);

function config(table: PgTable) {
  return getTableConfig(table);
}

function uniqueNames(table: PgTable): string[] {
  return config(table)
    .uniqueConstraints.map((constraint) => constraint.name)
    .filter((name): name is string => name !== undefined);
}

function uniqueColumns(table: PgTable, name: string): string[] {
  const constraint = config(table).uniqueConstraints.find((item) => item.name === name);
  expect(constraint).toBeDefined();
  return constraint?.columns.map((column) => column.name) ?? [];
}

function indexNames(table: PgTable): string[] {
  return config(table)
    .indexes.map((index) => index.config.name)
    .filter((name): name is string => name !== undefined);
}

function checkNames(table: PgTable): string[] {
  return config(table).checks.map((constraint) => constraint.name);
}

describe("SK-132 admin safety and operational data foundation", () => {
  it("pins the Live/Test, outcome, reveal, run, and problem vocabularies", () => {
    expect(adminDataEnvironment.enumValues).toEqual(["live", "test"]);
    expect(adminActionOutcome.enumValues).toEqual(["succeeded", "failed", "partial", "no_change"]);
    expect(adminSensitiveRevealReason.enumValues).toEqual([
      "support_investigation",
      "safety_issue",
    ]);
    expect(operationalRunKind.enumValues).toEqual([
      "job",
      "email",
      "webhook",
      "provider_investigation",
    ]);
    expect(operationalRunStatus.enumValues).toEqual(["running", "succeeded", "failed", "partial"]);
    expect(systemProblemState.enumValues).toEqual(["new", "seen", "resolved"]);
  });

  it("stores environment-scoped idempotent admin history without reveal content", () => {
    expect(adminActionHistory.environment.notNull).toBe(true);
    expect(adminActionHistory.actorClerkUserId.notNull).toBe(true);
    expect(adminActionHistory.targetType.notNull).toBe(true);
    expect(adminActionHistory.targetId.notNull).toBe(true);
    expect(adminActionHistory.operationKey.notNull).toBe(true);
    expect(adminActionHistory.operationDigest.notNull).toBe(true);
    expect(adminActionHistory.occurredAt.notNull).toBe(true);
    expect(uniqueNames(adminActionHistory)).toContain(
      "admin_action_history_environment_operation_unique",
    );
    expect(
      uniqueColumns(adminActionHistory, "admin_action_history_environment_operation_unique"),
    ).toEqual(["environment", "action", "operation_key"]);
    expect(checkNames(adminActionHistory)).toEqual(
      expect.arrayContaining([
        "admin_action_history_environment_shape",
        "admin_action_history_actor_shape",
        "admin_action_history_target_shape",
        "admin_action_history_operation_shape",
        "admin_action_history_digest_shape",
        "admin_action_history_safe_state_shape",
        "admin_action_history_reveal_shape",
      ]),
    );
    expect(indexNames(adminActionHistory)).toEqual(
      expect.arrayContaining([
        "admin_action_history_environment_occurred_idx",
        "admin_action_history_target_occurred_idx",
      ]),
    );

    const historySql = migration.slice(
      migration.indexOf('CREATE TABLE "admin_action_history"'),
      migration.indexOf('CREATE TABLE "admin_support_notes"'),
    );
    expect(historySql).toContain("'sensitive_content.reveal'");
    expect(adminActionHistory.revealContentKind.name).toBe("reveal_content_kind");
    expect(adminActionHistory.revealContentKind.notNull).toBe(false);
    expect(historySql).toContain('"reveal_content_kind" text');
    expect(historySql).toContain(`"reveal_content_kind" ~ '^[a-z][a-z0-9_.-]{0,99}$'`);
    expect(historySql).toMatch(
      /"action" = 'sensitive_content\.reveal'[\s\S]*"reveal_reason" IS NOT NULL[\s\S]*NULLIF\(btrim\("reveal_content_kind"\), ''\) IS NOT NULL[\s\S]*char_length\("reveal_content_kind"\) <= 100[\s\S]*"reveal_content_kind" ~ '\^\[a-z\]\[a-z0-9_.-\]\{0,99\}\$'[\s\S]*"outcome" = 'succeeded'[\s\S]*"failure_code" IS NULL[\s\S]*"safe_before_state" IS NULL[\s\S]*"safe_after_state" IS NULL/,
    );
    expect(historySql).toMatch(
      /"action" <> 'sensitive_content\.reveal'[\s\S]*"reveal_reason" IS NULL[\s\S]*"reveal_content_kind" IS NULL/,
    );
    expect(historySql).toContain(`"safe_after_state" = '{"noteCreated": true}'::jsonb`);
    expect(historySql).toMatch(
      /jsonb_typeof\("safe_before_state" -> 'hasPrivateNote'\) = 'boolean'[\s\S]*"safe_before_state" ->> 'state' IN \('new', 'seen', 'resolved'\)/,
    );
    expect(historySql).toMatch(
      /jsonb_typeof\("safe_after_state" -> 'hasPrivateNote'\) = 'boolean'[\s\S]*"safe_after_state" ->> 'state' IN \('new', 'seen', 'resolved'\)/,
    );
    expect(historySql).not.toMatch(
      /"(?:revealed_content|message_content|file_content|secret|token|password)"/,
    );
    const safeJsonStart = migration.indexOf(
      'CREATE OR REPLACE FUNCTION "skitza_is_safe_admin_json"',
    );
    const safeJsonEnd = migration.indexOf('CREATE TABLE "admin_action_receipts"', safeJsonStart);
    const safeJsonSql = migration.slice(safeJsonStart, safeJsonEnd);
    expect(safeJsonStart).toBeGreaterThanOrEqual(0);
    expect(safeJsonEnd).toBeGreaterThan(safeJsonStart);
    expect(safeJsonSql).toContain("allowed_keys text[]");
    expect(safeJsonSql).toMatch(
      /SELECT count\(\*\) FROM jsonb_object_keys\(value\)[\s\S]*> least\(16, cardinality\(allowed_keys\)\)/,
    );
    expect(safeJsonSql).toContain("^[A-Za-z][A-Za-z0-9]{0,63}$");
    expect(safeJsonSql).toContain("jsonb_each(value)");
    expect(safeJsonSql).toContain("entry.key = ANY(allowed_keys)");
    expect(safeJsonSql).toContain("NOT IN ('string', 'number', 'boolean', 'null')");
    expect(safeJsonSql).toContain("char_length(entry.value #>> '{}') > 200");
    expect(safeJsonSql).toContain("^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$");
    expect(safeJsonSql).toContain("9007199254740991");

    const allowedArrays = [...migration.matchAll(/ARRAY\[([^\]]+)\]/g)].map((match) =>
      [...(match[1] ?? "").matchAll(/'([^']+)'/g)].map((item) => item[1]),
    );
    const actualAllowedKeys = [...new Set(allowedArrays.flat())].sort();
    const expectedAllowedKeys = [
      ...new Set(Object.values(SAFE_FOUNDATION_METADATA_KEYS).flat()),
    ].sort();
    expect(actualAllowedKeys).toEqual(expectedAllowedKeys);
    expect(allowedArrays).toEqual(
      expect.arrayContaining([
        ["noteCreated"],
        ["hasPrivateNote", "state"],
        ["changed", "fieldCount"],
        ["batchSize", "durationMs"],
      ]),
    );

    for (const forbiddenKey of [
      "body",
      "content",
      "credential",
      "credentials",
      "databaseurl",
      "email",
      "file",
      "filecontents",
      "message",
      "objectkey",
      "password",
      "payload",
      "providerresponse",
      "r2key",
      "recipientemail",
      "requestbody",
      "responsebody",
      "secret",
      "stacktrace",
      "storagekey",
      "token",
      "url",
    ]) {
      expect(actualAllowedKeys).not.toContain(forbiddenKey);
      expect(safeJsonSql).not.toContain(`'${forbiddenKey}'`);
    }

    const domainSql = migration.slice(
      migration.indexOf('CREATE TABLE "domain_events"'),
      migration.indexOf('CREATE TABLE "operational_runs"'),
    );
    expect(domainSql).toMatch(
      /jsonb_typeof\("safe_metadata" -> 'changed'\) = 'boolean'[\s\S]*jsonb_typeof\("safe_metadata" -> 'fieldCount'\) = 'number'[\s\S]*trunc\(\("safe_metadata" ->> 'fieldCount'\)::numeric\)/,
    );
    const operationalSql = migration.slice(
      migration.indexOf('CREATE TABLE "operational_runs"'),
      migration.indexOf('CREATE TABLE "system_problems"'),
    );
    expect(operationalSql).toMatch(
      /jsonb_typeof\("safe_metadata" -> 'batchSize'\) = 'number'[\s\S]*trunc\(\("safe_metadata" ->> 'batchSize'\)::numeric\)[\s\S]*jsonb_typeof\("safe_metadata" -> 'durationMs'\) = 'number'[\s\S]*trunc\(\("safe_metadata" ->> 'durationMs'\)::numeric\)/,
    );
  });

  it("keeps durable action dedupe receipts outside expiring history", () => {
    expect(adminActionReceipts.environment.notNull).toBe(true);
    expect(adminActionReceipts.action.notNull).toBe(true);
    expect(adminActionReceipts.operationKey.notNull).toBe(true);
    expect(adminActionReceipts.operationDigest.notNull).toBe(true);
    expect(adminActionReceipts.resultId.notNull).toBe(true);
    expect(uniqueNames(adminActionReceipts)).toContain(
      "admin_action_receipts_environment_action_operation_unique",
    );
    expect(
      uniqueColumns(
        adminActionReceipts,
        "admin_action_receipts_environment_action_operation_unique",
      ),
    ).toEqual(["environment", "action", "operation_key"]);
    expect(checkNames(adminActionReceipts)).toEqual(
      expect.arrayContaining([
        "admin_action_receipts_environment_shape",
        "admin_action_receipts_identity_shape",
        "admin_action_receipts_digest_shape",
      ]),
    );
    expect(indexNames(adminActionReceipts)).toContain(
      "admin_action_receipts_environment_created_idx",
    );
    const receiptSql = migration.slice(
      migration.indexOf('CREATE TABLE "admin_action_receipts"'),
      migration.indexOf('CREATE TABLE "admin_action_history"'),
    );
    expect(receiptSql).toMatch(
      /NULLIF\(btrim\("action"\), ''\) IS NOT NULL[\s\S]*char_length\("action"\) <= 100/,
    );
    expect(receiptSql).toMatch(
      /NULLIF\(btrim\("operation_key"\), ''\) IS NOT NULL[\s\S]*char_length\("operation_key"\) <= 255/,
    );
    expect(receiptSql).toMatch(
      /NULLIF\(btrim\("result_id"\), ''\) IS NOT NULL[\s\S]*char_length\("result_id"\) <= 255/,
    );
    expect(migration).toMatch(
      /CREATE TRIGGER "admin_action_receipts_append_only"[\s\S]*BEFORE UPDATE OR DELETE[\s\S]*prevent_append_only_mutation/,
    );

    const purgeStart = migration.indexOf(
      'CREATE OR REPLACE FUNCTION "purge_expired_admin_action_history"',
    );
    const purgeEnd = migration.indexOf(
      'CREATE OR REPLACE FUNCTION "skitza_guard_admin_support_note_update"',
      purgeStart,
    );
    expect(migration.slice(purgeStart, purgeEnd)).not.toContain("admin_action_receipts");
  });

  it("keeps private support notes immutable and domain events append-only and retry-safe", () => {
    for (const table of [adminSupportNotes, domainEvents]) {
      expect(table.environment.notNull).toBe(true);
      expect(table.operationKey.notNull).toBe(true);
      expect(table.operationDigest.notNull).toBe(true);
    }

    expect(uniqueNames(adminSupportNotes)).toContain(
      "admin_support_notes_environment_operation_unique",
    );
    expect(checkNames(adminSupportNotes)).toEqual(
      expect.arrayContaining([
        "admin_support_notes_environment_shape",
        "admin_support_notes_target_shape",
        "admin_support_notes_body_shape",
        "admin_support_notes_operation_shape",
        "admin_support_notes_digest_shape",
      ]),
    );
    expect(uniqueNames(domainEvents)).toContain("domain_events_environment_operation_unique");
    expect(uniqueColumns(domainEvents, "domain_events_environment_operation_unique")).toEqual([
      "environment",
      "event_name",
      "operation_key",
    ]);
    expect(checkNames(domainEvents)).toEqual(
      expect.arrayContaining([
        "domain_events_environment_shape",
        "domain_events_event_shape",
        "domain_events_positive_version",
        "domain_events_target_shape",
        "domain_events_operation_shape",
        "domain_events_digest_shape",
        "domain_events_safe_metadata_shape",
      ]),
    );
    expect(migration).toMatch(
      /CREATE TRIGGER "admin_support_notes_immutable"[\s\S]*BEFORE UPDATE ON "admin_support_notes"[\s\S]*skitza_guard_admin_support_note_update/,
    );
    const supportTriggerStart = migration.indexOf('CREATE TRIGGER "admin_support_notes_immutable"');
    const supportTriggerEnd = migration.indexOf(
      'CREATE TRIGGER "domain_events_append_only"',
      supportTriggerStart,
    );
    expect(migration.slice(supportTriggerStart, supportTriggerEnd)).not.toContain(
      "BEFORE UPDATE OR DELETE",
    );
    expect(migration).toMatch(
      /CREATE TRIGGER "domain_events_append_only"[\s\S]*BEFORE UPDATE OR DELETE[\s\S]*prevent_append_only_mutation/,
    );
    expect(indexNames(domainEvents)).toEqual(
      expect.arrayContaining([
        "domain_events_target_occurred_idx",
        "domain_events_actor_occurred_idx",
      ]),
    );
    expect(migration).not.toContain("domain_events_producer_fk");
  });

  it("records retry attempts and protects terminal operational outcomes", () => {
    expect(operationalRuns.environment.notNull).toBe(true);
    expect(operationalRuns.kind.notNull).toBe(true);
    expect(operationalRuns.attemptNumber.notNull).toBe(true);
    expect(operationalRuns.status.notNull).toBe(true);
    expect(operationalRuns.status.hasDefault).toBe(true);
    expect(operationalRuns.status.default).toBe("running");
    expect(uniqueNames(operationalRuns)).toContain(
      "operational_runs_environment_operation_attempt_unique",
    );
    expect(
      uniqueColumns(operationalRuns, "operational_runs_environment_operation_attempt_unique"),
    ).toEqual(["environment", "kind", "operation_name", "operation_key", "attempt_number"]);
    expect(checkNames(operationalRuns)).toEqual(
      expect.arrayContaining([
        "operational_runs_environment_shape",
        "operational_runs_operation_shape",
        "operational_runs_digest_shape",
        "operational_runs_positive_attempt",
        "operational_runs_target_shape",
        "operational_runs_provider_shape",
        "operational_runs_safe_metadata_shape",
        "operational_runs_status_shape",
      ]),
    );
    expect(indexNames(operationalRuns)).toEqual(
      expect.arrayContaining([
        "operational_runs_environment_started_idx",
        "operational_runs_target_started_idx",
        "operational_runs_environment_kind_status_idx",
      ]),
    );
    expect(migration).toContain("SKITZA_OPERATIONAL_RUN_INTENT_IMMUTABLE");
    expect(migration).toContain("SKITZA_OPERATIONAL_RUN_INITIAL_STATE");
    expect(migration).toContain("SKITZA_OPERATIONAL_RUN_TERMINAL");
    expect(migration).toContain("SKITZA_OPERATIONAL_RUN_UPDATE_REGRESSION");
    const operationalTableSql = migration.slice(
      migration.indexOf('CREATE TABLE "operational_runs"'),
      migration.indexOf('CREATE TABLE "system_problems"'),
    );
    const operationalGuardSql = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION "skitza_guard_operational_run"'),
      migration.indexOf('CREATE OR REPLACE FUNCTION "skitza_guard_system_problem"'),
    );
    expect(operationalTableSql).toContain(
      '"status" "operational_run_status" DEFAULT \'running\' NOT NULL',
    );
    expect(operationalTableSql).toContain('"finished_at" >= greatest("started_at", "created_at")');
    expect(operationalTableSql).toContain('"created_at" >= "started_at"');
    expect(operationalTableSql).toContain('"updated_at" >= COALESCE("finished_at", "created_at")');
    expect(operationalTableSql).toMatch(
      /"status" = 'running'[\s\S]*"finished_at" IS NULL[\s\S]*"error_code" IS NULL[\s\S]*"provider_reference" IS NULL/,
    );
    expect(migration).toMatch(
      /"status" = 'succeeded'[\s\S]*"error_code" IS NULL[\s\S]*"status" IN \('failed', 'partial'\)[\s\S]*NULLIF\(btrim\("error_code"\), ''\) IS NOT NULL[\s\S]*"error_code" ~ '\^\[a-z\]\[a-z0-9_.-\]\{0,99\}\$'/,
    );
    expect(operationalGuardSql).toMatch(
      /TG_OP = 'INSERT'[\s\S]*NEW\."status" <> 'running'[\s\S]*NEW\."finished_at" IS NOT NULL[\s\S]*NEW\."error_code" IS NOT NULL[\s\S]*NEW\."provider_reference" IS NOT NULL[\s\S]*SKITZA_OPERATIONAL_RUN_INITIAL_STATE/,
    );
    expect(operationalGuardSql).toMatch(
      /NEW\."updated_at" < OLD\."updated_at"[\s\S]*SKITZA_OPERATIONAL_RUN_UPDATE_REGRESSION/,
    );
    expect(operationalGuardSql).toMatch(
      /CREATE TRIGGER "operational_runs_guard"[\s\S]*BEFORE INSERT OR UPDATE OR DELETE[\s\S]*skitza_guard_operational_run/,
    );
  });

  it("stores isolated, stateful system problems that can reopen on recurrence", () => {
    expect(systemProblems.environment.notNull).toBe(true);
    expect(systemProblems.fingerprint.notNull).toBe(true);
    expect(systemProblems.status.notNull).toBe(true);
    expect(systemProblems.status.hasDefault).toBe(true);
    expect(systemProblems.status.default).toBe("new");
    expect(uniqueNames(systemProblems)).toContain("system_problems_environment_fingerprint_unique");
    expect(checkNames(systemProblems)).toEqual(
      expect.arrayContaining([
        "system_problems_environment_shape",
        "system_problems_fingerprint_shape",
        "system_problems_identity_shape",
        "system_problems_provider_shape",
        "system_problems_observation_shape",
        "system_problems_state_shape",
      ]),
    );
    expect(indexNames(systemProblems)).toContain("system_problems_environment_status_idx");
    expect(migration).toContain("SKITZA_SYSTEM_PROBLEM_IDENTITY_IMMUTABLE");
    expect(migration).toContain("SKITZA_SYSTEM_PROBLEM_INITIAL_STATE");
    expect(migration).toContain("SKITZA_SYSTEM_PROBLEM_STATE_TRANSITION");
    expect(migration).toContain("SKITZA_SYSTEM_PROBLEM_RECURRENCE_REQUIRED");
    expect(migration).toContain("SKITZA_SYSTEM_PROBLEM_UPDATE_REGRESSION");
    expect(migration).toContain("SKITZA_SYSTEM_PROBLEM_SEEN_IMMUTABLE");
    expect(migration).toContain("SKITZA_SYSTEM_PROBLEM_RESOLUTION_IMMUTABLE");
    expect(migration).not.toContain("skitza.admin_problem_transition");
    const systemProblemTableSql = migration.slice(
      migration.indexOf('CREATE TABLE "system_problems"'),
      migration.indexOf('CREATE TRIGGER "admin_action_receipts_append_only"'),
    );
    const systemProblemGuardSql = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION "skitza_guard_system_problem"'),
    );
    expect(systemProblemTableSql).toContain('"last_observed_at" >= "first_observed_at"');
    expect(systemProblemTableSql).toContain('"created_at" >= "first_observed_at"');
    expect(systemProblemTableSql).toContain(
      '"updated_at" >= greatest("created_at", "last_observed_at")',
    );
    expect(systemProblemTableSql).toContain('"seen_at" IS NULL OR "seen_at" >= "created_at"');
    expect(systemProblemTableSql).toContain('"seen_at" IS NULL OR "updated_at" >= "seen_at"');
    expect(systemProblemTableSql).toContain(
      '"resolved_at" IS NULL OR "resolved_at" >= "created_at"',
    );
    expect(systemProblemTableSql).toContain(
      '"resolved_at" IS NULL OR "updated_at" >= "resolved_at"',
    );
    expect(systemProblemGuardSql).toMatch(
      /TG_OP = 'INSERT'[\s\S]*NEW\."status" <> 'new'[\s\S]*NEW\."seen_at" IS NOT NULL[\s\S]*NEW\."seen_by_clerk_user_id" IS NOT NULL[\s\S]*NEW\."resolved_at" IS NOT NULL[\s\S]*NEW\."resolved_by_clerk_user_id" IS NOT NULL[\s\S]*SKITZA_SYSTEM_PROBLEM_INITIAL_STATE/,
    );
    expect(systemProblemGuardSql).toContain("OLD.\"status\" IN ('seen', 'resolved')");
    expect(systemProblemGuardSql).toContain("OLD.\"status\" = 'resolved'");
    expect(systemProblemGuardSql).toContain(
      `OLD."status" = 'new'
      AND NEW."status" IN ('seen', 'resolved')`,
    );
    expect(systemProblemGuardSql).toContain(
      `OLD."status" = 'seen'
      AND NEW."status" = 'resolved'`,
    );
    expect(systemProblemGuardSql).toMatch(
      /OLD\."status" IN \('seen', 'resolved'\)[\s\S]*AND NOT \([\s\S]*OLD\."status" = 'resolved'[\s\S]*NEW\."status" = 'new'[\s\S]*\)[\s\S]*ROW\(NEW\."seen_at", NEW\."seen_by_clerk_user_id"\)[\s\S]*IS DISTINCT FROM ROW\(OLD\."seen_at", OLD\."seen_by_clerk_user_id"\)[\s\S]*SKITZA_SYSTEM_PROBLEM_SEEN_IMMUTABLE/,
    );
    expect(migration).toMatch(
      /"status" = 'resolved'[\s\S]*"seen_at" IS NOT NULL[\s\S]*"seen_at" >= "first_observed_at"/,
    );
    expect(migration).toMatch(/"resolved_at" >= "last_observed_at"/);
    expect(migration).toMatch(
      /OLD\."status" = 'resolved'[\s\S]*NEW\."status" = 'new'[\s\S]*NEW\."last_observed_at"[\s\S]*<= greatest\(OLD\."last_observed_at", OLD\."resolved_at"\)/,
    );
    expect(systemProblemGuardSql).toMatch(
      /CREATE TRIGGER "system_problems_guard"[\s\S]*BEFORE INSERT OR UPDATE OR DELETE[\s\S]*skitza_guard_system_problem/,
    );
  });

  it("purges only one environment and only rows strictly older than 90 days", () => {
    const purgeStart = migration.indexOf(
      'CREATE OR REPLACE FUNCTION "purge_expired_admin_action_history"',
    );
    const purgeEnd = migration.indexOf(
      'CREATE OR REPLACE FUNCTION "skitza_guard_admin_support_note_update"',
      purgeStart,
    );
    const purgeSql = migration.slice(purgeStart, purgeEnd);

    expect(purgeStart).toBeGreaterThanOrEqual(0);
    expect(purgeEnd).toBeGreaterThan(purgeStart);
    expect(purgeSql).toContain("SKITZA_ADMIN_HISTORY_PURGE_ENVIRONMENT_REQUIRED");
    expect(purgeSql).toContain("set_config('skitza.admin_history_purge', 'enabled', true)");
    expect(purgeSql).toMatch(
      /DELETE FROM "admin_action_history"[\s\S]*"environment" = p_environment[\s\S]*"occurred_at" < statement_timestamp\(\) - interval '90 days'/,
    );
    expect(migration).toMatch(
      /current_setting\('skitza\.admin_history_purge', true\) = 'enabled'[\s\S]*OLD\."occurred_at" < statement_timestamp\(\) - interval '90 days'/,
    );
    expect(migration).toMatch(
      /CREATE TRIGGER "admin_action_history_immutable"[\s\S]*BEFORE UPDATE OR DELETE[\s\S]*skitza_guard_admin_action_history/,
    );
    expect(purgeSql).toContain("SECURITY INVOKER");
    expect(purgeSql).not.toContain("SECURITY DEFINER");
    expect(migration).not.toContain('REVOKE ALL ON FUNCTION "purge_expired_admin_action_history"');
    expect(migration).not.toMatch(/\b(?:cron|scheduler|schedule)\b/i);
  });
});
