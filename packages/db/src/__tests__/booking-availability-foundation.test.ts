import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  bookingArtistRsvpStatus,
  bookingBillingTreatment,
  bookingOrigin,
  bookings,
  producers,
} from "../schema";

const migrationPath = fileURLToPath(
  new URL("../../drizzle/0041_booking_availability_foundation.sql", import.meta.url),
);

function checkNames(table: PgTable): string[] {
  return getTableConfig(table).checks.map((constraint) => constraint.name);
}

function migrationSql(): string {
  return readFileSync(migrationPath, "utf8");
}

describe("SK-190 booking and availability schema", () => {
  it("stores the producer daily cap as an optional positive value", () => {
    expect(producers.maxSessionsPerDay.name).toBe("max_sessions_per_day");
    expect(producers.maxSessionsPerDay.notNull).toBe(false);
    expect(checkNames(producers)).toContain("producers_max_sessions_per_day_shape");
  });

  it("exports the exact approved origin, billing, and RSVP values", () => {
    expect(bookingOrigin.enumValues).toEqual(["legacy", "artist_request", "producer_manual"]);
    expect(bookingBillingTreatment.enumValues).toEqual([
      "included",
      "complimentary",
      "billable_extra",
    ]);
    expect(bookingArtistRsvpStatus.enumValues).toEqual([
      "needs_action",
      "accepted",
      "declined",
      "tentative",
    ]);
  });

  it("keeps legacy title optional while versioning new calendar-facing data", () => {
    expect(bookings.title.name).toBe("title");
    expect(bookings.title.notNull).toBe(false);
    expect(bookings.origin.notNull).toBe(true);
    expect(bookings.origin.default).toBe("legacy");
    expect(bookings.billingTreatment.notNull).toBe(true);
    expect(bookings.billingTreatment.default).toBe("included");
    expect(bookings.calendarRevision.notNull).toBe(true);
    expect(bookings.calendarRevision.default).toBe(0);
    expect(bookings.artistRsvpStatus.notNull).toBe(false);
    expect(bookings.artistRsvpRespondedAt.notNull).toBe(false);
    expect(bookings.updatedAt.notNull).toBe(true);
    expect(bookings.updatedAt.hasDefault).toBe(true);

    expect(checkNames(bookings)).toEqual(
      expect.arrayContaining([
        "bookings_title_shape",
        "bookings_calendar_revision_shape",
        "bookings_artist_rsvp_shape",
        "bookings_updated_at_shape",
      ]),
    );
  });
});

describe("SK-190 additive migration", () => {
  it("adds only the booking foundation and no Google or outbox tables", () => {
    const migration = migrationSql();

    expect(migration).toContain(
      'LOCK TABLE "producers", "bookings" IN ACCESS EXCLUSIVE MODE NOWAIT',
    );
    expect(migration).toMatch(/CREATE TYPE "booking_origin" AS ENUM/);
    expect(migration).toMatch(/CREATE TYPE "booking_billing_treatment" AS ENUM/);
    expect(migration).toMatch(/CREATE TYPE "booking_artist_rsvp_status" AS ENUM/);
    expect(migration).toContain('ADD COLUMN "max_sessions_per_day" integer');
    expect(migration).toContain('ADD COLUMN "title" text');
    expect(migration).toContain('ADD COLUMN "origin" "booking_origin" NOT NULL DEFAULT \'legacy\'');
    expect(migration).toContain(
      'ADD COLUMN "billing_treatment" "booking_billing_treatment" NOT NULL DEFAULT \'included\'',
    );
    expect(migration).toContain('ADD COLUMN "calendar_revision" integer NOT NULL DEFAULT 0');
    expect(migration).not.toMatch(/CREATE TABLE\s+"(?:google|calendar|booking_calendar)/i);
  });

  it("backfills legacy titles and timestamps from tenant-bound durable sources", () => {
    const migration = migrationSql();
    const titleBackfill = migration.slice(
      migration.indexOf('UPDATE "bookings" AS "booking"'),
      migration.indexOf("-- Preserve the newest durable booking timestamp"),
    );

    expect(titleBackfill).toContain('"purchase"."commercial_snapshot"->>\'productOrOfferName\'');
    expect(titleBackfill).toContain('NULLIF(btrim("project"."title"), \'\')');
    expect(titleBackfill).toContain('"booking"."purchase_id" = "purchase"."id"');
    expect(titleBackfill).toContain('"booking"."project_id" = "purchase"."project_id"');
    expect(titleBackfill).toContain('"booking"."producer_id" = "purchase"."producer_id"');
    expect(migration).toMatch(
      /SET "updated_at" = GREATEST\([\s\S]*"created_at"[\s\S]*"status_changed_at"[\s\S]*"outcome_changed_at"/,
    );
    expect(migration).toMatch(/ALTER COLUMN "updated_at" SET NOT NULL/);
    expect(migration).toMatch(/ALTER COLUMN "updated_at" SET DEFAULT now\(\)/);
  });

  it("preserves immutable identity and rejects revision or timestamp regression", () => {
    const migration = migrationSql();
    const guard = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION "protect_booking_identity"()'),
    );

    for (const immutableColumn of [
      'OLD."starts_at"',
      'OLD."duration_min"',
      'OLD."operation_key"',
      'OLD."allowance_use_id"',
      'OLD."origin"',
      'OLD."billing_treatment"',
    ]) {
      expect(guard).toContain(immutableColumn);
    }
    expect(guard).toContain("SKITZA_BOOKING_IDENTITY_IMMUTABLE");
    expect(guard).toContain("SKITZA_BOOKING_CALENDAR_REVISION_REGRESSION");
    expect(guard).toContain("SKITZA_BOOKING_CALENDAR_REVISION_REQUIRED");
    expect(guard).toContain("SKITZA_BOOKING_UPDATED_AT_REGRESSION");
    expect(guard).toMatch(
      /ROW\(OLD\."title", OLD\."status", OLD\."outcome"\)[\s\S]*NEW\."calendar_revision" <= OLD\."calendar_revision"/,
    );
    expect(guard).not.toMatch(/OLD\."title"[\s\S]*SKITZA_BOOKING_IDENTITY_IMMUTABLE/);
  });

  it("keeps the migration additive and legacy-safe", () => {
    const migration = migrationSql();

    expect(migration).not.toMatch(/\b(?:DELETE FROM|TRUNCATE|DROP TABLE|DROP COLUMN)\b/i);
    expect(migration).not.toMatch(/INSERT INTO\s+"(?:google|calendar|booking_calendar)/i);
    expect(migration).toContain("DEFAULT 'legacy'");
    expect(migration).toContain("DEFAULT 'included'");
    expect(migration).toContain("DEFAULT 0");
    expect(migration).toContain('"title" IS NULL');
  });
});
