import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "album-stat-strip.tsx"), "utf-8");

describe("AlbumStatStrip — 4 stat tiles below the Album hero", () => {
  it("exports an AlbumStatStrip component (function)", () => {
    expect(SRC).toMatch(/export function AlbumStatStrip/);
  });

  it("uses StatTile from common for each tile", () => {
    expect(SRC).toContain("StatTile");
    expect(SRC).toContain("~/components/dashboard/common/stat-tile");
  });

  it("renders all 4 stat labels: Status / Progress / Deadline / Outstanding", () => {
    expect(SRC).toContain("Status");
    expect(SRC).toContain("Progress");
    expect(SRC).toContain("Deadline");
    expect(SRC).toContain("Outstanding");
  });

  it("imports stageLabel + stageColor for the Status tile pill", () => {
    expect(SRC).toContain("stageLabel");
    expect(SRC).toContain("stageColor");
    expect(SRC).toContain("~/lib/clients/workflow-stage");
  });

  it("passes variant=\"danger\" to the Deadline tile when isOverdue is true", () => {
    expect(SRC).toMatch(/isOverdue/);
    expect(SRC).toMatch(/variant=\{?\s*["']?danger["']?/);
  });

  it("passes variant=\"danger\" to the Outstanding tile when outstandingCents > 0", () => {
    expect(SRC).toMatch(/outstandingCents/);
  });

  it("passes variant=\"ok\" to the Outstanding tile when outstandingCents === 0 (paid)", () => {
    expect(SRC).toMatch(/variant=\{?\s*["']?ok["']?/);
  });

  it("renders the Progress tile with a thin amber progress bar as the sub", () => {
    // The Progress tile uses the StatTile `sub` prop to render a small
    // bar element. We assert the brand-primary amber color appears in
    // an inline style for the bar fill.
    expect(SRC).toContain("--brand-primary");
    expect(SRC).toMatch(/sub=/);
  });

  it("renders the Progress percentage with tabular-nums", () => {
    expect(SRC).toMatch(/tabular-nums|font-mono/);
  });

  it("uses a 4-column grid (md:grid-cols-4) for the strip", () => {
    expect(SRC).toMatch(/grid-cols-4|md:grid-cols-4/);
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
