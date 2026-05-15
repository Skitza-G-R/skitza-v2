import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "payments-tab.tsx"), "utf-8");

describe("PaymentsTab — Outstanding card + milestones list (Album page)", () => {
  it("exports a PaymentsTab component (function)", () => {
    expect(SRC).toMatch(/export function PaymentsTab/);
  });

  it("sets role=tabpanel on the wrapping section", () => {
    expect(SRC).toContain('role="tabpanel"');
  });

  it("renders all 3 money labels: Total / Paid / Balance", () => {
    expect(SRC).toMatch(/>\s*Total\s*</);
    expect(SRC).toMatch(/>\s*Paid\s*</);
    expect(SRC).toMatch(/>\s*Balance\s*</);
  });

  it("renders the 'Send reminder' + 'Send invoice' buttons", () => {
    expect(SRC).toMatch(/Send\s*reminder/);
    expect(SRC).toMatch(/Send\s*invoice/);
  });

  it("renders a Milestones header above the milestones list", () => {
    expect(SRC).toMatch(/Milestones/);
  });

  it("renders an empty state when milestones is empty", () => {
    expect(SRC).toMatch(/No milestones/);
  });

  it("uses fg-danger for the Balance value when outstandingCents > 0", () => {
    expect(SRC).toContain("--fg-danger");
  });

  it("declares the milestone status union (paid | pending | overdue)", () => {
    expect(SRC).toContain('"paid"');
    expect(SRC).toContain('"pending"');
    expect(SRC).toContain('"overdue"');
  });

  it("displays the currency-formatted amount per milestone row", () => {
    expect(SRC).toContain("amountCents");
    expect(SRC).toContain("formatMoney");
  });

  it("accepts paidCents + outstandingCents + currency + milestones + nextChargeAt props", () => {
    expect(SRC).toContain("paidCents");
    expect(SRC).toContain("outstandingCents");
    expect(SRC).toContain("currency");
    expect(SRC).toContain("milestones");
    expect(SRC).toContain("nextChargeAt");
  });

  it("forbids --surface-card", () => {
    expect(SRC).not.toContain("--surface-card");
  });

  it("forbids --text-muted", () => {
    expect(SRC).not.toContain("--text-muted");
  });

  it("forbids --text-strong", () => {
    expect(SRC).not.toContain("--text-strong");
  });

  it("forbids --surface-hover", () => {
    expect(SRC).not.toContain("--surface-hover");
  });

  it("forbids --brand-primary-on", () => {
    expect(SRC).not.toContain("--brand-primary-on");
  });
});
