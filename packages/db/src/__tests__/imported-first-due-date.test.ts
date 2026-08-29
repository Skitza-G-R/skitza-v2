import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import * as schema from "../schema";

const migration = readFileSync(
  join(process.cwd(), "drizzle/0059_imported_first_due_date.sql"),
  "utf8",
);
const foundationMigration = readFileSync(
  join(process.cwd(), "drizzle/0054_active_work_import_foundation.sql"),
  "utf8",
);
const executableMigration = migration.replace(/^\s*--.*$/gm, "");

/** The schedule validator body, from CREATE OR REPLACE to its closing tag. */
function scheduleValidatorBody(source: string): string {
  const start = source.indexOf(
    'CREATE OR REPLACE FUNCTION "validate_purchase_installment_schedule"()',
  );
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf("$function$ LANGUAGE plpgsql;", start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("SK-270 imported first payment due date", () => {
  it("changes nothing but the function body — no column, enum, table, or trigger", () => {
    expect(executableMigration).not.toMatch(/ALTER TABLE/i);
    expect(executableMigration).not.toMatch(/ALTER TYPE/i);
    expect(executableMigration).not.toMatch(/CREATE TABLE/i);
    expect(executableMigration).not.toMatch(/CREATE TRIGGER|DROP TRIGGER/i);
    expect(executableMigration).not.toMatch(/UPDATE\s+"purchase_installments"/i);
    expect(executableMigration.trim()).toMatch(
      /^CREATE OR REPLACE FUNCTION "validate_purchase_installment_schedule"\(\)/,
    );
    // No new due trigger was needed: due_at alone carries the real date.
    expect(schema.purchaseInstallmentDueTrigger.enumValues).toEqual([
      "acceptance",
      "producer_import",
      "monthly_anniversary",
      "artist_approval",
    ]);
  });

  it("lets an imported first installment carry a real due date while pinning its anchor", () => {
    const body = scheduleValidatorBody(migration);
    expect(body).toMatch(
      /purchase_source_kind = 'imported_existing_work'\s+AND \([\s\S]*?"due_at" IS NULL\s+OR "triggered_at" IS DISTINCT FROM purchase_established_at/,
    );
    // The old rule pinned due_at to the establishment instant. It is gone.
    expect(body).not.toContain('"due_at" IS DISTINCT FROM purchase_established_at');
    // Accepted (non-imported) purchases keep the exact rule they had.
    expect(body).toMatch(
      /purchase_source_kind <> 'imported_existing_work'\s+AND \(\s+"due_at" IS DISTINCT FROM purchase_accepted_at\s+OR "triggered_at" IS DISTINCT FROM purchase_accepted_at/,
    );
  });

  it("keeps every other check in the 0054 validator byte for byte", () => {
    const before = scheduleValidatorBody(foundationMigration)
      .replace(/^\s*--.*$/gm, "")
      .replace(/\n\s*\n/g, "\n");
    const after = scheduleValidatorBody(migration)
      .replace(/^\s*--.*$/gm, "")
      .replace(/\n\s*\n/g, "\n");

    expect(
      after.replace('"due_at" IS NULL', '"due_at" IS DISTINCT FROM purchase_established_at'),
    ).toBe(before);
  });
});
