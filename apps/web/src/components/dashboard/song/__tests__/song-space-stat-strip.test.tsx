import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(
  join(here, "..", "song-space-stat-strip.tsx"),
  "utf-8",
);

describe("SongSpaceStatStrip — 4 stat tiles for the Song Space hero", () => {
  it("exports a SongSpaceStatStrip component (function)", () => {
    expect(SRC).toMatch(/export function SongSpaceStatStrip/);
  });

  it("imports StatTile + stageLabel + stageColor for the Status tile", () => {
    expect(SRC).toContain("StatTile");
    expect(SRC).toContain("~/components/dashboard/common/stat-tile");
    expect(SRC).toContain("stageLabel");
    expect(SRC).toContain("stageColor");
    expect(SRC).toContain("~/lib/clients/workflow-stage");
  });

  it("renders all 4 stat tile labels: Status / Progress / Deadline / Versions", () => {
    expect(SRC).toMatch(/label=["']Status["']/);
    expect(SRC).toMatch(/label=["']Progress["']/);
    expect(SRC).toMatch(/label=["']Deadline["']/);
    expect(SRC).toMatch(/label=["']Versions["']/);
  });

  it("uses the danger variant on the Deadline tile when overdue", () => {
    expect(SRC).toMatch(/variant=["']danger["']/);
    expect(SRC).toContain("isOverdue");
  });

  it("renders the current version label inside the Versions tile", () => {
    expect(SRC).toContain("currentVersion");
  });

  it("renders the revision count sub-line (e.g. '+ N revisions')", () => {
    expect(SRC).toContain("revisionCount");
    expect(SRC).toMatch(/revision/);
  });

  it("renders the progress bar inside the Progress tile sub", () => {
    expect(SRC).toContain("--brand-primary");
    // The progress bar is a thin amber fill — matches AlbumStatStrip's
    // pattern.
    expect(SRC).toContain("progress");
  });

  it("uses a 4-column grid (md:grid-cols-4)", () => {
    expect(SRC).toMatch(/md:grid-cols-4/);
  });

  // I5 — the Status tile now hosts ChangeStageMenu when a trackId is
  // provided, replacing the separate "Change stage" row that used to
  // duplicate the Status tile's read-only pill above the strip.
  it("accepts an optional trackId prop for the interactive Status tile (I5)", () => {
    expect(SRC).toMatch(/trackId\?:\s*string/);
  });

  it("imports ChangeStageMenu so the Status tile can host the stage picker (I5)", () => {
    expect(SRC).toMatch(/ChangeStageMenu/);
    expect(SRC).toMatch(/from\s+["']\.\/change-stage-menu["']/);
  });

  it("renders ChangeStageMenu inside the Status tile when trackId is present (I5)", () => {
    expect(SRC).toMatch(/<ChangeStageMenu\s+trackId=\{trackId\}/);
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
