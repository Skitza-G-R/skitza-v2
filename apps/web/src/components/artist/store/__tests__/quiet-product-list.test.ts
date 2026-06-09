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

  it("renders an 'Also from {producerName}' eyebrow in mono uppercase", () => {
    expect(source).toMatch(/Also from/);
    expect(source).toMatch(/font-mono/);
    expect(source).toMatch(/uppercase/);
    expect(source).toMatch(/producerName/);
  });

  it("uses the shared price-label helper for each row", () => {
    expect(source).toMatch(/from\s+['"]~\/lib\/store\/format-price-label['"]/);
    expect(source).toMatch(/formatPriceLabel/);
  });

  it("links each row to /artist/store/{id}", () => {
    expect(source).toMatch(/\/artist\/store\/\$\{/);
  });

  it("renders nothing when products list is empty", () => {
    expect(source).toMatch(/products\.length\s*===\s*0/);
  });

  it("uses sk-press for tap feedback on the row link", () => {
    expect(source).toMatch(/sk-press/);
  });

  it("entrance animation uses reveal-up", () => {
    expect(source).toMatch(/reveal-up/);
  });
});
