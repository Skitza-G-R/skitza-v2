import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "song-tabs.tsx"), "utf-8");

describe("SongTabs — mode-aware tab control (3 vs 4 tabs)", () => {
  it("exports a SongTabs component (function)", () => {
    expect(SRC).toMatch(/export function SongTabs/);
  });

  it("exports a SongTab discriminated-union type", () => {
    expect(SRC).toMatch(/export type SongTab/);
  });

  it("supports all 4 tab keys: overview / versions / sessions / payments", () => {
    expect(SRC).toContain('"overview"');
    expect(SRC).toContain('"versions"');
    expect(SRC).toContain('"sessions"');
    expect(SRC).toContain('"payments"');
  });

  it("renders the 3 album-mode tab labels: Overview / Versions / Sessions", () => {
    expect(SRC).toContain("Overview");
    expect(SRC).toContain("Versions");
    expect(SRC).toContain("Sessions");
  });

  it("only renders the Payments tab in single mode (mode === 'single')", () => {
    expect(SRC).toContain("Payments");
    // The payments tab is gated on mode === "single"
    expect(SRC).toMatch(/mode\s*===\s*["']single["']/);
  });

  it("uses role=tablist + role=tab + aria-selected for accessibility", () => {
    expect(SRC).toContain('role="tablist"');
    expect(SRC).toContain('role="tab"');
    expect(SRC).toContain("aria-selected");
  });

  it("renders the versionsCount inline with the Versions tab label", () => {
    expect(SRC).toContain("versionsCount");
  });

  it("uses --bg-sidebar for the active tab background (PR C — dark-fill design match)", () => {
    expect(SRC).toContain("--bg-sidebar");
  });

  it("uses --bg-elevated as the active-tab text color (white on dark)", () => {
    expect(SRC).toContain("--bg-elevated");
  });

  it("renders a leading icon on every tab (PR C — design polish)", () => {
    expect(SRC).toMatch(/from\s*["']lucide-react["']/);
    expect(SRC).toMatch(/<Icon\s*size=/);
  });

  it("uses --bg-elevated for the pill container background", () => {
    expect(SRC).toContain("--bg-elevated");
  });

  it("wires the active state to an onChange callback prop", () => {
    expect(SRC).toContain("onChange");
  });

  it("sets id + aria-controls on each tab button (matches aria-labelledby on panels)", () => {
    for (const key of ["overview", "versions", "sessions", "payments"]) {
      const idStatic = new RegExp(`id=["']tab-${key}["']`);
      const idDynamic = /id=\{`tab-\$\{[^}]+\}`\}/;
      const ctrlStatic = new RegExp(`aria-controls=["']panel-${key}["']`);
      const ctrlDynamic = /aria-controls=\{`panel-\$\{[^}]+\}`\}/;
      expect(idStatic.test(SRC) || idDynamic.test(SRC)).toBe(true);
      expect(ctrlStatic.test(SRC) || ctrlDynamic.test(SRC)).toBe(true);
    }
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
