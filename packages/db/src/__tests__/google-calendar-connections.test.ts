import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  googleCalendarAccessRole,
  googleCalendarConnections,
  googleCalendarConnectionStatus,
  googleCalendarOAuthIntent,
  googleCalendarOAuthStates,
  googleCalendarSelections,
} from "../schema";

const migrationPath = fileURLToPath(
  new URL("../../drizzle/0045_google_calendar_connections.sql", import.meta.url),
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

function columnNames(table: PgTable): string[] {
  return Object.values(config(table).columns).map((column) => column.name);
}

function migrationSql(): string {
  return readFileSync(migrationPath, "utf8");
}

describe("SK-192 Google Calendar connection schema", () => {
  it("exports the approved connection and OAuth states", () => {
    expect(googleCalendarConnectionStatus.enumValues).toEqual([
      "needs_selection",
      "connected",
      "reconnect_required",
      "disconnected",
    ]);
    expect(googleCalendarOAuthIntent.enumValues).toEqual([
      "connect",
      "reconnect",
      "switch_account",
    ]);

    expect(googleCalendarConnections.producerId.notNull).toBe(true);
    expect(googleCalendarConnections.googleSubject.notNull).toBe(true);
    expect(googleCalendarConnections.googleAccountEmail.notNull).toBe(true);
    expect(googleCalendarConnections.accountVersion.default).toBe(1);
    expect(googleCalendarConnections.status.default).toBe("needs_selection");
    expect(googleCalendarConnections.grantedScopes.notNull).toBe(true);
    expect(googleCalendarConnections.accessTokenCiphertext.notNull).toBe(false);
    expect(googleCalendarConnections.accessTokenExpiresAt.notNull).toBe(false);
    expect(googleCalendarConnections.refreshTokenCiphertext.notNull).toBe(false);
    expect(googleCalendarConnections.lastSuccessfulAvailabilitySyncAt.notNull).toBe(false);
    expect(googleCalendarConnections.lastSuccessfulEventSyncAt.notNull).toBe(false);
    expect(googleCalendarConnections.lastErrorCode.notNull).toBe(false);

    expect(uniqueNames(googleCalendarConnections)).toEqual(
      expect.arrayContaining([
        "google_calendar_connections_producer_unique",
        "google_calendar_connections_id_producer_unique",
        "google_calendar_connections_id_producer_account_unique",
      ]),
    );
    expect(foreignKeyNames(googleCalendarConnections)).toContain(
      "google_calendar_connections_producer_fk",
    );
    expect(checkNames(googleCalendarConnections)).toEqual(
      expect.arrayContaining([
        "google_calendar_connections_identity_shape",
        "google_calendar_connections_token_shape",
        "google_calendar_connections_state_shape",
        "google_calendar_connections_timestamp_shape",
        "google_calendar_connections_safe_error_shape",
      ]),
    );

    expect(columnNames(googleCalendarConnections)).not.toEqual(
      expect.arrayContaining(["access_token", "refresh_token", "authorization_code"]),
    );
  });

  it("stores every visible CalendarList candidate without a raw provider ID", () => {
    expect(googleCalendarAccessRole.enumValues).toEqual([
      "freeBusyReader",
      "reader",
      "writerWithoutPrivateAccess",
      "writer",
      "owner",
    ]);

    expect(googleCalendarSelections.providerCalendarIdCiphertext.notNull).toBe(true);
    expect(googleCalendarSelections.providerCalendarIdIv.notNull).toBe(true);
    expect(googleCalendarSelections.providerCalendarIdAuthTag.notNull).toBe(true);
    expect(googleCalendarSelections.providerCalendarIdKeyVersion.notNull).toBe(true);
    expect(googleCalendarSelections.providerCalendarIdFingerprint.notNull).toBe(true);
    expect(googleCalendarSelections.displayName.notNull).toBe(true);
    expect(googleCalendarSelections.timezone.notNull).toBe(false);
    expect(googleCalendarSelections.isPrimary.default).toBe(false);
    expect(googleCalendarSelections.isDestination.default).toBe(false);
    expect(googleCalendarSelections.blocksAvailability.default).toBe(false);

    expect(columnNames(googleCalendarSelections)).not.toContain("provider_calendar_id");
    expect(uniqueNames(googleCalendarSelections)).toContain(
      "google_calendar_selections_calendar_fingerprint_unique",
    );
    expect(indexNames(googleCalendarSelections)).toEqual(
      expect.arrayContaining([
        "google_calendar_selections_one_destination",
        "google_calendar_selections_one_primary",
        "google_calendar_selections_producer_busy_idx",
      ]),
    );
    expect(foreignKeyNames(googleCalendarSelections)).toContain(
      "google_calendar_selections_connection_producer_account_fk",
    );
    expect(checkNames(googleCalendarSelections)).toEqual(
      expect.arrayContaining([
        "google_calendar_selections_encrypted_id_shape",
        "google_calendar_selections_metadata_shape",
        "google_calendar_selections_destination_access_shape",
        "google_calendar_selections_timestamp_shape",
      ]),
    );
  });

  it("stores only a short-lived, single-use OAuth state digest", () => {
    expect(googleCalendarOAuthStates.stateTokenDigest.notNull).toBe(true);
    expect(googleCalendarOAuthStates.producerId.notNull).toBe(true);
    expect(googleCalendarOAuthStates.intent.notNull).toBe(true);
    expect(googleCalendarOAuthStates.connectionId.notNull).toBe(false);
    expect(googleCalendarOAuthStates.expectedAccountVersion.notNull).toBe(false);
    expect(googleCalendarOAuthStates.expiresAt.notNull).toBe(true);
    expect(googleCalendarOAuthStates.consumedAt.notNull).toBe(false);

    expect(columnNames(googleCalendarOAuthStates)).not.toEqual(
      expect.arrayContaining(["state_token", "authorization_code", "pkce_verifier"]),
    );
    expect(uniqueNames(googleCalendarOAuthStates)).toContain(
      "google_calendar_oauth_states_state_digest_unique",
    );
    expect(indexNames(googleCalendarOAuthStates)).toContain(
      "google_calendar_oauth_states_expires_idx",
    );
    expect(foreignKeyNames(googleCalendarOAuthStates)).toEqual(
      expect.arrayContaining([
        "google_calendar_oauth_states_producer_fk",
        "google_calendar_oauth_states_connection_producer_fk",
      ]),
    );
    expect(checkNames(googleCalendarOAuthStates)).toEqual(
      expect.arrayContaining([
        "google_calendar_oauth_states_digest_shape",
        "google_calendar_oauth_states_intent_shape",
        "google_calendar_oauth_states_lifetime_shape",
      ]),
    );
  });
});

describe("SK-192 Google Calendar migration guarantees", () => {
  it("keeps credentials and calendar IDs encrypted and key-versioned", () => {
    const migration = migrationSql();

    expect(migration).toContain('"access_token_ciphertext" text');
    expect(migration).toContain('"access_token_key_version" integer');
    expect(migration).toContain('"access_token_expires_at" timestamp with time zone');
    expect(migration).toContain('"refresh_token_ciphertext" text');
    expect(migration).toContain('"refresh_token_key_version" integer');
    expect(migration).toContain('"provider_calendar_id_ciphertext" text NOT NULL');
    expect(migration).toContain('"provider_calendar_id_key_version" integer NOT NULL');
    expect(migration).toContain('"provider_calendar_id_fingerprint" text NOT NULL');
    expect(migration).not.toContain("{1,8192}");
    expect(migration).not.toMatch(/"(?:access_token|refresh_token|provider_calendar_id)"\s+text/i);
    expect(migration).not.toMatch(/"(?:authorization_code|pkce_verifier|state_token)"\s+text/i);
  });

  it("enforces one writable destination but permits unselected candidates", () => {
    const migration = migrationSql();

    expect(migration).toMatch(
      /CREATE UNIQUE INDEX "google_calendar_selections_one_destination"[\s\S]*WHERE "is_destination" = true/,
    );
    expect(migration).toMatch(
      /"is_destination" = false[\s\S]*"access_role" IN \('writer', 'owner'\)/,
    );
    expect(migration).toContain('"is_destination" boolean DEFAULT false NOT NULL');
    expect(migration).toContain('"blocks_availability" boolean DEFAULT false NOT NULL');
    expect(migration).not.toMatch(
      /CHECK[^;]*\("is_destination"\s*=\s*true\s+OR\s+"blocks_availability"\s*=\s*true\)/i,
    );
  });

  it("binds account switches and candidate identity to one producer", () => {
    const migration = migrationSql();

    expect(migration).toMatch(
      /UNIQUE \("producer_id"\)[\s\S]*UNIQUE \("id", "producer_id", "account_version"\)/,
    );
    expect(migration).toMatch(
      /FOREIGN KEY \("connection_id", "producer_id", "account_version"\)[\s\S]*REFERENCES "google_calendar_connections"/,
    );
    expect(migration).toContain("SKITZA_GOOGLE_CALENDAR_CONNECTION_IDENTITY_IMMUTABLE");
    expect(migration).toContain("SKITZA_GOOGLE_CALENDAR_ACCOUNT_VERSION_INVALID");
    expect(migration).toContain("SKITZA_GOOGLE_CALENDAR_ACCOUNT_SWITCH_INVALID");
    expect(migration).toContain("SKITZA_GOOGLE_CALENDAR_REFRESH_TOKEN_TIMESTAMP_REQUIRED");
    expect(migration).toContain("SKITZA_GOOGLE_CALENDAR_REFRESH_TOKEN_TIMESTAMP_REGRESSION");
    expect(migration).toMatch(
      /NEW\."account_version" <> OLD\."account_version" \+ 1[\s\S]*NEW\."status" NOT IN \('needs_selection', 'reconnect_required'\)/,
    );
    expect(migration).toMatch(
      /NEW\."access_token_ciphertext"[\s\S]*IS NOT DISTINCT FROM ROW\([\s\S]*OLD\."access_token_ciphertext"/,
    );
    expect(migration).toContain("SKITZA_GOOGLE_CALENDAR_SELECTION_IDENTITY_IMMUTABLE");
  });

  it("requires a complete selection only when the connection becomes connected", () => {
    const migration = migrationSql();

    expect(migration).toContain("target_status <> 'connected'");
    expect(migration).toMatch(
      /count\(\*\) FILTER \(WHERE "is_destination" = true\)[\s\S]*count\(\*\) FILTER \(WHERE "blocks_availability" = true\)/,
    );
    expect(migration).toContain("destination_count <> 1 OR busy_count < 1");
    expect(migration).toContain("DEFERRABLE INITIALLY DEFERRED");
    expect(migration).toContain("SKITZA_GOOGLE_CALENDAR_CONNECTED_SELECTION_REQUIRED");
  });

  it("makes signed OAuth state producer-bound, short-lived, and single-use", () => {
    const migration = migrationSql();

    expect(migration).toMatch(/"state_token_digest" ~ '\^sha256:\[0-9a-f\]\{64\}\$'/);
    expect(migration).toContain("interval '15 minutes'");
    expect(migration).toMatch(
      /"intent" = 'connect'[\s\S]*"connection_id" IS NULL[\s\S]*"intent" IN \('reconnect', 'switch_account'\)[\s\S]*"expected_account_version" > 0/,
    );
    expect(migration).toContain('OLD."consumed_at" IS NOT NULL');
    expect(migration).toContain('NEW."consumed_at" IS NULL');
    expect(migration).toContain("SKITZA_GOOGLE_CALENDAR_OAUTH_STATE_IMMUTABLE_OR_CONSUMED");
  });

  it("is additive and does not add event, FreeBusy, or webhook state", () => {
    const migration = migrationSql();

    expect(migration).not.toMatch(/\bALTER TABLE\b/i);
    expect(migration).not.toMatch(/\b(?:DROP TABLE|DROP COLUMN|TRUNCATE)\b/i);
    expect(migration).not.toMatch(
      /CREATE TABLE "[^\"]*(?:event_link|freebusy|webhook|watch_channel)/i,
    );
  });
});
