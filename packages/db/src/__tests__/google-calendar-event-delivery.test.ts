import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  bookingCalendarLinkProviderState,
  bookingCalendarLinks,
  calendarSyncDeliveryChannel,
  calendarSyncJobManualRetries,
  calendarSyncJobOperation,
  calendarSyncJobs,
  type GoogleCalendarSyncJobPayloadSnapshot,
} from "../schema";

const migrationPath = fileURLToPath(
  new URL("../../drizzle/0046_google_calendar_event_delivery.sql", import.meta.url),
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

describe("SK-194 Google event link schema", () => {
  it("exports one stable link per allowance lineage and account version", () => {
    expect(bookingCalendarLinkProviderState.enumValues).toEqual(["uncreated", "active", "deleted"]);

    expect(bookingCalendarLinks.producerId.notNull).toBe(true);
    expect(bookingCalendarLinks.allowanceUseId.notNull).toBe(true);
    expect(bookingCalendarLinks.originBookingId.notNull).toBe(true);
    expect(bookingCalendarLinks.currentBookingId.notNull).toBe(true);
    expect(bookingCalendarLinks.connectionId.notNull).toBe(true);
    expect(bookingCalendarLinks.accountVersion.notNull).toBe(true);
    expect(bookingCalendarLinks.destinationSelectionId.notNull).toBe(true);
    expect(bookingCalendarLinks.destinationCalendarIdCiphertext.notNull).toBe(true);
    expect(bookingCalendarLinks.destinationCalendarIdKeyVersion.notNull).toBe(true);
    expect(bookingCalendarLinks.destinationCalendarIdFingerprint.notNull).toBe(true);
    expect(bookingCalendarLinks.providerEventId.notNull).toBe(true);
    expect(bookingCalendarLinks.providerEventEtag.notNull).toBe(false);
    expect(bookingCalendarLinks.providerState.default).toBe("uncreated");
    expect(bookingCalendarLinks.desiredRevision.notNull).toBe(true);
    expect(bookingCalendarLinks.lastGoogleRevision.default).toBe(0);
    expect(bookingCalendarLinks.invitationRevision.default).toBe(0);
    expect(bookingCalendarLinks.invitationAttemptedAt.notNull).toBe(false);

    expect(uniqueNames(bookingCalendarLinks)).toEqual(
      expect.arrayContaining([
        "booking_calendar_links_id_producer_unique",
        "booking_calendar_links_lineage_account_unique",
        "booking_calendar_links_provider_event_unique",
      ]),
    );
    expect(indexNames(bookingCalendarLinks)).toEqual(
      expect.arrayContaining([
        "booking_calendar_links_current_booking_idx",
        "booking_calendar_links_reconciliation_idx",
      ]),
    );
    expect(foreignKeyNames(bookingCalendarLinks)).toEqual(
      expect.arrayContaining([
        "booking_calendar_links_origin_booking_lineage_fk",
        "booking_calendar_links_current_booking_lineage_fk",
        "booking_calendar_links_connection_producer_fk",
      ]),
    );
    expect(foreignKeyNames(bookingCalendarLinks)).not.toContain(
      "booking_calendar_links_destination_selection_fk",
    );
    expect(checkNames(bookingCalendarLinks)).toEqual(
      expect.arrayContaining([
        "booking_calendar_links_encrypted_destination_shape",
        "booking_calendar_links_identity_shape",
        "booking_calendar_links_provider_state_shape",
        "booking_calendar_links_revision_shape",
        "booking_calendar_links_invitation_shape",
        "booking_calendar_links_timestamp_shape",
      ]),
    );
  });

  it("keeps account-switch event IDs separate and the destination decryptable", () => {
    const migration = migrationSql();

    expect(migration).toMatch(
      /"booking_calendar_links_lineage_account_unique"[\s\S]*UNIQUE \("producer_id", "allowance_use_id", "connection_id", "account_version"\)/,
    );
    expect(migration).toMatch(
      /"booking_calendar_links_provider_event_unique"[\s\S]*UNIQUE \("connection_id", "provider_event_id"\)/,
    );
    expect(migration).toContain("\"provider_event_id\" ~ '^[0-9a-v]+$'");
    expect(migration).toContain('char_length("provider_event_id") BETWEEN 5 AND 1024');
    expect(migration).toContain('"destination_selection_id" uuid NOT NULL');
    expect(migration).toContain('selection_row."id" = NEW."destination_selection_id"');
    expect(migration).toContain('selection_row."provider_calendar_id_ciphertext"');
    expect(migration).not.toMatch(
      /FOREIGN KEY \("destination_selection_id"\)[\s\S]*google_calendar_selections/,
    );
  });

  it("moves only to an exact replacement in the same allowance lineage", () => {
    const migration = migrationSql();

    expect(migration).toContain("bookings_id_producer_allowance_use_unique");
    expect(migration).toMatch(
      /FOREIGN KEY \("current_booking_id", "producer_id", "allowance_use_id"\)[\s\S]*REFERENCES "bookings"/,
    );
    expect(migration).toContain('current_booking_source IS DISTINCT FROM OLD."current_booking_id"');
    expect(migration).toContain("SKITZA_BOOKING_CALENDAR_LINK_REPLACEMENT_INVALID");
    expect(migration).toContain("SKITZA_BOOKING_CALENDAR_LINK_DESIRED_REVISION_REGRESSION");
  });

  it("lets delayed content delivery finish after only no-content terminal outcomes", () => {
    const migration = migrationSql();

    expect(migration).toMatch(
      /TG_OP = 'UPDATE'[\s\S]*current_booking_revision = NEW\."desired_revision" \+ 1/,
    );
    expect(migration).toMatch(
      /current_booking_status = 'completed'[\s\S]*current_booking_outcome = 'completed'/,
    );
    expect(migration).toMatch(
      /current_booking_status = 'no_show'[\s\S]*current_booking_outcome = 'no_show'/,
    );
    expect(migration).toContain("SKITZA_BOOKING_CALENDAR_LINK_CURRENT_REVISION_INVALID");
  });
});

describe("SK-194 Google outbox contract", () => {
  it("extends the existing leased outbox without changing legacy defaults", () => {
    expect(calendarSyncJobOperation.enumValues).toEqual([
      "send_ics",
      "upsert_google_event",
      "delete_google_event",
    ]);
    expect(calendarSyncDeliveryChannel.enumValues).toEqual(["ics", "google"]);
    expect(calendarSyncJobs.deliveryChannel.default).toBe("ics");
    expect(calendarSyncJobs.bookingCalendarLinkId.notNull).toBe(false);
    expect(calendarSyncJobManualRetries.priorProviderDedupeExpiresAt.notNull).toBe(false);
    expect(uniqueNames(calendarSyncJobs)).not.toContain(
      "calendar_sync_jobs_booking_operation_revision_unique",
    );

    expect(indexNames(calendarSyncJobs)).toContain(
      "calendar_sync_jobs_link_channel_revision_unique",
    );
    expect(indexNames(calendarSyncJobs)).toContain(
      "calendar_sync_jobs_ics_booking_operation_revision_unique",
    );
    expect(foreignKeyNames(calendarSyncJobs)).toContain(
      "calendar_sync_jobs_booking_calendar_link_producer_fk",
    );
    expect(checkNames(calendarSyncJobs)).toContain("calendar_sync_jobs_channel_shape");
  });

  it("types only the approved Google event projections", () => {
    const confirmed = {
      schemaVersion: 2,
      action: "upsert",
      eventKind: "confirmed",
      notificationMode: "all",
      sequence: 4,
      startsAtUtc: "2026-08-10T10:00:00.000Z",
      endsAtUtc: "2026-08-10T11:30:00.000Z",
      summary: "Studio session",
      artistSafeUrl: "https://skitza.app/session/example",
      attendee: { name: "Artist", email: "artist@example.com" },
      privateProperties: {
        skitzaLink: "7fd41611-d878-4e47-a0f4-27a7f30ccb9a",
        skitzaRevision: "4",
        skitzaSchema: "1",
      },
    } as const satisfies GoogleCalendarSyncJobPayloadSnapshot;

    const hold = {
      schemaVersion: 2,
      action: "upsert",
      eventKind: "opaque_hold",
      notificationMode: "none",
      sequence: 1,
      startsAtUtc: "2026-08-10T10:00:00.000Z",
      endsAtUtc: "2026-08-10T11:30:00.000Z",
      summary: "Reserved",
      artistSafeUrl: null,
      attendee: null,
      privateProperties: {
        skitzaLink: "7fd41611-d878-4e47-a0f4-27a7f30ccb9a",
        skitzaRevision: "1",
        skitzaSchema: "1",
      },
    } as const satisfies GoogleCalendarSyncJobPayloadSnapshot;

    const deletion = {
      schemaVersion: 2,
      action: "delete",
      notificationMode: "all",
      sequence: 5,
      privateProperties: {
        skitzaLink: "7fd41611-d878-4e47-a0f4-27a7f30ccb9a",
        skitzaRevision: "5",
        skitzaSchema: "1",
      },
    } as const satisfies GoogleCalendarSyncJobPayloadSnapshot;

    expect(confirmed.attendee.email).toBe("artist@example.com");
    expect(hold.summary).toBe("Reserved");
    expect(deletion.action).toBe("delete");
  });

  it("whitelists privacy fields and binds metadata to link revision", () => {
    const migration = migrationSql();

    expect(migration).toContain("'skitzaLink', 'skitzaRevision', 'skitzaSchema'");
    expect(migration).toContain(`"payload_snapshot"->'privateProperties'->>'skitzaLink'`);
    expect(migration).toContain(`"payload_snapshot"->'privateProperties'->>'skitzaSchema' = '1'`);
    expect(migration).toContain(`"payload_snapshot"->>'notificationMode' IN ('none', 'all')`);
    expect(migration).toContain(`"payload_snapshot"->>'summary' = 'Reserved'`);
    expect(migration).toContain(`jsonb_typeof("payload_snapshot"->'artistSafeUrl') = 'null'`);
    expect(migration).toContain(`jsonb_typeof("payload_snapshot"->'attendee') = 'null'`);
    expect(migration).not.toMatch(/(?:location|conferenceData|hangoutLink|attachments)/i);
  });

  it("uses channel-specific dedupe and durable invitation completion", () => {
    const migration = migrationSql();

    expect(migration).toContain(
      'DROP CONSTRAINT "calendar_sync_jobs_booking_operation_revision_unique"',
    );
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX "calendar_sync_jobs_ics_booking_operation_revision_unique"[\s\S]*\("booking_id", "operation", "desired_revision"\)[\s\S]*WHERE "delivery_channel" = 'ics'/,
    );
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX "calendar_sync_jobs_link_channel_revision_unique"[\s\S]*\(\s*"booking_calendar_link_id",[\s\S]*"delivery_channel",[\s\S]*"desired_revision"[\s\S]*WHERE "booking_calendar_link_id" IS NOT NULL/,
    );
    expect(migration).toMatch(
      /"delivery_channel" = 'ics'[\s\S]*"provider_dedupe_expires_at" > "first_attempt_at"/,
    );
    expect(migration).toMatch(
      /"delivery_channel" = 'google'[\s\S]*"provider_dedupe_expires_at" IS NULL/,
    );
    expect(migration).toContain(
      'retry."prior_provider_dedupe_expires_at"\n        IS NOT DISTINCT FROM OLD."provider_dedupe_expires_at"',
    );
    expect(migration).toContain("SKITZA_BOOKING_CALENDAR_LINK_INVITATION_RESERVE_FIRST");
    expect(migration).toContain("SKITZA_BOOKING_CALENDAR_LINK_INVITATION_LEASE_REQUIRED");
    expect(migration).toContain("SKITZA_BOOKING_CALENDAR_LINK_INVITATION_ATTEMPT_REGRESSION");
    expect(migration).toContain("SKITZA_BOOKING_CALENDAR_LINK_INVITATION_ATTEMPT_FINAL");
    expect(migration).toContain("SKITZA_BOOKING_CALENDAR_LINK_INVITATION_ATTEMPT_CHANNEL_INVALID");
    expect(migration).toContain("SKITZA_BOOKING_CALENDAR_LINK_INVITATION_ATTEMPT_REQUIRED");
    expect(migration).toMatch(
      /NEW\."invitation_revision" > OLD\."invitation_revision"[\s\S]*NEW\."invitation_attempted_at" IS NOT NULL[\s\S]*SKITZA_BOOKING_CALENDAR_LINK_INVITATION_RESERVE_FIRST/,
    );
    expect(migration).toMatch(
      /OLD\."invitation_attempted_at" IS NOT NULL[\s\S]*NEW\."invitation_attempted_at" IS NULL[\s\S]*NEW\."invitation_attempted_at" < OLD\."invitation_attempted_at"/,
    );
    expect(migration).toContain("is_ics_fallback_switch boolean := FALSE");
    expect(migration).toMatch(
      /OLD\."invitation_channel" = 'google'[\s\S]*NEW\."invitation_channel" = 'ics'[\s\S]*NEW\."invitation_reserved_at" IS NOT DISTINCT FROM OLD\."invitation_reserved_at"[\s\S]*NEW\."invitation_attempted_at" IS NOT DISTINCT FROM OLD\."invitation_attempted_at"[\s\S]*OLD\."invitation_delivered_at" IS NULL[\s\S]*NEW\."invitation_delivered_at" IS NULL/,
    );
    expect(migration).toMatch(
      /fallback_job\."delivery_channel" = 'ics'[\s\S]*fallback_job\."operation" = 'send_ics'[\s\S]*fallback_job\."status" IN \('pending', 'processing'\)[\s\S]*FOR UPDATE OF fallback_job/,
    );
    expect(migration).toContain("calendar_sync_jobs_completion_link_check");
    expect(migration).toContain("SKITZA_CALENDAR_SYNC_JOB_ICS_FALLBACK_DELIVERY_REQUIRED");
    expect(migration).toMatch(
      /IF NEW\."delivery_channel" = 'google'[\s\S]*link_row\."desired_revision" > NEW\."desired_revision"[\s\S]*THEN\s+RETURN NULL;[\s\S]*SKITZA_CALENDAR_SYNC_JOB_GOOGLE_RESULT_REQUIRED/,
    );
  });

  it("is one focused transactional migration and rejects a rerun", () => {
    const migration = migrationSql();

    expect(migration).toContain(
      'ALTER TYPE "calendar_sync_job_operation"\n  RENAME TO "calendar_sync_job_operation_legacy"',
    );
    expect(migration).not.toContain("IF NOT EXISTS");
    expect(migration).not.toMatch(
      /(?:^|\n)\s*(?:UPDATE\s+"|DELETE\s+FROM|TRUNCATE|DROP\s+TABLE|DROP\s+COLUMN)\b/i,
    );
    expect(migration).not.toMatch(/ALTER TABLE "google_calendar_selections"/i);
  });
});
