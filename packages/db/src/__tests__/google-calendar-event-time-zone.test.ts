import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { calendarSyncJobs, type GoogleCalendarSyncJobPayloadSnapshot } from "../schema";

const migrationPath = fileURLToPath(
  new URL("../../drizzle/0061_google_calendar_event_time_zone.sql", import.meta.url),
);

type GoogleCalendarUpsertPayload = Extract<
  GoogleCalendarSyncJobPayloadSnapshot,
  { action: "upsert" }
>;

// Required<> makes every field the upsert payload can carry mandatory here,
// optional ones included. A field added to the payload therefore cannot reach
// the database without this fixture naming it and the allow-list accepting it.
const upsertPayload: Required<GoogleCalendarUpsertPayload> = {
  schemaVersion: 2,
  action: "upsert",
  eventKind: "confirmed",
  notificationMode: "all",
  sequence: 4,
  startsAtUtc: "2026-09-08T12:00:00.000Z",
  endsAtUtc: "2026-09-08T15:00:00.000Z",
  timeZone: "Asia/Jerusalem",
  summary: "Full production",
  artistSafeUrl: "https://skitza.app/artist/sessions/booking-1",
  attendee: { name: "Artist", email: "artist@example.com" },
  privateProperties: { skitzaLink: "link-1", skitzaRevision: "4", skitzaSchema: "1" },
};

function migrationSql(): string {
  return readFileSync(migrationPath, "utf8");
}

function schemaCheckSql(): string {
  const check = getTableConfig(calendarSyncJobs).checks.find(
    (constraint) => constraint.name === "calendar_sync_jobs_payload_shape",
  );
  if (!check) throw new Error("calendar_sync_jobs_payload_shape is missing from the schema");
  return new PgDialect().sqlToQuery(check.value).sql;
}

function quotedKeys(arrayLiteral: string): string[] {
  return (arrayLiteral.match(/'[^']+'/g) ?? []).map((token) => token.slice(1, -1));
}

// The upsert branch owns the only key allow-list that names the event kind.
function upsertKeyAllowList(sql: string): string[] {
  const lists = (sql.match(/payload_snapshot"? - ARRAY\[[^\]]+\]/g) ?? []).map(quotedKeys);
  const upsert = lists.find((keys) => keys.includes("eventKind"));
  if (!upsert) throw new Error("the upsert_google_event key allow-list is missing");
  return upsert;
}

describe("SK-302 Google upsert payload carries the studio time zone", () => {
  it("allows every key the upsert payload can carry", () => {
    expect(upsertKeyAllowList(migrationSql())).toEqual(
      expect.arrayContaining(Object.keys(upsertPayload)),
    );
  });

  it("keeps the Drizzle mirror and the migration on the same key set", () => {
    expect(upsertKeyAllowList(schemaCheckSql())).toEqual(upsertKeyAllowList(migrationSql()));
  });

  it("treats the zone as optional and rejects a blank one", () => {
    const migration = migrationSql();
    expect(migration).toContain(`jsonb_typeof("payload_snapshot"->'timeZone') IS NULL`);
    expect(migration).toContain(`jsonb_typeof("payload_snapshot"->'timeZone') = 'string'`);
    expect(migration).toContain(`NULLIF(btrim("payload_snapshot"->>'timeZone'), '') IS NOT NULL`);
  });

  it("replaces the payload shape constraint and leaves the delete branch alone", () => {
    const migration = migrationSql();
    expect(migration).toContain(`DROP CONSTRAINT "calendar_sync_jobs_payload_shape"`);
    expect(migration).toContain(`ADD CONSTRAINT "calendar_sync_jobs_payload_shape"`);
    expect(migration).toContain(
      `'schemaVersion', 'action', 'notificationMode', 'sequence', 'privateProperties'`,
    );
  });
});
