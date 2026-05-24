import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const COMPONENT_PATH = join(here, "..", "producer-hero.tsx");
const source = readFileSync(COMPONENT_PATH, "utf8");

describe("ProducerHero", () => {
  it("exports a ProducerHero function", () => {
    expect(source).toMatch(/export function ProducerHero/);
  });

  it("accepts producerName + producerLogoUrl props", () => {
    expect(source).toMatch(/producerName/);
    expect(source).toMatch(/producerLogoUrl/);
  });

  it("uses the brand-primary → brand-copper gradient on the cover block", () => {
    expect(source).toMatch(/var\(--brand-primary\)/);
    expect(source).toMatch(/var\(--brand-copper\)/);
  });

  it("renders the producer name in font-display", () => {
    expect(source).toMatch(/font-display/);
    expect(source).toMatch(/producerName/);
  });

  it("renders a logo circle (rounded-full) overlapping the gradient", () => {
    expect(source).toMatch(/rounded-full/);
  });

  it("falls back to an initial letter when no logo url", () => {
    expect(source).toMatch(/charAt\(0\)/);
  });

  it("entrance animation uses reveal-up", () => {
    expect(source).toMatch(/reveal-up/);
  });

  it("renders on an elevated surface (bg-elevated)", () => {
    expect(source).toMatch(/var\(--bg-elevated\)/);
  });
});
