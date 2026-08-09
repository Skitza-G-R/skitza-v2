import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  bookingChangeRequestKind,
  bookingChangeRequests,
  bookingChangeRequestStatus,
  bookings,
  calendarSyncJobManualRetries,
  calendarSyncJobOperation,
  calendarSyncJobs,
  calendarSyncJobStatus,
  type CalendarSyncJobPayloadSnapshot,
} from "../schema";

const migrationPath = fileURLToPath(
  new URL("../../drizzle/0044_manual_sessions_and_calendar_delivery.sql", import.meta.url),
);

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
    .indexes.map((entry) => entry.config.name)
    .filter((name): name is string => name !== undefined);
}

function foreignKeyNames(table: PgTable): string[] {
  return config(table).foreignKeys.map((key) => key.getName());
}

function checkNames(table: PgTable): string[] {
  return config(table).checks.map((constraint) => constraint.name);
}

function migrationSql(): string {
  return readFileSync(migrationPath, "utf8");
}

describe("SK-191 artist booking change-request schema", () => {
  it("exports the exact request lifecycle and immutable audit inputs", () => {
    expect(bookingChangeRequestKind.enumValues).toEqual(["cancel", "reschedule"]);
    expect(bookingChangeRequestStatus.enumValues).toEqual(["pending", "approved", "rejected"]);

    expect(bookingChangeRequests.bookingId.notNull).toBe(true);
    expect(bookingChangeRequests.producerId.notNull).toBe(true);
    expect(bookingChangeRequests.kind.notNull).toBe(true);
    expect(bookingChangeRequests.status.default).toBe("pending");
    expect(bookingChangeRequests.proposedStartsAt.notNull).toBe(false);
    expect(bookingChangeRequests.requestOperationKey.notNull).toBe(true);
    expect(bookingChangeRequests.requestOperationDigest.notNull).toBe(true);
    expect(bookingChangeRequests.requestedByClerkUserId.notNull).toBe(true);
    expect(bookingChangeRequests.requestedAt.notNull).toBe(true);
    expect(bookingChangeRequests.decisionOperationKey.notNull).toBe(false);
    expect(bookingChangeRequests.decisionOperationDigest.notNull).toBe(false);
    expect(bookingChangeRequests.decidedByClerkUserId.notNull).toBe(false);
    expect(bookingChangeRequests.decidedAt.notNull).toBe(false);
    expect(bookingChangeRequests.replacementBookingId.notNull).toBe(false);

    expect(uniqueNames(bookingChangeRequests)).toContain(
      "booking_change_requests_request_operation_unique",
    );
    expect(uniqueNames(bookings)).toContain("bookings_id_producer_rescheduled_from_unique");
    expect(indexNames(bookingChangeRequests)).toEqual(
      expect.arrayContaining([
        "booking_change_requests_decision_operation_unique",
        "booking_change_requests_one_pending_per_booking",
        "booking_change_requests_replacement_booking_unique",
        "booking_change_requests_producer_status_requested_idx",
        "booking_change_requests_booking_requested_idx",
      ]),
    );
    expect(foreignKeyNames(bookingChangeRequests)).toEqual(
      expect.arrayContaining([
        "booking_change_requests_booking_producer_fk",
        "booking_change_requests_replacement_booking_producer_fk",
        "booking_change_requests_replacement_booking_lineage_fk",
      ]),
    );
    expect(checkNames(bookingChangeRequests)).toEqual(
      expect.arrayContaining([
        "booking_change_requests_request_identity_shape",
        "booking_change_requests_proposed_start_shape",
        "booking_change_requests_replacement_identity_shape",
        "booking_change_requests_decision_shape",
        "booking_change_requests_timestamp_shape",
      ]),
    );
  });

  it("makes pending uniqueness and resolution shape explicit in SQL", () => {
    const migration = migrationSql();

    expect(migration).toMatch(
      /CREATE UNIQUE INDEX "booking_change_requests_one_pending_per_booking"[\s\S]*WHERE "status" = 'pending'/,
    );
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX "booking_change_requests_decision_operation_unique"[\s\S]*WHERE "decision_operation_key" IS NOT NULL/,
    );
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX "booking_change_requests_replacement_booking_unique"[\s\S]*WHERE "replacement_booking_id" IS NOT NULL/,
    );
    expect(migration).toMatch(
      /"kind" = 'cancel'[\s\S]*"proposed_starts_at" IS NULL[\s\S]*"kind" = 'reschedule'[\s\S]*"proposed_starts_at" IS NOT NULL/,
    );
    expect(migration).toMatch(
      /"status" = 'approved'[\s\S]*"kind" = 'reschedule'[\s\S]*"replacement_booking_id" IS NOT NULL/,
    );
    expect(migration).toMatch(/"status" = 'rejected'[\s\S]*"replacement_booking_id" IS NULL/);
    expect(migration).toContain("booking_change_requests_booking_producer_fk");
    expect(migration).toContain("booking_change_requests_replacement_booking_producer_fk");
    expect(migration).toMatch(
      /"booking_change_requests_replacement_booking_lineage_fk"[\s\S]*FOREIGN KEY \("replacement_booking_id", "producer_id", "booking_id"\)[\s\S]*"rescheduled_from_booking_id"/,
    );
  });

  it("protects request intent and final producer decisions", () => {
    const migration = migrationSql();
    const guard = migration.slice(
      migration.indexOf('CREATE FUNCTION "protect_booking_change_request"()'),
      migration.indexOf('CREATE TABLE "calendar_sync_jobs"'),
    );

    expect(guard).toContain("SKITZA_BOOKING_CHANGE_REQUEST_DELETE_FORBIDDEN");
    expect(guard).toContain("SKITZA_BOOKING_CHANGE_REQUEST_INTENT_IMMUTABLE");
    expect(guard).toContain("SKITZA_BOOKING_CHANGE_REQUEST_RESOLUTION_IMMUTABLE");
    expect(guard).toContain("SKITZA_BOOKING_CHANGE_REQUEST_TIMESTAMP_REGRESSION");
    expect(guard).toMatch(/OLD\."status" <> 'pending'/);
    expect(guard).toMatch(/BEFORE UPDATE OR DELETE ON "booking_change_requests"/);
  });
});

