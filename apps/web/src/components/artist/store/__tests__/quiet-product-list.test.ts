import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const COMPONENT_PATH = join(here, "..", "quiet-product-list.tsx");
const source = readFileSync(COMPONENT_PATH, "utf8");

describe("QuietProductList", () => {
  it("exports a QuietProductList function", () => {
    expect(source).toMatch(/export function QuietProductList/);
  });

  it("renders a restrained More services heading", () => {
    expect(source).toMatch(/More services/);
    expect(source).toMatch(/font-mono/);
    expect(source).toMatch(/uppercase/);
    expect(source).toMatch(/producerName/);
  });

  it("uses bordered cards and a two-column desktop catalog", () => {
    expect(source).toMatch(/grid gap-3 md:grid-cols-2/);
    expect(source).toMatch(/rounded-\[var\(--radius-lg\)\] border/);
    expect(source).toMatch(/View service/);
  });

  it("uses the shared price-label helper for each row", () => {
    expect(source).toMatch(/from\s+['"]~\/lib\/store\/format-price-label['"]/);
    expect(source).toMatch(/formatPriceLabel/);
  });

  it("links each row via productHref (funnel for flat, legacy for per-song)", () => {
    expect(source).toContain("href={withArtistStudio(productHref(product), studioId)}");
    expect(source).toMatch(/from\s+['"]~\/lib\/store\/product-href['"]/);
  });

  it("renders nothing when products list is empty", () => {
    expect(source).toMatch(/products\.length\s*===\s*0/);
  });

  it("uses sk-press for tap feedback on the row link", () => {
    expect(source).toMatch(/sk-press/);
  });

  it("discloses tax next to every secondary-row price", () => {
    expect(source).toMatch(/taxModeFootnote/);
    expect(source).toMatch(/taxMode\?: TaxMode/);
    expect(source).toMatch(/taxRatePct\?: number/);
  });

  it("uses the same row as an inert preview button when requested", () => {
    expect(source).toMatch(/onPreviewDetails\?: \(trigger: HTMLButtonElement\) => void/);
    expect(source).toMatch(/onPreviewDetails\(event\.currentTarget\)/);
    expect(source).toMatch(/type="button"/);
  });

  it("allows long product names to wrap safely", () => {
    expect(source).toMatch(/line-clamp-2/);
    expect(source).toMatch(/\[overflow-wrap:anywhere\]/);
  });

  it("entrance animation uses reveal-up", () => {
    expect(source).toMatch(/reveal-up/);
  });
});
