import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  bookingCalendarLinks,
  bookingCalendarLinkSyncState,
  calendarSyncJobOperation,
  calendarSyncJobs,
  googleCalendarSyncErrorCode,
  googleCalendarWatches,
  googleCalendarWatchState,
  type GoogleCalendarReconcileJobPayloadSnapshot,
} from "../schema";

const migrationPath = fileURLToPath(
  new URL("../../drizzle/0047_google_calendar_inbound_sync.sql", import.meta.url),
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

describe("SK-195 linked-event inbound state", () => {
  it("exports the exact bounded health and error vocabulary", () => {
    expect(bookingCalendarLinkSyncState.enumValues).toEqual([
      "pending",
      "synced",
      "not_synced",
      "conflict",
      "missing",
      "disconnected",
    ]);
    expect(googleCalendarSyncErrorCode.enumValues).toEqual([
      "provider_unavailable",
      "rate_limited",
      "permission_denied",
      "reconnect_required",
      "invalid_provider_event",
      "stale_skitza_revision",
      "skitza_overlap",
      "watch_create_failed",
      "watch_renew_failed",
      "watch_stop_failed",
      "reconciliation_failed",
      "unknown",
    ]);

    expect(bookingCalendarLinks.syncState.default).toBe("pending");
    expect(bookingCalendarLinks.syncStateChangedAt.notNull).toBe(true);
    expect(bookingCalendarLinks.providerEventUpdatedAt.notNull).toBe(false);
    expect(bookingCalendarLinks.lastInboundReconciledAt.notNull).toBe(false);
    expect(bookingCalendarLinks.lastSyncErrorCode.notNull).toBe(false);
    expect(checkNames(bookingCalendarLinks)).toContain("booking_calendar_links_sync_state_shape");
  });

  it("requires a reconcile lease for inbound facts and blocks stale provider writes", () => {
    const migration = migrationSql();

    expect(migration).toContain("SKITZA_BOOKING_CALENDAR_LINK_RECONCILE_LEASE_REQUIRED");
    expect(migration).toMatch(
      /job\."operation" = 'reconcile_google_event'[\s\S]*job\."status" = 'processing'[\s\S]*job\."desired_revision" = OLD\."desired_revision"/,
    );
    expect(migration).toMatch(
      /NEW\."desired_revision" IN \(OLD\."desired_revision", OLD\."desired_revision" \+ 1\)/,
    );
    expect(migration).toContain("SKITZA_BOOKING_CALENDAR_LINK_PROVIDER_UPDATED_REGRESSION");
    expect(migration).toContain("SKITZA_BOOKING_CALENDAR_LINK_RECONCILIATION_REGRESSION");
    expect(migration).toContain("SKITZA_BOOKING_CALENDAR_LINK_SYNC_STATE_TIMESTAMP_REQUIRED");
  });

  it("keeps RSVP on the booking and adds no attendee or guest persistence", () => {
    const migration = migrationSql();

    expect(migration).not.toMatch(/ADD COLUMN "artist_rsvp/i);
    expect(migration).not.toMatch(/CREATE TABLE "[^"]*(?:attendee|guest)/i);
    expect(migration).not.toMatch(/(?:artist_email|project_name|provider_response_body)/i);
  });
});

describe("SK-195 Google watch trust contract", () => {
  it("stores an encrypted destination snapshot and only a channel-token digest", () => {
    expect(googleCalendarWatchState.enumValues).toEqual([
      "renewing",
      "active",
      "retired",
      "expired",
    ]);
    expect(googleCalendarWatches.destinationSelectionId.notNull).toBe(true);
    expect(googleCalendarWatches.destinationCalendarIdCiphertext.notNull).toBe(true);
    expect(googleCalendarWatches.destinationCalendarIdFingerprint.notNull).toBe(true);
    expect(googleCalendarWatches.providerChannelId.notNull).toBe(true);
    expect(googleCalendarWatches.providerResourceId.notNull).toBe(false);
    expect(googleCalendarWatches.channelTokenDigest.notNull).toBe(true);
    expect(googleCalendarWatches.state.default).toBe("renewing");
    expect(googleCalendarWatches.lastMessageNumber.default).toBe("0");

    expect(uniqueNames(googleCalendarWatches)).toEqual(
      expect.arrayContaining([
        "google_calendar_watches_id_producer_unique",
        "google_calendar_watches_channel_unique",
      ]),
    );
    expect(uniqueNames(googleCalendarWatches)).not.toContain(
      "google_calendar_watches_renewal_unique",
    );
    expect(indexNames(googleCalendarWatches)).toEqual(
      expect.arrayContaining([
        "google_calendar_watches_one_active",
        "google_calendar_watches_one_renewing",
        "google_calendar_watches_renewal_due_idx",
        "google_calendar_watches_webhook_lookup_idx",
      ]),
    );
    expect(foreignKeyNames(googleCalendarWatches)).toEqual(
      expect.arrayContaining([
        "google_calendar_watches_connection_producer_fk",
        "google_calendar_watches_renewal_producer_fk",
      ]),
    );
    expect(checkNames(googleCalendarWatches)).toEqual(
      expect.arrayContaining([
        "google_calendar_watches_encrypted_destination_shape",
        "google_calendar_watches_trust_shape",
        "google_calendar_watches_state_shape",
        "google_calendar_watches_message_shape",
        "google_calendar_watches_timestamp_shape",
      ]),
    );
  });

  it("keeps historical watches from blocking an account-version switch", () => {
    const migration = migrationSql();

    expect(migration).toMatch(
      /FOREIGN KEY \("connection_id", "producer_id"\)[\s\S]*REFERENCES "google_calendar_connections" \("id", "producer_id"\)/,
    );
    expect(migration).not.toMatch(
      /FOREIGN KEY \("connection_id", "producer_id", "account_version"\)/,
    );
    expect(migration).toContain("SKITZA_GOOGLE_CALENDAR_WATCH_DESTINATION_INVALID");
    expect(migration).toContain('connection_row."account_version" = NEW."account_version"');
    expect(migration).toContain('selection_row."id" = NEW."destination_selection_id"');
  });

  it("allows only an exact future active linked snapshot to keep a prior destination watched", () => {
    const migration = migrationSql();
    const watchGuardStart = migration.indexOf('CREATE FUNCTION "protect_google_calendar_watch"');
    const watchGuardEnd = migration.indexOf(
      'CREATE TRIGGER "google_calendar_watches_protect"',
      watchGuardStart,
    );
    const watchGuard = migration.slice(watchGuardStart, watchGuardEnd);

    expect(watchGuard).toContain('selection_row."is_destination" = true');
    expect(watchGuard).toContain('FROM "booking_calendar_links" AS link_row');
    expect(watchGuard).toContain('link_row."producer_id" = NEW."producer_id"');
    expect(watchGuard).toContain('link_row."connection_id" = NEW."connection_id"');
    expect(watchGuard).toContain('link_row."account_version" = NEW."account_version"');
    expect(watchGuard).toContain(
      'link_row."destination_calendar_id_ciphertext"\n          = NEW."destination_calendar_id_ciphertext"',
    );
    expect(watchGuard).toContain("link_row.\"provider_state\" = 'active'");
    expect(watchGuard).toContain(
      "booking_row.\"status\" IN ('pending_approval', 'confirmed')",
    );
    expect(watchGuard).toContain('booking_row."starts_at" > CURRENT_TIMESTAMP');
    expect(watchGuard).toMatch(
      /connection_row\."account_version" = NEW\."account_version"[\s\S]*connection_row\."status" = 'connected'/,
    );
  });

  it("keeps pending holds watched but excludes terminal old-destination links", () => {
    const migration = migrationSql();
    const watchGuardStart = migration.indexOf('CREATE FUNCTION "protect_google_calendar_watch"');
    const watchGuardEnd = migration.indexOf(
      'CREATE TRIGGER "google_calendar_watches_protect"',
      watchGuardStart,
    );
    const watchGuard = migration.slice(watchGuardStart, watchGuardEnd);

    expect(watchGuard).toContain(
      "booking_row.\"status\" IN ('pending_approval', 'confirmed')",
    );
    expect(watchGuard).not.toMatch(
      /booking_row\."status" IN \([^)]*(?:rejected|cancelled|completed|no_show)/u,
    );
  });

  it("supports safe overlapping renewal and retry after a failed successor", () => {
    const migration = migrationSql();

    expect(migration).toContain("WHERE \"state\" = 'active'");
    expect(migration).toContain("WHERE \"state\" = 'renewing'");
    expect(migration).not.toContain("google_calendar_watches_renewal_unique");
    expect(migration).toContain("SKITZA_GOOGLE_CALENDAR_WATCH_RENEWAL_SOURCE_INVALID");
    expect(migration).toContain("SKITZA_GOOGLE_CALENDAR_WATCH_RENEWAL_NOT_ATOMIC");
    expect(migration).toMatch(/NEW\."state" <> 'active'[\s\S]*NEW\."renewal_of_watch_id" IS NULL/);
    expect(migration).toMatch(
      /old_watch\."state" = 'retired'[\s\S]*old_watch\."ended_at" IS NOT NULL/,
    );
  });

  it("makes channel trust immutable and notification numbers monotonic", () => {
    const migration = migrationSql();

    expect(migration).toContain("\"channel_token_digest\" ~ '^sha256:[0-9a-f]{64}$'");
    expect(migration).not.toMatch(/"channel_token"\s+text/i);
    expect(migration).toContain("SKITZA_GOOGLE_CALENDAR_WATCH_IDENTITY_IMMUTABLE");
    expect(migration).toContain("SKITZA_GOOGLE_CALENDAR_WATCH_PROVIDER_IDENTITY_IMMUTABLE");
    expect(migration).toContain("SKITZA_GOOGLE_CALENDAR_WATCH_MESSAGE_REGRESSION");
    expect(migration).toContain("SKITZA_GOOGLE_CALENDAR_WATCH_NOTIFICATION_MESSAGE_REQUIRED");
    expect(migration).toContain("SKITZA_GOOGLE_CALENDAR_WATCH_DELETE_FORBIDDEN");
  });
});

describe("SK-195 known-link reconciliation outbox", () => {
  it("extends the existing outbox with an exact privacy-minimal v3 payload", () => {
    expect(calendarSyncJobOperation.enumValues).toContain("reconcile_google_event");
    expect(calendarSyncJobs.googleCalendarWatchId.notNull).toBe(false);
    expect(calendarSyncJobs.webhookMessageNumber.notNull).toBe(false);

    const webhook = {
      schemaVersion: 3,
      action: "reconcile",
      source: "webhook",
      watchId: "00000000-0000-4000-8000-000000000001",
      messageNumber: "42",
    } as const satisfies GoogleCalendarReconcileJobPayloadSnapshot;
    const recovery = {
      schemaVersion: 3,
      action: "reconcile",
      source: "recovery",
      watchId: null,
      messageNumber: null,
    } as const satisfies GoogleCalendarReconcileJobPayloadSnapshot;

    expect(webhook.messageNumber).toBe("42");
    expect(recovery.watchId).toBeNull();
    expect(migrationSql()).toContain(
      "'schemaVersion', 'action', 'source', 'watchId', 'messageNumber'",
    );
  });

  it("dedupes webhook jobs without blocking reconcile beside outbound work", () => {
    expect(indexNames(calendarSyncJobs)).toEqual(
      expect.arrayContaining([
        "calendar_sync_jobs_link_outbound_revision_unique",
        "calendar_sync_jobs_watch_message_link_unique",
      ]),
    );
    expect(indexNames(calendarSyncJobs)).not.toContain(
      "calendar_sync_jobs_link_channel_revision_unique",
    );

    const migration = migrationSql();
    expect(migration).toMatch(
      /calendar_sync_jobs_link_outbound_revision_unique[\s\S]*"operation" IN \('upsert_google_event', 'delete_google_event'\)/,
    );
    expect(migration).toMatch(
      /calendar_sync_jobs_watch_message_link_unique[\s\S]*"operation" = 'reconcile_google_event'/,
    );
    expect(uniqueNames(calendarSyncJobs)).toContain("calendar_sync_jobs_idempotency_unique");
  });

  it("binds webhook jobs to the exact known-link tenant and watch watermark", () => {
    expect(foreignKeyNames(calendarSyncJobs)).toContain(
      "calendar_sync_jobs_google_calendar_watch_producer_fk",
    );

    const migration = migrationSql();
    expect(migration).toContain("SKITZA_CALENDAR_SYNC_JOB_RECONCILE_LINK_INACTIVE");
    expect(migration).toContain("SKITZA_CALENDAR_SYNC_JOB_WATCH_SCOPE_INVALID");
    expect(migration).toContain("watch.\"state\" IN ('active', 'renewing')");
    expect(migration).toContain(
      'watch."destination_calendar_id_fingerprint"\n          = link_row."destination_calendar_id_fingerprint"',
    );
    expect(migration).toContain('watch."last_message_number" = NEW."webhook_message_number"');
  });

  it("keeps reconcile intent immutable and excludes it from outbound completion proof", () => {
    const migration = migrationSql();

    expect(migration).toContain("SKITZA_CALENDAR_SYNC_JOB_RECONCILE_IDENTITY_IMMUTABLE");
    expect(migration).toMatch(
      /NEW\."operation" IN \('upsert_google_event', 'delete_google_event'\)[\s\S]*link_row\."desired_revision" > NEW\."desired_revision"/,
    );
    expect(migration).not.toMatch(
      /NEW\."delivery_channel" = 'google'[\s\S]*SKITZA_CALENDAR_SYNC_JOB_GOOGLE_RESULT_REQUIRED/,
    );
  });

  it("is one focused additive migration and rejects a rerun", () => {
    const migration = migrationSql();

    expect(migration).toContain(
      'ALTER TYPE "calendar_sync_job_operation"\n  RENAME TO "calendar_sync_job_operation_legacy"',
    );
    expect(migration).not.toContain("IF NOT EXISTS");
    expect(migration).not.toMatch(
      /(?:^|\n)\s*(?:DELETE\s+FROM|TRUNCATE|DROP\s+TABLE|DROP\s+COLUMN)\b/i,
    );
    expect(migration).not.toMatch(/(?:resource_uri|raw_token|provider_payload)/i);
  });
});
