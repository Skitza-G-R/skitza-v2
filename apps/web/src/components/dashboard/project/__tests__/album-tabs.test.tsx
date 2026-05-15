import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "album-tabs.tsx"), "utf-8");

describe("AlbumTabs — pill-shaped 4-tab segmented control", () => {
  it("exports an AlbumTabs component (function)", () => {
    expect(SRC).toMatch(/export function AlbumTabs/);
  });

  it("exports an AlbumTab discriminated-union type", () => {
    expect(SRC).toMatch(/export type AlbumTab/);
  });

  it("supports all 4 tabs: songs / files / payments / log", () => {
    // The active tab type literal — all 4 must appear in the source.
    expect(SRC).toContain('"songs"');
    expect(SRC).toContain('"files"');
    expect(SRC).toContain('"payments"');
    expect(SRC).toContain('"log"');
  });

  it("renders all 4 tab labels: Songs / Files / Payments / Studio Log", () => {
    // Labels live in the TabEntry array as string literals.
    expect(SRC).toContain("Songs");
    expect(SRC).toContain('"Files"');
    expect(SRC).toContain('"Payments"');
    expect(SRC).toContain('"Studio Log"');
  });

  it("uses role=tablist + role=tab + aria-selected for accessibility", () => {
    expect(SRC).toContain('role="tablist"');
    expect(SRC).toContain('role="tab"');
    expect(SRC).toContain("aria-selected");
  });

  it("renders the songsCount inline with the Songs tab label", () => {
    expect(SRC).toContain("songsCount");
  });

  it("uses the brand-primary active background (matches WorkspaceListView pattern)", () => {
    expect(SRC).toContain("--brand-primary");
  });

  it("uses bg-sidebar for the active-tab text contrast (matches WorkspaceListView)", () => {
    expect(SRC).toContain("--bg-sidebar");
  });

  it("uses bg-elevated for the pill container background", () => {
    expect(SRC).toContain("--bg-elevated");
  });

  it("uses border-subtle for the pill container border", () => {
    expect(SRC).toContain("--border-subtle");
  });

  it("wraps the active state on an onChange callback prop", () => {
    expect(SRC).toContain("onChange");
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

  it("sets id + aria-controls on each tab button (matches aria-labelledby on panels)", () => {
    // The button id + aria-controls must be wired so the panel's
    // aria-labelledby="tab-<key>" has a corresponding labelling element.
    // We accept either a template-literal interpolation form
    //   id={`tab-${t.key}`} aria-controls={`panel-${t.key}`}
    // or a static string form
    //   id="tab-songs" aria-controls="panel-songs"
    // for each of the 4 tab keys.
    for (const key of ["songs", "files", "payments", "log"]) {
      const idStatic = new RegExp(`id=["']tab-${key}["']`);
      const idDynamic = /id=\{`tab-\$\{[^}]+\}`\}/;
      const ctrlStatic = new RegExp(`aria-controls=["']panel-${key}["']`);
      const ctrlDynamic = /aria-controls=\{`panel-\$\{[^}]+\}`\}/;
      expect(idStatic.test(SRC) || idDynamic.test(SRC)).toBe(true);
      expect(ctrlStatic.test(SRC) || ctrlDynamic.test(SRC)).toBe(true);
    }
  });
});
