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

  it("accepts an optional disabled prop on HeroCTAProps", () => {
    expect(SRC).toMatch(/disabled\?:\s*boolean/);
  });

  it("wires the disabled prop onto the <button> element", () => {
    // Either a literal `disabled` attribute or pass-through via {disabled}
    expect(SRC).toMatch(/disabled=\{disabled\}|<button[^>]*\bdisabled\b/);
  });

  it("renders a 'Coming soon' title hint when disabled is set", () => {
    expect(SRC).toContain("Coming soon");
  });

  it("applies disabled:opacity-50 to visually mute the button", () => {
    expect(SRC).toContain("disabled:opacity-50");
  });
});
