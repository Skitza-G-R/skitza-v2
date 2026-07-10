import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import * as schema from "../schema";

function splitTopLevelStatements(source: string): string[] {
  const statements: string[] = [];
  let buffer = "";
  let dollarTag: string | null = null;

  for (let index = 0; index < source.length; ) {
    if (dollarTag) {
      if (source.startsWith(dollarTag, index)) {
        buffer += dollarTag;
        index += dollarTag.length;
        dollarTag = null;
      } else {
        buffer += source[index];
        index += 1;
      }
      continue;
    }

    const openingTag = source.slice(index).match(/^\$([A-Za-z0-9_]*)\$/)?.[0];
    if (openingTag) {
      dollarTag = openingTag;
      buffer += openingTag;
      index += openingTag.length;
      continue;
    }

    if (source[index] === ";") {
      if (buffer.trim()) statements.push(buffer.trim());
      buffer = "";
      index += 1;
      continue;
    }

    buffer += source[index];
    index += 1;
  }

  if (buffer.trim()) statements.push(buffer.trim());
  return statements;
}

function purchaseMigration(): string {
  const path = join(process.cwd(), "drizzle", "0023_purchase_flow_hardening.sql");
  expect(existsSync(path)).toBe(true);
  return readFileSync(path, "utf8");
}

describe("purchase flow hardening schema", () => {
  it("has a private payment-proofs table separate from invoices", () => {
    expect("paymentProofs" in schema).toBe(true);
  });

  it("snapshots every offered payment plan on the purchase request", () => {
    const table = schema.purchaseRequests as unknown as Record<string, unknown>;
    expect("paymentPlanOptionsSnapshot" in table).toBe(true);
    expect("paymentPlanChosenAt" in table).toBe(true);
  });

  it("records the real bucket that owns each proof object", () => {
    const table = schema.paymentProofs as unknown as Record<string, unknown>;
    expect("storageBucket" in table).toBe(true);
    expect("objectEtag" in table).toBe(true);
  });

  it("links a confirmed invoice to exactly one proof for idempotency", () => {
    const table = schema.invoices as unknown as Record<string, unknown>;
    expect("paymentProofId" in table).toBe(true);
  });

  it("ships the matching idempotent database migration", () => {
    const migration = purchaseMigration();
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS "payment_proofs"/);
    expect(migration).toMatch(/payment_plan_options_snapshot/);
    expect(migration).toMatch(/payment_plan_chosen_at/);
    expect(migration).toMatch(/payment_proof_id/);
    expect(migration).toMatch(/object_etag/);
    expect(migration).not.toMatch(/payment_plan_options_snapshot" SET NOT NULL/);
    expect(migration).toMatch(/invoices_legacy_purchase_proof_disabled/);
  });

  it("keeps the legacy-proof preflight and every schema change atomic", () => {
    const migration = purchaseMigration();
    const statements = splitTopLevelStatements(migration);

    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/^--[\s\S]*DO \$migration\$/);

    const invoiceLockAt = migration.indexOf('LOCK TABLE "invoices" IN SHARE ROW EXCLUSIVE MODE');
    const guardAt = migration.indexOf('FROM "invoices"');
    const firstSchemaChangeAt = Math.min(
      ...[
        migration.indexOf('ALTER TABLE "purchase_requests"'),
        migration.indexOf('CREATE TYPE "public"."payment_proof_status"'),
        migration.indexOf('CREATE TABLE IF NOT EXISTS "payment_proofs"'),
      ].filter((index) => index >= 0),
    );
    expect(invoiceLockAt).toBeGreaterThanOrEqual(0);
    expect(invoiceLockAt).toBeLessThan(guardAt);
    expect(guardAt).toBeGreaterThanOrEqual(0);
    expect(guardAt).toBeLessThan(firstSchemaChangeAt);
    expect(migration).toMatch(/"purchase_request_id" IS NOT NULL/);
    expect(migration).toMatch(/"proof_file_url" IS NOT NULL/);
  });

  it("fails loudly without changing or deleting a legacy proof", () => {
    const migration = purchaseMigration();
    const message = migration.match(/RAISE EXCEPTION '([^']+)'/)?.[1];
    const migratorBenignError = /already exists|duplicate_object/i;

    expect(message).toBe("SKITZA_0023_LEGACY_PROOFS_REQUIRE_MANUAL_PRESERVATION");
    expect(migratorBenignError.test(message ?? "")).toBe(false);
    expect(migration).not.toMatch(/INSERT INTO "payment_proofs"[\s\S]*FROM "invoices"/);
    expect(migration).not.toMatch(/DELETE FROM "invoices"/);
    expect(migration).not.toMatch(/'audio'/);
  });

  it("does not let the migration runner ignore data-integrity failures", () => {
    const runner = readFileSync(join(process.cwd(), "apply-migrations.mjs"), "utf8");
    const benignPattern = runner.match(/const benign = (\/[^\n]+\/i)\.test/)?.[1];
    const errorHandler = runner.slice(
      runner.indexOf("const benign ="),
      runner.indexOf('console.log("\\nAll migrations applied successfully.")'),
    );

    expect(benignPattern).toBe("/already exists|duplicate_object/i");
    expect(benignPattern).not.toMatch(/duplicate key|foreign key|does not exist/);
    expect(errorHandler).toMatch(/if \(!benign\) \{[\s\S]*process\.exit\(1\)/);
    expect(runner).not.toMatch(/hadError/);
  });
});
