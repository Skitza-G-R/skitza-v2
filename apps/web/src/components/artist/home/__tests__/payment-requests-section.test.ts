import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(
  join(__dirname, "../payment-requests-section.tsx"),
  "utf-8",
);

describe("PaymentRequestsSection", () => {
  it("uses text-brand-copper for amounts", () => {
    expect(SRC).toMatch(/text-brand-copper/);
  });

  it("caps the visible list at 3 rows", () => {
    expect(SRC).toMatch(/\.slice\(0,\s*3\)/);
  });

  it("renders Pay all → action", () => {
    expect(SRC).toMatch(/Pay\s*all/);
  });

  it("shows the plan label on each row", () => {
    expect(SRC).toMatch(/booking\.plan|row\.plan/);
  });

  it("renders nothing when there are no open invoices", () => {
    expect(SRC).toMatch(/bookings\.length\s*===\s*0/);
  });
});
