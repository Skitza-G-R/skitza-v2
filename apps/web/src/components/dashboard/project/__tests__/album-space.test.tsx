import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "album-space.tsx"), "utf-8");

describe("AlbumSpace — composes hero + strip + tabs + active panel", () => {
  it("exports an AlbumSpace component (function)", () => {
    expect(SRC).toMatch(/export function AlbumSpace/);
  });

  it("is a client component (owns active-tab state)", () => {
    expect(SRC).toMatch(/^["']use client["']/);
  });

  it("imports AlbumHero + AlbumStatStrip + AlbumTabs", () => {
    expect(SRC).toContain("AlbumHero");
    expect(SRC).toContain("AlbumStatStrip");
    expect(SRC).toContain("AlbumTabs");
  });

  it("imports SongsTab + FilesTab + PaymentsTab + StudioLogTab", () => {
    expect(SRC).toContain("SongsTab");
    expect(SRC).toContain("FilesTab");
    expect(SRC).toContain("PaymentsTab");
    expect(SRC).toContain("StudioLogTab");
  });

  it("uses useState for the active tab", () => {
    expect(SRC).toContain("useState");
  });

  it("defaults the active tab to 'songs'", () => {
    expect(SRC).toMatch(/useState[^(]*\(\s*["']songs["']/);
  });

  it("renders each tab panel conditionally based on active tab", () => {
    // The body conditionally renders based on the active tab key.
    expect(SRC).toMatch(/active\s*===\s*["']songs["']/);
    expect(SRC).toMatch(/active\s*===\s*["']files["']/);
    expect(SRC).toMatch(/active\s*===\s*["']payments["']/);
    expect(SRC).toMatch(/active\s*===\s*["']log["']/);
  });

  it("forwards project + tracks + payments + studioLog props to the panels", () => {
    expect(SRC).toContain("project");
    expect(SRC).toContain("tracks");
    expect(SRC).toContain("payments");
    expect(SRC).toContain("studioLog");
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

  it("wires AlbumHero's onAddSong CTA (G1 design match — must not ship disabled)", () => {
    // Polish PR A G1: hero's "+ Add song" must receive a callback so
    // it renders as a primary pill instead of disabled "Coming soon".
    expect(SRC).toMatch(/<AlbumHero[\s\S]*?onAddSong=/);
  });

  it("opens UploadTrackModal for the hero's '+ Add song' action", () => {
    // The hero callback drives an UploadTrackModal mount; without
    // this the producer can never upload from the hero.
    expect(SRC).toMatch(/UploadTrackModal/);
    expect(SRC).toMatch(/mode=["']new-song["']/);
  });

  it("accepts a playLatest prop and threads onPlayLatest to AlbumHero when present", () => {
    // G1 second half — when page.tsx supplies a playable version, the
    // hero's "Play latest" CTA must wire through playerPlay.
    expect(SRC).toMatch(/playLatest/);
    expect(SRC).toMatch(/playerPlay/);
  });
});
