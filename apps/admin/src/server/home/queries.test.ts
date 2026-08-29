import { createDb } from "@skitza/db";
import { describe, expect, it } from "vitest";

import {
  betaInvitesWithoutSignupQuery,
  failedInvitationEmailsQuery,
  failedReminderEmailsQuery,
} from "./queries";

// SK-288 — these tests guard the two constraints that make Home truthful.
// They compile the queries and read the SQL back; no database is touched.

const db = createDb("postgresql://user:password@example.test/admin");
const NOW = new Date("2026-08-29T12:00:00.000Z");

const QUERIES = [
  { build: () => betaInvitesWithoutSignupQuery(db, NOW), name: "betaInvitesWithoutSignup" },
  { build: () => failedInvitationEmailsQuery(db, NOW), name: "failedInvitationEmails" },
  { build: () => failedReminderEmailsQuery(db, NOW), name: "failedReminderEmails" },
] as const;

// The six tables carrying `admin_data_environment`. Admin keeps the column
// and always passes the literal 'live' — the URL segment is what SK-288
// removes, never the column.
const ENVIRONMENT_SCOPED_TABLES = [
  "admin_action_history",
  "admin_action_receipts",
  "admin_support_notes",
  "domain_events",
  "operational_runs",
  "system_problems",
] as const;

describe("home queries", () => {
  it("never asks purchase_reminder_deliveries for a status it does not have", () => {
    // Allowed values are reserved | sending | sent | reservation_expired |
    // dedupe_expired. Filtering on 'failed' would return zero forever and
    // rebuild the exact lie SK-288 exists to remove.
    const { params, sql } = failedReminderEmailsQuery(db, NOW).toSQL();

    expect(sql).toContain("purchase_reminder_deliveries");
    expect(params).not.toContain("failed");
    expect(sql).not.toContain("'failed'");
  });

  it("still recognises the real 'failed' status on the invitation table", () => {
    // Proves the test above is sensitive rather than vacuously true:
    // client_invitation_email_deliveries genuinely does have 'failed'.
    const { params, sql } = failedInvitationEmailsQuery(db, NOW).toSQL();

    expect(sql).toContain("client_invitation_email_deliveries");
    expect(params).toContain("failed");
  });

  it("counts only reminders that have not since gone out", () => {
    // `completeDelivery` does not clear `last_failed_at`, so the status has
    // to be pinned or a reminder that failed once and then succeeded would
    // still be counted.
    const { params } = failedReminderEmailsQuery(db, NOW).toSQL();

    expect(params).toContain("reserved");
    expect(params).toContain("sending");
    expect(params).not.toContain("sent");
  });

  it("keeps every environment-scoped table filtered to live", () => {
    for (const { build, name } of QUERIES) {
      const { sql } = build().toSQL();
      for (const table of ENVIRONMENT_SCOPED_TABLES) {
        if (!sql.includes(table)) continue;
        expect(sql, `${name} reads ${table} without an environment filter`).toContain(
          '"environment"',
        );
        expect(sql, `${name} reads ${table} without pinning live`).toContain("'live'");
      }
    }
  });

  it("bounds each signal to the last seven days", () => {
    const sevenDaysBefore = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1_000).toISOString();
    for (const { build, name } of QUERIES) {
      const { params } = build().toSQL();
      expect(params, `${name} is not bounded to a recent window`).toContain(sevenDaysBefore);
    }
  });
});