describe("SK-191 calendar invitation outbox schema", () => {
  it("retains ICS and exports the approved durable states", () => {
    expect(calendarSyncJobOperation.enumValues).toEqual([
      "send_ics",
      "upsert_google_event",
      "delete_google_event",
    ]);
    expect(calendarSyncJobStatus.enumValues).toEqual([
      "pending",
      "processing",
      "completed",
      "terminal",
    ]);

    expect(calendarSyncJobs.bookingId.notNull).toBe(true);
    expect(calendarSyncJobs.producerId.notNull).toBe(true);
    expect(calendarSyncJobs.desiredRevision.notNull).toBe(true);
    expect(calendarSyncJobs.idempotencyKey.notNull).toBe(true);
    expect(calendarSyncJobs.payloadSnapshot.notNull).toBe(true);
    expect(calendarSyncJobs.attemptCount.default).toBe(0);
    expect(calendarSyncJobs.firstAttemptAt.notNull).toBe(false);
    expect(calendarSyncJobs.lastAttemptAt.notNull).toBe(false);
    expect(calendarSyncJobs.providerDedupeExpiresAt.notNull).toBe(false);
    expect(calendarSyncJobs.status.default).toBe("pending");
    expect(calendarSyncJobs.nextAttemptAt.notNull).toBe(false);
    expect(calendarSyncJobs.nextAttemptAt.hasDefault).toBe(true);
    expect(calendarSyncJobs.leaseToken.notNull).toBe(false);
    expect(calendarSyncJobs.providerMessageId.notNull).toBe(false);
    expect(calendarSyncJobs.manualRetryCount.default).toBe(0);
    expect(calendarSyncJobs.lastManualRetryAt.notNull).toBe(false);

    expect(uniqueNames(calendarSyncJobs)).toEqual(
      expect.arrayContaining([
        "calendar_sync_jobs_idempotency_unique",
        "calendar_sync_jobs_id_producer_unique",
      ]),
    );
    expect(indexNames(calendarSyncJobs)).toEqual(
      expect.arrayContaining([
        "calendar_sync_jobs_uid_revision_unique",
        "calendar_sync_jobs_ics_booking_operation_revision_unique",
        "calendar_sync_jobs_claim_idx",
        "calendar_sync_jobs_booking_revision_idx",
        "calendar_sync_jobs_producer_updated_idx",
      ]),
    );
    expect(foreignKeyNames(calendarSyncJobs)).toContain("calendar_sync_jobs_booking_producer_fk");
    expect(checkNames(calendarSyncJobs)).toEqual(
      expect.arrayContaining([
        "calendar_sync_jobs_identity_shape",
        "calendar_sync_jobs_payload_shape",
        "calendar_sync_jobs_attempt_shape",
        "calendar_sync_jobs_state_shape",
        "calendar_sync_jobs_timestamp_shape",
        "calendar_sync_jobs_manual_retry_shape",
        "calendar_sync_jobs_error_shape",
      ]),
    );
  });

  it("types the complete immutable RFC 5545 delivery snapshot", () => {
    const payload = {
      schemaVersion: 1,
      method: "REQUEST",
      uid: "booking-use@skitza.app",
      sequence: 3,
      dtstampUtc: "2026-08-08T12:00:00.000Z",
      startsAtUtc: "2026-08-09T12:00:00.000Z",
      endsAtUtc: "2026-08-09T13:30:00.000Z",
      summary: "Studio session",
      description: "Open this session in Skitza.",
      organizer: { name: "Producer", email: "producer@example.com" },
      attendee: { name: "Artist", email: "artist@example.com" },
    } as const satisfies CalendarSyncJobPayloadSnapshot;

    expect(payload.sequence).toBe(3);
    expect(payload.method).toBe("REQUEST");

    const migration = migrationSql();
    expect(migration).toContain(`"payload_snapshot"->>'schemaVersion' = '1'`);
    expect(migration).toContain(`"payload_snapshot"->>'method' IN ('REQUEST', 'CANCEL')`);
    expect(migration).toMatch(/\("payload_snapshot"->>'sequence'\)::integer = "desired_revision"/);
    expect(migration).toContain(`right("payload_snapshot"->>'dtstampUtc', 1) = 'Z'`);
    expect(migration).toContain(`right("payload_snapshot"->>'startsAtUtc', 1) = 'Z'`);
    expect(migration).toContain(`right("payload_snapshot"->>'endsAtUtc', 1) = 'Z'`);
    expect(migration).toContain(`"payload_snapshot"->'organizer'->>'email'`);
    expect(migration).toContain(`"payload_snapshot"->'attendee'->>'email'`);
  });

  it("dedupes one stable UID revision and enforces lease/result state", () => {
    const migration = migrationSql();

    expect(migration).toMatch(
      /CREATE UNIQUE INDEX "calendar_sync_jobs_uid_revision_unique"[\s\S]*"payload_snapshot"->>'uid'[\s\S]*"desired_revision"/,
    );
    expect(migration).toMatch(
      /"status" = 'pending'[\s\S]*"next_attempt_at" IS NOT NULL[\s\S]*"lease_token" IS NULL/,
    );
    expect(migration).toMatch(
      /"status" = 'processing'[\s\S]*"lease_acquired_at" IS NOT NULL[\s\S]*"lease_expires_at" > "lease_acquired_at"/,
    );
    expect(migration).toMatch(
      /"status" = 'completed'[\s\S]*"provider_message_id"[\s\S]*"completed_at" IS NOT NULL/,
    );
    expect(migration).toMatch(
      /"status" = 'terminal'[\s\S]*"terminal_at" IS NOT NULL[\s\S]*btrim\("terminal_error"\)/,
    );
  });

  it("keeps intent immutable except for one audited terminal reissue shape", () => {
    const migration = migrationSql();
    const guard = migration.slice(
      migration.indexOf('CREATE FUNCTION "protect_calendar_sync_job"()'),
    );

    for (const immutableColumn of [
      'OLD."booking_id"',
      'OLD."producer_id"',
      'OLD."operation"',
      'OLD."desired_revision"',
      'OLD."idempotency_key"',
      'OLD."payload_snapshot"',
    ]) {
      expect(guard).toContain(immutableColumn);
    }
    expect(guard).toContain("SKITZA_CALENDAR_SYNC_JOB_INTENT_IMMUTABLE");
    expect(guard).toContain("SKITZA_CALENDAR_SYNC_JOB_ATTEMPT_REGRESSION");
    expect(guard).toContain("SKITZA_CALENDAR_SYNC_JOB_FIRST_ATTEMPT_IMMUTABLE");
    expect(guard).toContain("SKITZA_CALENDAR_SYNC_JOB_DEDUPE_EXPIRY_IMMUTABLE");
    expect(guard).toContain("SKITZA_CALENDAR_SYNC_JOB_LAST_ATTEMPT_REQUIRED");
    expect(guard).toContain("SKITZA_CALENDAR_SYNC_JOB_FINAL_STATE_IMMUTABLE");
    expect(guard).toContain("SKITZA_CALENDAR_SYNC_JOB_CLAIM_ATTEMPT_INVALID");
    expect(guard).toContain("OLD.\"status\" = 'terminal'");
    expect(guard).toContain("NEW.\"status\" = 'pending'");
    expect(guard).toContain('retry."prior_idempotency_key" = OLD."idempotency_key"');
    expect(guard).toContain('retry."new_idempotency_key" = NEW."idempotency_key"');
    expect(guard).toContain('NEW."attempt_count" = 0');
    expect(guard).toContain('NEW."first_attempt_at" IS NULL');
    expect(guard).toContain('NEW."terminal_error" IS NULL');
    expect(guard).toContain("AND NOT is_manual_retry");
    expect(guard).toMatch(/BEFORE UPDATE OR DELETE ON "calendar_sync_jobs"/);
  });

  it("stores every deliberate reissue in an immutable tenant-owned audit row", () => {
    expect(calendarSyncJobManualRetries.jobId.notNull).toBe(true);
    expect(calendarSyncJobManualRetries.producerId.notNull).toBe(true);
    expect(calendarSyncJobManualRetries.retryNumber.notNull).toBe(true);
    expect(calendarSyncJobManualRetries.operationKey.notNull).toBe(true);
    expect(calendarSyncJobManualRetries.operationDigest.notNull).toBe(true);
    expect(calendarSyncJobManualRetries.actorIdentity.notNull).toBe(true);
    expect(calendarSyncJobManualRetries.priorIdempotencyKey.notNull).toBe(true);
    expect(calendarSyncJobManualRetries.newIdempotencyKey.notNull).toBe(true);
    expect(calendarSyncJobManualRetries.priorTerminalError.notNull).toBe(true);
    expect(uniqueNames(calendarSyncJobManualRetries)).toEqual(
      expect.arrayContaining([
        "calendar_sync_job_manual_retries_job_retry_unique",
        "calendar_sync_job_manual_retries_operation_unique",
        "calendar_sync_job_manual_retries_new_idempotency_unique",
      ]),
    );
    expect(foreignKeyNames(calendarSyncJobManualRetries)).toContain(
      "calendar_sync_job_manual_retries_job_producer_fk",
    );
    expect(checkNames(calendarSyncJobManualRetries)).toEqual(
      expect.arrayContaining([
        "calendar_sync_job_manual_retries_identity_shape",
        "calendar_sync_job_manual_retries_prior_attempt_shape",
        "calendar_sync_job_manual_retries_timestamp_shape",
        "calendar_sync_job_manual_retries_error_shape",
      ]),
    );

    const migration = migrationSql();
    expect(migration).toMatch(
      /FOREIGN KEY \("job_id", "producer_id"\)[\s\S]*REFERENCES "calendar_sync_jobs" \("id", "producer_id"\)/,
    );
    expect(migration).toContain("SKITZA_CALENDAR_SYNC_JOB_MANUAL_RETRY_AUDIT_IMMUTABLE");
    expect(migration).toMatch(/BEFORE UPDATE OR DELETE ON "calendar_sync_job_manual_retries"/);
  });
});

describe("SK-191 additive migration boundary", () => {
  it("adds no Google state and never rewrites existing booking data", () => {
    const migration = migrationSql();

    expect(migration).toMatch(/CREATE TABLE "booking_change_requests"/);
    expect(migration).toMatch(/CREATE TABLE "calendar_sync_jobs"/);
    expect(migration).toMatch(/CREATE TABLE "calendar_sync_job_manual_retries"/);
    expect(migration).toMatch(
      /ADD CONSTRAINT "bookings_id_producer_rescheduled_from_unique"[\s\S]*UNIQUE \("id", "producer_id", "rescheduled_from_booking_id"\)/,
    );
    expect(migration).not.toMatch(
      /(?:CREATE TABLE|CREATE TYPE|ADD COLUMN)\s+"[^"]*(?:google|oauth|refresh_token|access_token|webhook)/i,
    );
    expect(migration).not.toMatch(
      /\b(?:ALTER TABLE "bookings"[\s\S]{0,120}ADD COLUMN|UPDATE "bookings"|DELETE FROM|TRUNCATE|DROP TABLE|DROP COLUMN)\b/i,
    );
  });
});
