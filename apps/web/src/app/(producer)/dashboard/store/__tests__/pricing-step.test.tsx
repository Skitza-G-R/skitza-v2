import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "editor-steps", "pricing-step.tsx"), "utf8");

describe("PricingStep shell", () => {
  it("renders the four currency options USD / EUR / GBP / ILS", () => {
    expect(SRC).toContain("USD");
    expect(SRC).toContain("EUR");
    expect(SRC).toContain("GBP");
    expect(SRC).toContain("ILS");
  });

  it("renders the three payment-plan options", () => {
    expect(SRC).toMatch(/full|Pay in full/);
    expect(SRC).toMatch(/split|50%/);
    expect(SRC).toMatch(/installments|Payment plan/);
  });

  it("reads/writes price, currency, sessions, and payment plan", () => {
    expect(SRC).toMatch(/price/);
    expect(SRC).toMatch(/currency/);
    expect(SRC).toMatch(/sessions/);
    expect(SRC).toMatch(/paymentPlan/);
  });

  it("renders an 'Unlimited' pill toggle for the sessions count", () => {
    expect(SRC).toMatch(/Unlimited/);
    expect(SRC).toMatch(/aria-label="Unlimited sessions"/);
    expect(SRC).toMatch(/aria-pressed=\{unlimitedSessions\}/);
  });

  it("does not mention the dropped fields", () => {
    expect(SRC).not.toMatch(/depositPct/);
    expect(SRC).not.toMatch(/duration/);
    expect(SRC).not.toMatch(/revisions/);
    expect(SRC).not.toMatch(/turnaround/);
  });

  it("uses Syne for the price input (font-display)", () => {
    expect(SRC).toMatch(/font-display|font-syne/);
  });
});
