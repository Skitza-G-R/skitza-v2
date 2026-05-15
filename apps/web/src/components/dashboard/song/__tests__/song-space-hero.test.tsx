import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "song-space-hero.tsx"), "utf-8");

describe("SongSpaceHero — dark hero band for the Song Space", () => {
  it("exports a SongSpaceHero component (function)", () => {
    expect(SRC).toMatch(/export function SongSpaceHero/);
  });

  it("is a client component (HeroCTA wires onClick)", () => {
    expect(SRC).toMatch(/^["']use client["']/);
  });

  it("imports heroBg + GradientToken for the dark gradient band", () => {
    expect(SRC).toContain("heroBg");
    expect(SRC).toContain("~/lib/clients/hero-bg");
    expect(SRC).toContain("GradientToken");
  });

  it("uses HeroCTA for both Play latest + Upload new version actions", () => {
    expect(SRC).toContain("HeroCTA");
    expect(SRC).toContain("~/components/dashboard/common/hero-cta");
    expect(SRC).toMatch(/variant=["']play["']/);
    expect(SRC).toMatch(/variant=["']upload["']/);
  });

  it("renders 'Play latest' label on the play HeroCTA", () => {
    expect(SRC).toMatch(/Play\s*latest/);
  });

  it("renders 'Upload new version' label on the upload HeroCTA", () => {
    expect(SRC).toMatch(/Upload\s*new\s*version/);
  });

  it("renders the song title in an h1 with the font-syne family", () => {
    expect(SRC).toMatch(/<h1[^>]*font-syne/);
  });

  it("switches the eyebrow between SONG and SINGLE based on mode", () => {
    expect(SRC).toContain('"SONG"');
    expect(SRC).toContain('"SINGLE"');
    expect(SRC).toContain('mode === "single"');
  });

  it("renders the stage label uppercased in the eyebrow row", () => {
    expect(SRC).toContain("stageLabel");
    expect(SRC).toContain("~/lib/clients/workflow-stage");
    expect(SRC).toMatch(/toUpperCase\(\)/);
  });

  it("renders the album-mode meta with 'from <ProjectName>'", () => {
    // album mode meta line starts with `from <ProjectName>`
    expect(SRC).toMatch(/from\b/);
    expect(SRC).toContain("project.name");
  });

  it("renders the single-mode meta with the client name (no 'from <Project>' prefix)", () => {
    expect(SRC).toContain("client.name");
  });

  it("renders the current version + note count + duration in the meta line", () => {
    expect(SRC).toContain("song.currentVersion");
    expect(SRC).toContain("song.noteCount");
    expect(SRC).toContain("song.durationMs");
  });

  it("wires the Upload HeroCTA to onUploadNewVersion (Phase 4) with a disabled fallback", () => {
    // Branch on onUploadNewVersion: live → onClick; missing → disabled.
    expect(SRC).toMatch(/onUploadNewVersion\?:/);
    expect(SRC).toMatch(
      /HeroCTA[\s\S]*?variant=["']upload["'][\s\S]*?onClick=\{onUploadNewVersion\}/,
    );
    expect(SRC).toMatch(
      /HeroCTA[\s\S]*?variant=["']upload["'][\s\S]*?disabled/,
    );
  });

  it("places the dark hero background via inline style with heroBg(token)", () => {
    expect(SRC).toMatch(/style=\{\{[^}]*background:[^}]*heroBg/);
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
