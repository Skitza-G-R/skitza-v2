import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  accountClosureEvents,
  accountClosureRequests,
  accountClosureTaskKind,
  accountClosureTasks,
  producers,
} from "../schema";

const migration = readFileSync(
  join(process.cwd(), "drizzle/0050_account_closure_foundation.sql"),
  "utf8",
);

const expectedTaskKinds = [
  "google_calendar_disconnect",
  "device_and_artist_preferences_cleanup",
  "clerk_account_delete",
  "public_and_capability_link_revoke",
  "account_profile_deidentification",
  "storage_review_and_cleanup",
  "retained_record_review",
  "diagnostic_provider_cleanup",
  "backup_expiry_tracking",
] as const;

describe("SK-229 account closure foundation", () => {
  it("is sequenced after the approved 0049 migration", () => {
    expect(migration).toContain("SKITZA_0050_REQUIRES_0049");
    expect(migration).toContain("'0049_producer_invitation_grants.sql'");
  });

  it("closes Producer access without changing stable identity", () => {
    expect(producers.closedAt.name).toBe("closed_at");
    expect(producers.closedAt.notNull).toBe(false);
    expect(migration).toContain('ALTER TABLE "producers"');
    expect(migration).toContain('ADD COLUMN "closed_at" timestamp with time zone');
    expect(migration).not.toMatch(/UPDATE\s+"producers"\s+SET\s+"clerk_user_id"/i);
    expect(migration).toContain('CREATE TRIGGER "producers_closed_at_one_way"');
  });

  it("tracks verified requests, the exact 30-day due date, and legal holds", () => {
    const config = getTableConfig(accountClosureRequests);
    expect(accountClosureRequests.closureStartedAt.notNull).toBe(false);
    expect(accountClosureRequests.accessRevokedAt.notNull).toBe(false);
    expect(accountClosureRequests.dueAt.notNull).toBe(false);
    expect(accountClosureRequests.legalHoldReasonCode.notNull).toBe(false);
    expect(config.uniqueConstraints.map((constraint) => constraint.name)).toContain(
      "account_closure_requests_clerk_user_unique",
    );
    expect(migration).toContain('"due_at" = "identity_verified_at" + interval \'30 days\'');
    expect(migration).toContain('"legal_hold_released_at"');
  });

  it("requires evidence for every terminal work item and immutable audit events", () => {
    const taskConfig = getTableConfig(accountClosureTasks);
    const eventConfig = getTableConfig(accountClosureEvents);
    expect(taskConfig.primaryKeys.map((key) => key.name)).toContain("account_closure_tasks_pk");
    expect(eventConfig.uniqueConstraints.map((constraint) => constraint.name)).toContain(
      "account_closure_events_operation_unique",
    );
    expect(migration).toContain("\"status\" IN ('succeeded', 'not_applicable')");
    expect(migration).toContain("NULLIF(btrim(\"evidence_ref\"), '') IS NOT NULL");
    expect(migration).toMatch(
      /CREATE TRIGGER "account_closure_events_append_only"[\s\S]*BEFORE UPDATE OR DELETE ON "account_closure_events"/,
    );
  });

  it("keeps external and storage deletion as explicit tasks", () => {
    const migrationEnum = migration.match(
      /CREATE TYPE "account_closure_task_kind" AS ENUM \(([\s\S]*?)\);/,
    );
    const migrationTaskKinds = [...(migrationEnum?.[1]?.matchAll(/'([^']+)'/g) ?? [])].map(
      (match) => match[1],
    );

    expect(accountClosureTaskKind.enumValues).toEqual(expectedTaskKinds);
    expect(migrationTaskKinds).toEqual(expectedTaskKinds);
  });
});
