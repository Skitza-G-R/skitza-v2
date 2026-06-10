import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const COMPONENT_PATH = join(here, "..", "focal-product-card.tsx");
const source = readFileSync(COMPONENT_PATH, "utf8");

describe("FocalProductCard", () => {
  it("exports a FocalProductCard function", () => {
    expect(source).toMatch(/export function FocalProductCard/);
  });

  it("uses the shared price-label helper (no inline formatters)", () => {
    expect(source).toMatch(/from\s+['"]~\/lib\/store\/format-price-label['"]/);
    expect(source).toMatch(/formatPriceLabel/);
  });

  it("renders the title in font-display", () => {
    expect(source).toMatch(/font-display/);
    expect(source).toMatch(/product\.name/);
  });

  it("renders the description with line-clamp-2", () => {
    expect(source).toMatch(/line-clamp-2/);
    expect(source).toMatch(/product\.description/);
  });

  it("stacks the header on phones — price drops below the title (SK-49)", () => {
    expect(source).toMatch(/flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between/);
    expect(source).toMatch(/flex flex-row items-baseline gap-2 sm:flex-col sm:items-end/);
  });

  it("links the primary CTA via productHref (funnel for flat, legacy for per-song)", () => {
    expect(source).toMatch(/href=\{productHref\(product\)\}/);
    expect(source).toMatch(/from\s+['"]~\/lib\/store\/product-href['"]/);
    expect(source).toMatch(/View details/);
  });

  it("uses the sidebar surface for the primary CTA", () => {
    expect(source).toMatch(/var\(--bg-sidebar\)/);
    expect(source).toMatch(/var\(--fg-onsidebar\)/);
  });

  it("uses rounded-[var(--radius-lg)] on the card (not rounded-full)", () => {
    expect(source).toMatch(/rounded-\[var\(--radius-lg\)\]/);
  });

  it("renders an honest payment footnote per pricing model (mono uppercase)", () => {
    // per-song keeps the legacy Stripe-soon line; funnel products promise
    // request-to-book with no payment yet.
    expect(source).toMatch(/Stripe · payments soon/);
    expect(source).toMatch(/Request to book · no payment yet/);
    expect(source).toMatch(/uppercase/);
    expect(source).toMatch(/font-mono/);
  });

  it("renders the tax footnote when taxMode is set", () => {
    expect(source).toMatch(/taxMode/);
    expect(source).toMatch(/taxRatePct/);
    expect(source).toMatch(/taxModeFootnote/);
  });

  it("entrance animation uses reveal-up", () => {
    expect(source).toMatch(/reveal-up/);
  });
});
