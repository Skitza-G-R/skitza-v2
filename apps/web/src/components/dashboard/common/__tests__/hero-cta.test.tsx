import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "hero-cta.tsx"), "utf-8");

describe("HeroCTA", () => {
  it("exports a typed HeroCTAVariant of play | upload", () => {
    expect(SRC).toMatch(/export type HeroCTAVariant\s*=\s*["']play["']\s*\|\s*["']upload["']/);
  });

  it("exports a HeroCTA component (function)", () => {
    expect(SRC).toMatch(/export function HeroCTA/);
  });

  it("uses border-radius: 999px (rounded-full) for the pill shape", () => {
    expect(SRC).toContain("rounded-full");
  });

  it("supports both variants via the variant prop", () => {
    expect(SRC).toContain("variant");
    expect(SRC).toContain('"play"');
    expect(SRC).toContain('"upload"');
  });

  it("uses backdrop-blur for the upload (frosted glass) variant", () => {
    expect(SRC).toContain("backdrop-blur");
  });

  it("renders inside a <button> element", () => {
    expect(SRC).toMatch(/<button/);
  });

  it("passes onClick through", () => {
    expect(SRC).toContain("onClick");
  });

  it("forbids non-existent --surface-card token", () => {
    expect(SRC).not.toContain("--surface-card");
  });

  it("forbids non-existent --text-muted token", () => {
    expect(SRC).not.toContain("--text-muted");
  });

  it("forbids non-existent --text-strong token", () => {
    expect(SRC).not.toContain("--text-strong");
  });

  it("forbids non-existent --surface-hover token", () => {
    expect(SRC).not.toContain("--surface-hover");
  });

  it("forbids non-existent --brand-primary-on token", () => {
    expect(SRC).not.toContain("--brand-primary-on");
  });
});
