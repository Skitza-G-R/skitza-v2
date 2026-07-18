import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { bookingStatus } from "../schema";

describe("booking status lifecycle migration", () => {
  it("exports the current booking lifecycle", () => {
    expect(bookingStatus.enumValues).toEqual([
      "pending_approval",
      "confirmed",
      "rejected",
      "cancelled",
      "completed",
      "no_show",
    ]);
  });

  it("retains the historical idempotent legacy-status migration", () => {
    const path = join(process.cwd(), "drizzle", "0025_booking_status_lifecycle.sql");
    expect(existsSync(path)).toBe(true);

    const sql = readFileSync(path, "utf8");
    const statements = sql
      .split(";")
      .map((statement) => statement.trim())
      .filter(Boolean);

    // PostgreSQL must commit each ADD VALUE before the new label is used.
    // Keeping four ordered statements lets apply-migrations.mjs do that.
    expect(statements).toHaveLength(4);
    expect(statements[0]).toMatch(/ADD VALUE IF NOT EXISTS 'pending_approval'/);
    expect(statements[1]).toMatch(/ADD VALUE IF NOT EXISTS 'pending_payment'/);
    expect(statements[2]).toMatch(/ALTER COLUMN "status" SET DEFAULT 'pending_approval'/);
    expect(statements[3]).toMatch(
      /SET "status" = 'pending_approval'\s+WHERE "status"::text = 'pending'/,
    );
    expect(sql).not.toMatch(/\b(?:BEGIN|COMMIT)\b/);

    expect(sql).not.toMatch(/SET "status" = 'pending_payment'\s+WHERE "status" = 'pending'/);
  });
});
