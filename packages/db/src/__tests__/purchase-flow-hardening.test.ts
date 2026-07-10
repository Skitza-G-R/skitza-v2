import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import * as schema from "../schema";

describe("purchase flow hardening schema", () => {
  it("has a private payment-proofs table separate from invoices", () => {
    expect("paymentProofs" in schema).toBe(true);
  });

  it("snapshots every offered payment plan on the purchase request", () => {
    const table = schema.purchaseRequests as unknown as Record<string, unknown>;
    expect("paymentPlanOptionsSnapshot" in table).toBe(true);
    expect("paymentPlanChosenAt" in table).toBe(true);
  });

  it("records which private bucket owns each proof object", () => {
    const table = schema.paymentProofs as unknown as Record<string, unknown>;
    expect("storageBucket" in table).toBe(true);
  });

  it("links a confirmed invoice to exactly one proof for idempotency", () => {
    const table = schema.invoices as unknown as Record<string, unknown>;
    expect("paymentProofId" in table).toBe(true);
  });

  it("ships the matching idempotent database migration", () => {
    const path = join(process.cwd(), "drizzle", "0023_purchase_flow_hardening.sql");
    expect(existsSync(path)).toBe(true);
    if (!existsSync(path)) return;
    const migration = readFileSync(path, "utf8");
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS "payment_proofs"/);
    expect(migration).toMatch(/payment_plan_options_snapshot/);
    expect(migration).toMatch(/payment_plan_chosen_at/);
    expect(migration).toMatch(/payment_proof_id/);
    expect(migration).toMatch(/'audio'/);
  });
});
