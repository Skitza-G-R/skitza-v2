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

  it("stacks the header on phones and keeps the price separate", () => {
    expect(source).toMatch(/flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between/);
    expect(source).toMatch(/font-mono text-\[21px\]/);
  });

  it("links the live CTA via the unified productHref", () => {
    expect(source).toContain("href={withArtistStudio(productHref(product), studioId)}");
    expect(source).toMatch(/from\s+['"]~\/lib\/store\/product-href['"]/);
    expect(source).toMatch(/View service/);
  });

  it("turns the same CTA into a safe producer-preview button when requested", () => {
    expect(source).toMatch(/onPreviewDetails\?: \(trigger: HTMLButtonElement\) => void/);
    expect(source).toMatch(/onPreviewDetails\(event\.currentTarget\)/);
    expect(source).toMatch(/onPreviewDetails \? \(/);
    expect(source).toMatch(/type="button"/);
  });

  it("wraps long focal product names without overflowing", () => {
    expect(source).toMatch(/break-words/);
    expect(source).toMatch(/\[overflow-wrap:anywhere\]/);
  });

  it("uses the Skitza dark surface with an amber primary CTA", () => {
    expect(source).toMatch(/var\(--bg-sidebar\)/);
    expect(source).toMatch(/var\(--brand-primary\)/);
    expect(source).toMatch(/var\(--fg-on-brand\)/);
  });

  it("uses the expressive card radius without turning the card into a pill", () => {
    expect(source).toMatch(/rounded-\[var\(--radius-xl\)\]/);
  });

  it("keeps the signature record-groove treatment inside the focal card", () => {
    expect(source).toMatch(/inset 0 0 0 24px/);
    expect(source).not.toMatch(/Signature|coverGradient|producerHue/);
    expect(source).not.toMatch(/Stripe|Tranzila|Pay by card|payments soon/i);
    expect(source).toMatch(/borderColor/);
  });

  it("renders the tax footnote when taxMode is set", () => {
    expect(source).toMatch(/taxMode/);
    expect(source).toMatch(/taxRatePct/);
    expect(source).toMatch(/taxModeFootnote/);
  });

  it("labels zero sessions as unlimited only when a real session duration exists", () => {
    expect(source).toMatch(/product\.durationMin[\s\S]*product\.sessionCount === 0/);
    expect(source).toMatch(/UNLIMITED SESSIONS/);
  });

  it("entrance animation uses reveal-up", () => {
    expect(source).toMatch(/reveal-up/);
  });
});
