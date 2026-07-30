import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "artist-store-preview.tsx"), "utf8");

describe("ArtistStorePreview", () => {
  it("composes the real signed-in artist Store components", () => {
    expect(SRC).toMatch(/ProducerHero/);
    expect(SRC).toMatch(/FocalProductCard/);
    expect(SRC).toMatch(/QuietProductList/);
    expect(SRC).toMatch(/ProductDetailScreen/);
  });

  it("is a full-screen producer preview that never navigates", () => {
    expect(SRC).toMatch(/DialogPrimitive\.Content/);
    expect(SRC).toMatch(/fixed inset-0/);
    expect(SRC).toContain("Preview only");
    expect(SRC).not.toMatch(/next\/link|router\.(?:push|replace)|href=/);
  });

  it("shows only live products and preserves their existing order", () => {
    expect(SRC).toMatch(/products\.filter\(\(product\) => product\.active\)/);
    expect(SRC).not.toMatch(/\.sort\(/);
  });

  it("shows only the public tagline instead of encoded editor metadata", () => {
    expect(SRC).toContain("decodeDescription(product.description).tagline || null");
    expect(SRC).not.toContain("description: product.description");
  });

  it("opens the real product detail in mutation-safe preview mode", () => {
    expect(SRC).toMatch(/onPreviewDetails/);
    expect(SRC).toMatch(/previewMode=\{true\}/);
    expect(SRC).toMatch(/onPreviewBack/);
    expect(SRC).not.toMatch(/\binert\b/);
  });

  it("clears a nested detail when the full Store preview closes", () => {
    expect(SRC).toMatch(/if \(!nextOpen\) setDetailProduct\(null\)/);
    expect(SRC).toMatch(/onOpenChange=\{handlePreviewOpenChange\}/);
  });
});
