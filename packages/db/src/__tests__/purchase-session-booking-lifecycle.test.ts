import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";

import * as schema from "../schema";

const migrationPath = join(process.cwd(), "drizzle/0032_purchase_session_allowance.sql");

function config(table: PgTable) {
  return getTableConfig(table);
}

function uniqueNames(table: PgTable): string[] {
  return config(table)
    .uniqueConstraints.map((constraint) => constraint.name)
    .filter((name): name is string => name !== undefined);
}

function indexNames(table: PgTable): string[] {
  return config(table)
    .indexes.map((index) => index.config.name)
    .filter((name): name is string => name !== undefined);
}

function foreignKeyNames(table: PgTable): string[] {
  return config(table).foreignKeys.map((key) => key.getName());
}

function checkNames(table: PgTable): string[] {
  return config(table).checks.map((constraint) => constraint.name);
}

function migrationSql(): string {
  expect(existsSync(migrationPath), "reserved SK-68 migration 0032").toBe(true);
  return readFileSync(migrationPath, "utf8");
}

describe("SK-68 purchase-owned booking command schema", () => {
  it("stores an immutable create intent and one replacement lineage per reschedule", () => {
    expect(schema.bookings.operationKey.notNull).toBe(true);
    expect(schema.bookings.operationDigest.notNull).toBe(true);
    expect(schema.bookings.startsAt.notNull).toBe(true);
    expect(schema.bookings.durationMin.notNull).toBe(true);
    expect(schema.bookings.rescheduledFromBookingId.notNull).toBe(false);

    expect([...uniqueNames(schema.bookings), ...indexNames(schema.bookings)]).toEqual(
      expect.arrayContaining([
        "bookings_producer_operation_key_unique",
        "bookings_rescheduled_from_unique",
      ]),
    );
    expect(foreignKeyNames(schema.bookings)).toContain("bookings_rescheduled_from_producer_fk");
    expect(checkNames(schema.bookings)).toEqual(
      expect.arrayContaining(["bookings_operation_shape", "bookings_status_outcome_shape"]),
    );
  });

  it("stores append-only tenant-bound transition intent and before/after state", () => {
    expect(schema.bookingTransitionKind.enumValues).toEqual(
      expect.arrayContaining([
        "created",
        "confirmed",
        "rejected",
        "artist_cancelled",
        "producer_cancelled",
        "rescheduled",
        "completed",
        "no_show",
      ]),
    );
    expect(schema.bookingTransitionActorKind.enumValues).toEqual(
      expect.arrayContaining(["artist", "producer", "system"]),
    );

    const events = schema.bookingTransitionEvents;
    expect(events.bookingId.notNull).toBe(true);
    expect(events.producerId.notNull).toBe(true);
    expect(events.operationKey.notNull).toBe(true);
    expect(events.operationDigest.notNull).toBe(true);
    expect(events.kind.notNull).toBe(true);
    expect(events.actorKind.notNull).toBe(true);
    expect(events.actorId.notNull).toBe(false);
    expect(events.toStatus.notNull).toBe(true);
    expect(events.toOutcome.notNull).toBe(true);
    expect(events.occurredAt.notNull).toBe(true);

    expect(uniqueNames(events)).toContain("booking_transition_events_operation_key_unique");
    expect(foreignKeyNames(events)).toContain("booking_transition_events_booking_producer_fk");
    expect(checkNames(events)).toEqual(
      expect.arrayContaining([
        "booking_transition_events_operation_shape",
        "booking_transition_events_actor_shape",
        "booking_transition_events_state_shape",
        "booking_transition_events_reschedule_shape",
      ]),
    );
  });

  it("keeps purchased session terms and fixed/unlimited capacity well-shaped", () => {
    expect(schema.purchaseSessionAllowances.durationMin.notNull).toBe(true);
    expect(schema.purchaseSessionAllowances.locationType.notNull).toBe(true);
    expect(schema.purchaseSessionAllowances.bufferMinutes.notNull).toBe(true);
    expect(schema.purchaseSessionAllowances.minLeadHours.notNull).toBe(true);
    expect(checkNames(schema.purchaseSessionAllowances)).toEqual(
      expect.arrayContaining([
        "purchase_session_allowances_limit_shape",
        "purchase_session_allowances_close_shape",
        "purchase_session_allowances_terms_shape",
      ]),
    );
  });
});

