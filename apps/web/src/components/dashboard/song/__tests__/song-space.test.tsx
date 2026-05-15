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

  it("owns the UploadTrackModal state for both hero + drop-zone triggers (Phase 4)", () => {
    expect(SRC).toContain("UploadTrackModal");
    expect(SRC).toMatch(/uploadOpen/);
    // Locked mode + trackId so the song picker can't change songs.
    expect(SRC).toMatch(/mode=["']new-version["']/);
    expect(SRC).toMatch(/trackId=\{song\.id\}/);
  });

  // I5 — ChangeStageMenu now lives INSIDE the Status tile of the
  // SongSpaceStatStrip (passed via `trackId`), not as a standalone row
  // above the strip. We no longer import ChangeStageMenu directly in
  // SongSpace — instead trackId is forwarded down so the strip mounts
  // it inside the Status tile.
  it("threads song.id into SongSpaceStatStrip so the Status tile hosts the stage picker (I5)", () => {
    expect(SRC).toMatch(/SongSpaceStatStrip[\s\S]*?trackId=\{song\.id\}/);
  });

  it("no longer imports ChangeStageMenu directly (it lives inside the stat strip via trackId) (I5)", () => {
    expect(SRC).not.toMatch(/from\s+["']\.\/change-stage-menu["']/);
  });

  it("threads openUpload into both SongSpaceHero.onUploadNewVersion and VersionsTab.onAddVersion", () => {
    expect(SRC).toMatch(/onUploadNewVersion=\{openUpload\}/);
    expect(SRC).toMatch(/onAddVersion=\{openUpload\}/);
  });

  it("derives the default version label from song.revisionCount + 1", () => {
    expect(SRC).toMatch(/song\.revisionCount\s*\+\s*1/);
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
