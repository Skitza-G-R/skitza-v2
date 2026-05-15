import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "stat-tile.tsx"), "utf-8");

describe("StatTile", () => {
  it("exports a typed StatTileVariant of default | danger | ok", () => {
    expect(SRC).toMatch(/export type StatTileVariant\s*=\s*["']default["']\s*\|\s*["']danger["']\s*\|\s*["']ok["']/);
  });

  it("declares a StatTileProps with label + value + optional variant + optional sub", () => {
    // value can be a string OR ReactNode — we just confirm the prop names appear
    expect(SRC).toContain("label");
    expect(SRC).toContain("value");
    expect(SRC).toContain("variant");
    expect(SRC).toContain("sub");
  });

  it("uses the danger token --fg-danger for the danger variant tint", () => {
    expect(SRC).toContain("--fg-danger");
  });

  it("uses the ok token --fg-success for the ok variant tint", () => {
    expect(SRC).toContain("--fg-success");
  });

  it("uses bg-elevated for the tile background (default variant)", () => {
    expect(SRC).toContain("--bg-elevated");
  });

  it("uses fg-muted for the label color", () => {
    expect(SRC).toContain("--fg-muted");
  });

  it("renders the label as uppercase tracking eyebrow", () => {
    expect(SRC).toMatch(/uppercase/);
    expect(SRC).toMatch(/tracking/);
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

  it("exports a StatTile component (function)", () => {
    expect(SRC).toMatch(/export function StatTile/);
  });
});