describe("SK-68 purchase-owned booking migration", () => {
  it("uses only reserved migration 0032 and adds durable command identity", () => {
    const migration = migrationSql();

    expect(migration).toMatch(/ALTER TABLE "bookings"[\s\S]*"operation_key"/);
    expect(migration).toMatch(/ALTER TABLE "bookings"[\s\S]*"operation_digest"/);
    expect(migration).toMatch(/ALTER TABLE "bookings"[\s\S]*"rescheduled_from_booking_id"/);
    expect(migration).toContain("bookings_producer_operation_key_unique");
    expect(migration).toContain("bookings_rescheduled_from_unique");
    expect(migration).toContain("bookings_rescheduled_from_producer_fk");
    expect(migration).toContain("bookings_operation_shape");
    expect(migration).toContain("bookings_status_outcome_shape");
    expect(migration).toContain("purchase_session_allowances_terms_shape");
  });

  it("creates append-only transition history with operation replay protection", () => {
    const migration = migrationSql();

    expect(migration).toMatch(/CREATE TYPE "booking_transition_kind"/);
    expect(migration).toMatch(/CREATE TYPE "booking_transition_actor_kind"/);
    expect(migration).toMatch(/CREATE TABLE "booking_transition_events"/);
    expect(migration).toContain("booking_transition_events_operation_key_unique");
    expect(migration).toContain("booking_transition_events_booking_producer_fk");
    expect(migration).toContain("booking_transition_events_operation_shape");
    expect(migration).toContain("booking_transition_events_actor_shape");
    expect(migration).toContain("booking_transition_events_state_shape");
    expect(migration).toContain("booking_transition_events_reschedule_shape");
    expect(migration).toMatch(
      /booking_transition_events_state_shape[\s\S]*CHECK\s*\(\([\s\S]*\) IS TRUE\)/,
    );
    expect(migration).toMatch(
      /kind" = 'rescheduled'[\s\S]*from_status" IS NULL AND "old_starts_at" IS NULL[\s\S]*from_status" IS NOT NULL AND "old_starts_at" IS NOT NULL/,
    );
    expect(migration).toMatch(
      /CREATE TRIGGER "booking_transition_events_append_only"[\s\S]*BEFORE UPDATE OR DELETE[\s\S]*prevent_append_only_mutation/,
    );
  });

  it("idempotently backfills accepted Store session snapshots into owned allowances", () => {
    const migration = migrationSql();
    const backfillStart = migration.indexOf('INSERT INTO "purchase_session_allowances"');
    const backfillEnd = migration.indexOf("ON CONFLICT", backfillStart);
    const backfill = migration.slice(backfillStart, backfillEnd + 200);

    expect(backfillStart).toBeGreaterThanOrEqual(0);
    expect(backfillEnd).toBeGreaterThan(backfillStart);
    expect(backfill).toContain('"purchase_id"');
    expect(backfill).toContain('"producer_id"');
    expect(backfill).toContain('"closed_at"');
    expect(backfill).toContain('"close_reason"');
    expect(backfill).toContain('INNER JOIN "purchase_acceptances"');
    expect(backfill).toContain('INNER JOIN "projects"');
    expect(backfill).toMatch(
      /jsonb_typeof\([\s\S]*commercial_snapshot[\s\S]*session[\s\S]*\)\s*=\s*'object'/,
    );
    expect(backfill).not.toMatch(/source_kind/);
    expect(backfill).toMatch(/commercial_snapshot[\s\S]*session[\s\S]*limit[\s\S]*kind/);
    expect(backfill).toMatch(/commercial_snapshot[\s\S]*session[\s\S]*limit[\s\S]*count/);
    for (const term of ["durationMin", "locationType", "bufferMinutes", "minLeadHours"]) {
      expect(backfill, term).toMatch(
        new RegExp(`commercial_snapshot[\\s\\S]*session[\\s\\S]*${term}`),
      );
    }
    expect(backfill).toMatch(/CASE[\s\S]*'fixed'[\s\S]*ELSE NULL[\s\S]*END/i);
    expect(backfill).toContain('"accepted_at"');
    expect(backfill).toMatch(/ON CONFLICT\s*\(\s*"purchase_id"\s*\)\s*DO NOTHING/i);

    const projectCompleted = backfill.indexOf("'project_completed'");
    const projectCanceled = backfill.indexOf("'project_canceled'");
    const purchaseCanceled = backfill.indexOf("'purchase_canceled'");
    expect(projectCompleted).toBeGreaterThanOrEqual(0);
    expect(projectCanceled).toBeGreaterThan(projectCompleted);
    expect(purchaseCanceled).toBeGreaterThanOrEqual(0);
    expect(backfill).toContain('pr."lifecycle_changed_at"');
    expect(backfill).toContain('p."canceled_at"');
  });

  it("fails closed around ambiguous history and concurrent legacy acceptance writers", () => {
    const migration = migrationSql();
    const fullLock = migration.indexOf("LOCK TABLE\n");
    const firstDdl = migration.indexOf('CREATE TYPE "booking_transition_kind"');
    const allowanceAlter = migration.indexOf('ALTER TABLE "purchase_session_allowances"');
    const backfill = migration.indexOf('INSERT INTO "purchase_session_allowances"');
    const deferredTrigger = migration.indexOf(
      'CREATE CONSTRAINT TRIGGER "purchase_acceptances_require_session_allowance"',
    );

    expect(fullLock).toBeGreaterThanOrEqual(0);
    expect(firstDdl).toBeGreaterThan(fullLock);
    expect(allowanceAlter).toBeGreaterThan(firstDdl);
    expect(migration).toMatch(
      /LOCK TABLE\s+"projects",\s+"bookings",\s+"purchase_acceptances",\s+"purchase_session_allowances"\s+IN ACCESS EXCLUSIVE MODE NOWAIT;/,
    );
    expect(backfill).toBeGreaterThan(allowanceAlter);
    expect(deferredTrigger).toBeGreaterThan(backfill);
    expect(migration).toContain(
      "SKITZA_SK68_ALLOWANCE_BACKFILL_REQUIRES_LIFECYCLE_AUDIT",
    );
    expect(migration).toContain('FROM "project_payment_pause_events"');
    expect(migration).toMatch(
      /pr\."lifecycle_changed_at" = \([\s\S]*SELECT MIN\(activated\."activated_at"\)[\s\S]*activated\."project_id" = p\."project_id"[\s\S]*activated\."producer_id" = p\."producer_id"[\s\S]*\)/,
    );
    expect(migration).toMatch(
      /psa\."id" IS NULL[\s\S]*p\."lifecycle_status" <> 'canceled'[\s\S]*pr\."lifecycle_status" IN \('active', 'paused'\)/,
    );
    expect(migration).toMatch(
      /purchase_acceptances_require_session_allowance[\s\S]*DEFERRABLE INITIALLY DEFERRED/,
    );
    expect(migration).toContain("SKITZA_ACCEPTED_SESSION_ALLOWANCE_REQUIRED");
    expect(migration).toContain("SKITZA_ACCEPTED_SESSION_ALLOWANCE_MISMATCH");
    expect(migration).toContain("SKITZA_TERMINAL_SESSION_ALLOWANCE_MUST_BE_CLOSED");
  });

  it("preserves the earliest terminal history without rewriting a valid close reason", () => {
    const migration = migrationSql();
    const backfillStart = migration.indexOf('INSERT INTO "purchase_session_allowances"');
    const backfillEnd = migration.indexOf('ON CONFLICT', backfillStart);
    const backfill = migration.slice(backfillStart, backfillEnd);
    const terminalCheckStart = migration.lastIndexOf("IF EXISTS (", migration.indexOf(
      "SKITZA_TERMINAL_SESSION_ALLOWANCE_MUST_BE_CLOSED",
    ));
    const terminalCheckEnd = migration.indexOf(
      "SKITZA_TERMINAL_SESSION_ALLOWANCE_MUST_BE_CLOSED",
      terminalCheckStart,
    );
    const terminalCheck = migration.slice(terminalCheckStart, terminalCheckEnd);

    expect(backfill).toMatch(
      /p\."canceled_at" < pr\."lifecycle_changed_at"[\s\S]*'purchase_canceled'/,
    );
    expect(backfill).toMatch(
      /WHEN pr\."lifecycle_status" = 'completed'[\s\S]*WHEN pr\."lifecycle_status" = 'canceled'/,
    );
    expect(terminalCheck).toContain('psa."closed_at" IS NULL');
    expect(terminalCheck).not.toContain('psa."close_reason" IS DISTINCT FROM');
  });

  it("extends booking identity protection to command identity and reschedule lineage", () => {
    const migration = migrationSql();
    const guardStart = migration.indexOf('CREATE OR REPLACE FUNCTION "protect_booking_identity"');
    const guardEnd = migration.indexOf('CREATE TRIGGER "bookings_protect_identity"', guardStart);
    const guard = migration.slice(guardStart, guardEnd);

    expect(guardStart).toBeGreaterThanOrEqual(0);
    expect(guardEnd).toBeGreaterThan(guardStart);
    expect(guard).toContain('OLD."operation_key"');
    expect(guard).toContain('OLD."operation_digest"');
    expect(guard).toContain('OLD."starts_at"');
    expect(guard).toContain('OLD."duration_min"');
    expect(guard).toContain('OLD."rescheduled_from_booking_id"');
    expect(guard).toContain("SKITZA_BOOKING_IDENTITY_IMMUTABLE");
  });
});
