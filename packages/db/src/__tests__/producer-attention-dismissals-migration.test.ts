import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "drizzle", "0060_producer_attention_dismissals.sql"),
  "utf8",
);

describe("producer attention dismissals migration", () => {
  it("is additive — it creates a table and touches no existing row", () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "producer_attention_dismissals"');
    expect(migration).not.toMatch(/\bUPDATE\s+"/);
    expect(migration).not.toMatch(/\bDELETE\s+FROM\b/);
    expect(migration).not.toMatch(/\bDROP\b/);
    expect(migration).not.toMatch(/\bALTER TABLE\b/);
  });

  it("stores a timestamp, not a flag, so a row can un-hide itself", () => {
    // The whole "hide until it changes" rule depends on comparing this stamp
    // against the subject's last change. A boolean could not express it.
    expect(migration).toContain('"dismissed_at" timestamp with time zone NOT NULL');
    expect(migration).not.toContain('"dismissed" boolean');
  });

  it("refuses to store a dismissal for money or anything on a clock", () => {
    expect(migration).toContain('"producer_attention_dismissals_kind_allowed"');
    expect(migration).toContain("'follow_up', 'comment', 'urgent_project'");
    // Belt and braces: the four undismissable kinds must not appear at all.
    for (const kind of ["payment_proof", "payment_due", "purchase_request", "session_approval"]) {
      expect(migration).not.toContain(`'${kind}'`);
    }
  });

  it("keeps one dismissal per producer, per kind, per subject", () => {
    // urgent_project and follow_up are two different rows about the same
    // project, so the kind has to be part of the key.
    expect(migration).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "producer_attention_dismissals_subject_unique"',
    );
    expect(migration).toContain('("producer_id", "item_kind", "subject_id")');
  });
});
