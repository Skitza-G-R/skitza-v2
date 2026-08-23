import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import * as schema from "../schema";

const migration = readFileSync(
  join(process.cwd(), "drizzle/0056_active_work_import_agreement_pdf.sql"),
  "utf8",
);
const executableMigration = migration.replace(/^\s*--.*$/gm, "");

describe("SK-259 imported agreement PDF ledger", () => {
  it("adds one nullable ledger column to the import attestation and nothing else", () => {
    expect(schema.purchaseImportAttestations.agreementPdfContract.notNull).toBe(false);
    expect(schema.purchaseImportAttestations.agreementPdfContract.hasDefault).toBe(false);
    expect(executableMigration).toMatch(
      /ALTER TABLE "purchase_import_attestations"\s+ADD COLUMN "agreement_pdf_contract" text;/,
    );
    // Additive only: the Purchase snapshot, triggers, and existing rows are untouched.
    expect(executableMigration.match(/ALTER TABLE/gi)).toHaveLength(1);
    expect(executableMigration).not.toMatch(/"purchases"|DROP|UPDATE|TRIGGER|NOT NULL/i);
  });
});
