import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "song-space.tsx"), "utf-8");

describe("SongSpace — composes hero + strip + tabs + active panel", () => {
  it("exports a SongSpace component (function)", () => {
    expect(SRC).toMatch(/export function SongSpace/);
  });

  it("is a client component (owns active-tab state)", () => {
    expect(SRC).toMatch(/^["']use client["']/);
  });

  it("imports SongSpaceHero + SongSpaceStatStrip + SongTabs", () => {
    expect(SRC).toContain("SongSpaceHero");
    expect(SRC).toContain("SongSpaceStatStrip");
    expect(SRC).toContain("SongTabs");
  });

  it("imports OverviewTab + VersionsTab + SessionsTab + PaymentsTab", () => {
    expect(SRC).toContain("OverviewTab");
    expect(SRC).toContain("VersionsTab");
    expect(SRC).toContain("SessionsTab");
    expect(SRC).toContain("PaymentsTab");
  });

  it("uses useState for the active tab", () => {
    expect(SRC).toContain("useState");
  });

  it("defaults the active tab to 'overview'", () => {
    expect(SRC).toMatch(/useState[^(]*\(\s*["']overview["']/);
  });

  it("renders each tab panel conditionally based on active tab", () => {
    expect(SRC).toMatch(/active\s*===\s*["']overview["']/);
    expect(SRC).toMatch(/active\s*===\s*["']versions["']/);
    expect(SRC).toMatch(/active\s*===\s*["']sessions["']/);
    expect(SRC).toMatch(/active\s*===\s*["']payments["']/);
  });

  it("only renders the Payments panel in single mode", () => {
    expect(SRC).toMatch(/mode\s*===\s*["']single["']/);
  });

  it("forwards mode through to the SongSpaceHero + SongTabs", () => {
    expect(SRC).toMatch(/SongSpaceHero[^>]*mode/);
    expect(SRC).toMatch(/SongTabs[^>]*mode/);
  });

  it("forbids --surface-card", () => {
    expect(SRC).not.toContain("--surface-card");
  });

  it("forbids --text-muted", () => {
    expect(SRC).not.toContain("--text-muted");
  });

  it("forbids --text-strong", () => {
    expect(SRC).not.toContain("--text-strong");
  });

  it("forbids --surface-hover", () => {
    expect(SRC).not.toContain("--surface-hover");
  });

  it("forbids --brand-primary-on", () => {
    expect(SRC).not.toContain("--brand-primary-on");
  });
});
