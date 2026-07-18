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

  it("does not render the removed duplicate payment-plan controls", () => {
    expect(SRC).not.toMatch(/PLAN_OPTIONS|showPaymentPlans/);
  });

  it("reads/writes price, currency, and sessions", () => {
    expect(SRC).toMatch(/price/);
    expect(SRC).toMatch(/currency/);
    expect(SRC).toMatch(/sessions/);
    expect(SRC).not.toMatch(/paymentPlan/);
  });

  it("renders an 'Unlimited' pill toggle for the sessions count", () => {
    expect(SRC).toMatch(/Unlimited/);
    expect(SRC).toMatch(/aria-label="Unlimited sessions"/);
    expect(SRC).toMatch(/aria-pressed=\{unlimitedSessions\}/);
  });

  it("does not mention the dropped fields", () => {
    // Tightened from a bare /duration/ regex which caught Tailwind's
    // `duration-150` motion utilities. The dropped wizard fields are
    // Draft props / object keys, so check for those specific shapes:
    // `duration:` (object literal key, JSX attr) or `.duration` (prop
    // access). Same tightening for `revisions` for the same reason.
    expect(SRC).not.toMatch(/depositPct/);
    expect(SRC).not.toMatch(/\bduration\s*[:=]/);
    expect(SRC).not.toMatch(/\.duration\b/);
    expect(SRC).not.toMatch(/\brevisions\s*[:=]/);
    expect(SRC).not.toMatch(/\.revisions\b/);
    expect(SRC).not.toMatch(/turnaround/);
  });

  it("uses Syne for the price input (font-display)", () => {
    expect(SRC).toMatch(/font-display|font-syne/);
  });

  it("requires positive cash amounts for the flat price and every tier", () => {
    const minimums = SRC.match(/min=\{0\.01\}/g) ?? [];
    expect(minimums).toHaveLength(3);
    expect(SRC).toMatch(/pricing-step-error/);
    expect(SRC).toMatch(/aria-invalid/);
  });
});
