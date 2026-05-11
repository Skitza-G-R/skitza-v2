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
    expect(SRC).toMatch(/split|50\/50/);
    expect(SRC).toMatch(/installments|Monthly/);
  });

  it("reads/writes price, currency, sessions, deposit, payment plan, duration, revisions, turnaround", () => {
    expect(SRC).toMatch(/price/);
    expect(SRC).toMatch(/currency/);
    expect(SRC).toMatch(/sessions/);
    expect(SRC).toMatch(/depositPct/);
    expect(SRC).toMatch(/paymentPlan/);
    expect(SRC).toMatch(/duration/);
    expect(SRC).toMatch(/revisions/);
    expect(SRC).toMatch(/turnaround/);
  });

  it("imports the Toggle component for the unlimited-sessions switch", () => {
    expect(SRC).toMatch(/from\s+["']\.\.\/toggle["']/);
  });

  it("uses Syne for the price input (font-display)", () => {
    expect(SRC).toMatch(/font-display|font-syne/);
  });
});
