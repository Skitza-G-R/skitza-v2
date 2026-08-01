import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  artistHistoricalAccessGrants,
  artistNotifications,
  artistProfiles,
  bookings,
  products,
  purchaseSessionAllowances,
} from "../schema";

const migrationPath = fileURLToPath(
  new URL("../../drizzle/0038_artist_platform_foundations.sql", import.meta.url),
);

describe("artist platform foundations", () => {
  it("keeps the Drizzle schema aligned with the three approved tables", () => {
    expect(artistProfiles.clerkUserId.name).toBe("clerk_user_id");
    expect(artistProfiles.timezone.name).toBe("timezone");
    expect(artistProfiles.notificationPreferences.name).toBe(
      "notification_preferences",
    );

    expect(artistNotifications.recipientClerkUserId.name).toBe(
      "recipient_clerk_user_id",
    );
    expect(artistNotifications.destinationHref.name).toBe("destination_href");
    expect(artistNotifications.readAt.name).toBe("read_at");
    expect(artistNotifications.openedAt.name).toBe("opened_at");

    expect(artistHistoricalAccessGrants.artistClerkUserId.name).toBe(
      "artist_clerk_user_id",
    );
    expect(artistHistoricalAccessGrants.resourceType.name).toBe("resource_type");
    expect(artistHistoricalAccessGrants.resourceId.name).toBe("resource_id");
  });

  it("creates only the approved artist foundation tables", () => {
    const migration = readFileSync(migrationPath, "utf8");

    for (const table of [
      "artist_profiles",
      "artist_notifications",
      "artist_historical_access_grants",
    ]) {
      expect(migration).toContain(`CREATE TABLE "${table}"`);
    }
    expect(migration.match(/CREATE TABLE /g)).toHaveLength(3);
  });

  it("separates notification read state from switcher item-open state", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toContain('"read_at" timestamp with time zone');
    expect(migration).toContain('"opened_at" timestamp with time zone');
    expect(migration).toContain('"switcher_dot_worthy" boolean');
    expect(migration).toContain(
      'WHERE "switcher_dot_worthy" IS TRUE AND "opened_at" IS NULL',
    );
    expect(migration).toContain(
      'WHERE "in_app_visible" IS TRUE AND "read_at" IS NULL',
    );
  });

  it("deduplicates artist events and validates same-origin artist paths", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toContain(
      'UNIQUE ("recipient_clerk_user_id", "dedupe_key")',
    );
    expect(migration).toContain('"destination_href" LIKE \'/artist/%\'');
    expect(migration).toContain('"destination_href" NOT LIKE \'//%\'');
    expect(migration).toContain("position(chr(92)");
    expect(migration).toContain("position('://'");
  });

  it("makes historical grants exact and append-only", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toMatch(
      /PRIMARY KEY \(\s*"artist_clerk_user_id",\s*"producer_id",\s*"resource_type",\s*"resource_id"\s*\)/,
    );
    expect(migration).toMatch(
      /CREATE TRIGGER "artist_historical_access_grants_append_only"[\s\S]*BEFORE UPDATE OR DELETE ON "artist_historical_access_grants"[\s\S]*prevent_append_only_mutation/,
    );
    expect(migration).toContain(
      '"artist_historical_resource_type" AS ENUM',
    );
    expect(migration).toContain("'track_version_download'");
  });

  it("adds explicit booking eligibility and immutable booking-policy contracts", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(products.bookingEnabled.name).toBe("booking_enabled");
    expect(purchaseSessionAllowances.bookingEnabledSnapshot.name).toBe(
      "booking_enabled_snapshot",
    );
    expect(bookings.allowanceUseId.name).toBe("allowance_use_id");
    expect(bookings.cancellationPolicyHoursSnapshot.name).toBe(
      "cancellation_policy_hours_snapshot",
    );
    expect(bookings.heldExpiresAt.name).toBe("held_expires_at");
    expect(bookings.heldExpiryReason.name).toBe("held_expiry_reason");

    expect(migration).toContain(
      'ADD COLUMN "booking_enabled" boolean NOT NULL DEFAULT false',
    );
    expect(migration).toMatch(
      /booking_enabled_snapshot" = true[\s\S]*"event"\."to_status" = 'confirmed'/,
    );
    expect(migration).toContain('"cancellation_policy_backfilled" boolean NOT NULL DEFAULT false');
    expect(migration).toContain('"held_expiry_reason" = \'approval_timeout\'');
    expect(migration).toContain('"created_at" + interval \'24 hours\'');
    expect(migration).toMatch(
      /WITH RECURSIVE "booking_roots"[\s\S]*SET "allowance_use_id" = "root"\."allowance_use_id"/,
    );
    expect(migration).toContain('"purchase_session_allowances_protect_terms"');
    expect(migration).toContain("SKITZA_SESSION_ALLOWANCE_TERMS_IMMUTABLE");
  });

  it("replaces the existing allowance trigger without weakening closure immutability", () => {
    const migration = readFileSync(migrationPath, "utf8");
    const dropTrigger = migration.indexOf(
      'DROP TRIGGER IF EXISTS "purchase_session_allowances_protect_terms"',
    );
    const legacyBackfill = migration.indexOf(
      'UPDATE "purchase_session_allowances" AS "allowance"',
    );
    const createTrigger = migration.indexOf(
      'CREATE TRIGGER "purchase_session_allowances_protect_terms"',
    );

    expect(dropTrigger).toBeGreaterThanOrEqual(0);
    expect(legacyBackfill).toBeGreaterThan(dropTrigger);
    expect(createTrigger).toBeGreaterThan(legacyBackfill);
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION "protect_session_allowance_terms"()',
    );
    expect(migration).toMatch(
      /OLD\."booking_enabled_snapshot"[\s\S]*NEW\."booking_enabled_snapshot"/,
    );
    expect(migration).toContain(
      "SKITZA_SESSION_ALLOWANCE_CLOSURE_IMMUTABLE",
    );
    expect(migration).toContain(
      "SKITZA_SESSION_ALLOWANCE_CLOSE_TRANSITION_INVALID",
    );
  });
});
