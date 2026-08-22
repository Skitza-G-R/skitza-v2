import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import * as schema from "../schema";

const migration = readFileSync(
  join(process.cwd(), "drizzle/0055_purchase_commercial_established_default.sql"),
  "utf8",
);
const executableMigration = migration.replace(/^\s*--.*$/gm, "");

describe("SK-255 purchase commercial establishment default", () => {
  it("keeps the 0054 column contract untouched", () => {
    expect(schema.purchases.commercialEstablishedAt.notNull).toBe(true);
    expect(schema.purchases.commercialEstablishedAt.hasDefault).toBe(false);
    expect(schema.purchases.acceptedAt.notNull).toBe(false);
    expect(executableMigration).not.toMatch(/ALTER TABLE/i);
    expect(executableMigration).not.toMatch(/UPDATE\s+"purchases"/i);
  });

  it("fills a missing establishment time from Artist acceptance before insert only", () => {
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION "default_purchase_commercial_established_at"\(\)[\s\S]*RETURNS trigger/,
    );
    expect(migration).toContain(
      'NEW."commercial_established_at" := COALESCE(NEW."commercial_established_at", NEW."accepted_at");',
    );
    expect(migration).toMatch(
      /CREATE TRIGGER "purchases_default_commercial_established_at"\s+BEFORE INSERT ON "purchases"\s+FOR EACH ROW EXECUTE FUNCTION "default_purchase_commercial_established_at"\(\);/,
    );
    expect(executableMigration).not.toMatch(/BEFORE UPDATE|AFTER INSERT|OR UPDATE/);
    // Imported Purchases keep accepted_at null and always supply the column;
    // the default must never invent Artist acceptance evidence.
    expect(executableMigration).not.toMatch(/NEW\."accepted_at"\s*:=/);
  });
});
