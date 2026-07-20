import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const serviceSource = readFileSync(join(here, "..", "service.ts"), "utf8");
const schemaSource = readFileSync(
  join(here, "..", "..", "..", "..", "..", "..", "..", "packages", "db", "src", "schema.ts"),
  "utf8",
);
const migrationSource = readFileSync(
  join(
    here,
    "..",
    "..",
    "..",
    "..",
    "..",
    "..",
    "..",
    "packages",
    "db",
    "drizzle",
    "0027_purchase_foundation.sql",
  ),
  "utf8",
);

describe("payment proof concurrency and immutable ledger contract", () => {
  it("serializes submit, confirm, and reject on the shared purchase ledger lock", () => {
    expect(serviceSource.match(/purchase-ledger:\$\{input\.purchaseId\}/g)).toHaveLength(1);
    expect(serviceSource.match(/purchase-ledger:\$\{initial\.purchaseId\}/g)).toHaveLength(2);
    expect(serviceSource.match(/pg_advisory_xact_lock/g)).toHaveLength(3);
  });

  it("allows only one pending proof and chains replacement to rejected immutable history", () => {
    expect(schemaSource).toContain("payment_proofs_one_pending_per_installment");
    expect(schemaSource).toContain("payment_proofs_replaces_proof_unique");
    expect(serviceSource).toMatch(/proof\.status === "rejected"/);
    expect(serviceSource).toMatch(/replacesProofId: replacesProof\?\.id \?\? null/);
    expect(migrationSource).toContain('CREATE TRIGGER "payment_proofs_protect_evidence"');
  });

  it("creates one proof-sourced append-only payment with two independent uniqueness guards", () => {
    expect(serviceSource.match(/insert\(purchasePayments\)/g)).toHaveLength(1);
    expect(serviceSource).toMatch(/operationKey = `proof:\$\{proof\.id\}`/);
    expect(serviceSource).toMatch(/proofId: proof\.id/);
    expect(schemaSource).toContain("purchase_payments_operation_key_unique");
    expect(schemaSource).toContain("purchase_payments_proof_unique");
    expect(migrationSource).toContain('CREATE TRIGGER "purchase_payments_append_only"');
  });

  it("uses compare-and-set terminal transitions and keeps every producer write tenant-scoped", () => {
    expect(serviceSource.match(/eq\(paymentProofs\.status, "pending"\)/g)).toHaveLength(3);
    expect(
      (serviceSource.match(/eq\(paymentProofs\.producerId, input\.producerId\)/g) ?? []).length,
    ).toBeGreaterThanOrEqual(5);
    expect(serviceSource).toMatch(/eq\(purchaseInstallments\.producerId, context\.producerId\)/);
    expect(serviceSource).toMatch(/eq\(purchases\.producerId, context\.producerId\)/);
    expect(serviceSource).toMatch(/eq\(projects\.producerId, context\.producerId\)/);
  });
});
