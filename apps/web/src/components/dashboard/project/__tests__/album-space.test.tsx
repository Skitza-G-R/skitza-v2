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

  it("imports only the real creative-work panels", () => {
    expect(SRC).toContain("SongsTab");
    expect(SRC).toContain("StudioLogTab");
    expect(SRC).not.toContain("FilesTab");
    expect(SRC).not.toContain("PaymentsTab");
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
    expect(SRC).toMatch(/active\s*===\s*["']log["']/);
    expect(SRC).not.toMatch(/active\s*===\s*["']files["']/);
    expect(SRC).not.toMatch(/active\s*===\s*["']payments["']/);
  });

  it("forwards project + tracks + studioLog props to the panels", () => {
    expect(SRC).toContain("project");
    expect(SRC).toContain("tracks");
    expect(SRC).toContain("studioLog");
    expect(SRC).not.toContain("milestones");
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

  it("wires AlbumHero's Add Song CTA for active projects", () => {
    expect(SRC).toContain("const canAddSong = projectActive");
    expect(SRC).toMatch(/canAddSong[\s\S]*?onAddSong:\s*handleAddSong/);
    expect(SRC).toContain("canAddSong={canAddSong}");
  });

  it("explains why reopened work with only canceled purchases cannot add songs", () => {
    expect(SRC).toContain("New work requires an active purchase or accepted offer.");
    expect(SRC).toContain("uploadDisabledReason={newWorkBlockedReason}");
    expect(SRC).toContain("blockedReason={newWorkBlockedReason}");
  });

  it("routes Add Song through the purchased-space flow without opening upload", () => {
    expect(SRC).toContain("router.push(addSongHref)");
    expect(SRC).toContain("purchaseId=${encodeURIComponent(slot.purchaseId)}");
    expect(SRC).toContain("&lockProject=1");
    expect(SRC).not.toContain("UploadTrackModal");
    expect(SRC).not.toMatch(/mode=["']new-song["']/);
    expect(SRC).toContain("emptySlots={emptySlots}");
  });

  it("accepts a playLatest prop and threads onPlayLatest to AlbumHero when present", () => {
    // G1 second half — when page.tsx supplies a playable version, the
    // hero's "Play latest" CTA must wire through playerPlay.
    expect(SRC).toMatch(/playLatest/);
    expect(SRC).toMatch(/playerPlay/);
  });
});
