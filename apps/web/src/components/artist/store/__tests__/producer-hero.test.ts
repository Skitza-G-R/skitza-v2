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

  it("uses a compact neutral bordered studio header", () => {
    expect(source).toMatch(/rounded-\[var\(--radius-lg\)\] border/);
    expect(source).toMatch(/var\(--border-subtle\)/);
    expect(source).not.toMatch(/gradient|brand-copper/);
  });

  it("renders the producer name in font-display", () => {
    expect(source).toMatch(/font-display/);
    expect(source).toMatch(/producerName/);
  });

  it("renders a compact circular studio identity", () => {
    expect(source).toMatch(/rounded-full/);
    expect(source).toMatch(/h-11 w-11/);
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

  it("does not use overlapping or floating-logo positioning", () => {
    expect(source).not.toMatch(/absolute|-top-|ring-4|shadow-/);
  });
});
