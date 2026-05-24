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

  it("links the primary CTA to /artist/store/{id}", () => {
    expect(source).toMatch(/\/artist\/store\/\$\{product\.id\}/);
    expect(source).toMatch(/View details/);
  });

  it("uses the sidebar surface for the primary CTA", () => {
    expect(source).toMatch(/var\(--bg-sidebar\)/);
    expect(source).toMatch(/var\(--fg-onsidebar\)/);
  });

  it("uses rounded-[var(--radius-lg)] on the card (not rounded-full)", () => {
    expect(source).toMatch(/rounded-\[var\(--radius-lg\)\]/);
  });

  it("renders Stripe · soon as a quiet footnote (mono uppercase)", () => {
    expect(source).toMatch(/Stripe/);
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
