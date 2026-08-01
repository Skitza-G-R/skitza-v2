import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "album-space.tsx"), "utf-8");

describe("AlbumSpace — compact four-tab workspace", () => {
  it("exports an AlbumSpace component (function)", () => {
    expect(SRC).toMatch(/export function AlbumSpace/);
  });

  it("is a client component (owns active-tab state)", () => {
    expect(SRC).toMatch(/^["']use client["']/);
  });

  it("uses the compact header and removes the large hero/stat strip", () => {
    expect(SRC).toContain("ProjectCompactHeader");
    expect(SRC).toContain("AlbumTabs");
    expect(SRC).not.toContain("AlbumHero");
    expect(SRC).not.toContain("AlbumStatStrip");
  });

  it("imports the four locked workspace panels", () => {
    expect(SRC).toContain("SongsTab");
    expect(SRC).toContain("PaymentsTab");
    expect(SRC).toContain("StudioLogTab");
    expect(SRC).toContain("DetailsTab");
    expect(SRC).not.toContain("FilesTab");
  });

  it("keeps the Songs panel compact without a second inline song workspace", () => {
    expect(SRC).not.toContain("ProjectSongWorkspace");
    expect(SRC).not.toContain("selectedSongWorkspace");
    expect(SRC).not.toContain("SongTabs");
    expect(SRC).not.toContain("SongSpaceStatStrip");
    expect(SRC).toContain("ProjectSongUploadController");
    expect(SRC).toContain("selectedSongUpload");
  });

  it("uses useState for the active tab", () => {
    expect(SRC).toContain("useState");
  });

  it("defaults the active tab to 'songs'", () => {
    expect(SRC).toMatch(/useState[^(]*\(\s*["']songs["']/);
  });

  it("renders each tab panel conditionally based on active tab", () => {
    expect(SRC).toMatch(/active\s*===\s*["']songs["']/);
    expect(SRC).toMatch(/active\s*===\s*["']payments["']/);
    expect(SRC).toMatch(/active\s*===\s*["']log["']/);
    expect(SRC).toMatch(/active\s*===\s*["']details["']/);
    expect(SRC).not.toMatch(/active\s*===\s*["']files["']/);
  });

  it("swipes the stable direct panel through the locked local tab order", () => {
    expect(SRC).toMatch(
      /ALBUM_TAB_ORDER[\s\S]*?["']songs["'][\s\S]*?["']payments["'][\s\S]*?["']log["'][\s\S]*?["']details["']/,
    );
    expect(SRC).toContain("useTabSwipe");
    expect(SRC).toContain("onChange: setActive");
    expect(SRC).toContain('className="[touch-action:pan-y_pinch-zoom]"');
    expect(SRC).toMatch(
      /data-tab-swipe-surface[\s\S]*?\{\.\.\.tabSwipeHandlers\}[\s\S]*?<div data-tab-swipe-panel>[\s\S]*?active\s*===\s*["']songs["'][\s\S]*?active\s*===\s*["']payments["'][\s\S]*?active\s*===\s*["']log["'][\s\S]*?active\s*===\s*["']details["']/,
    );
  });

  it("forwards project, tracks, payments, and studioLog to their panels", () => {
    expect(SRC).toContain("project");
    expect(SRC).toContain("tracks");
    expect(SRC).toContain("payments");
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

  it("wires the header quick action for active projects", () => {
    expect(SRC).toContain("const canAddSong = projectActive");
    expect(SRC).toContain("canAddSong={canAddSong}");
    expect(SRC).toMatch(/<ProjectCompactHeader[\s\S]*?onAddSong=\{\(\) =>/);
  });

  it("explains that Add Song is contextual to an active Project", () => {
    expect(SRC).toContain("Add a Song while this Project is active.");
    expect(SRC).toContain("blockedReason={newWorkBlockedReason}");
  });

  it("opens contextual file-first Add Song without asking for a purchase", () => {
    expect(SRC).toContain("UploadTrackModal");
    expect(SRC).toMatch(/mode=["']new-song["']/);
    expect(SRC).toContain("projectId={project.id}");
    expect(SRC).not.toContain("purchaseId=");
    expect(SRC).not.toContain("emptySlots=");
  });

  it("keeps the sticky tab rail outside the moving swipe panel", () => {
    const railAt = SRC.indexOf("sticky top-0 z-30");
    const surfaceAt = SRC.indexOf("data-tab-swipe-surface");

    expect(railAt).toBeGreaterThan(-1);
    expect(SRC).toContain("lg:top-16");
    expect(surfaceAt).toBeGreaterThan(railAt);
  });

  it("routes the conditional payment alert to Payments", () => {
    expect(SRC).toMatch(/onOpenPayments=\{\(\) =>[\s\S]*?setActive\(["']payments["']\)/);
  });

  it("omits hero playback and the stopped Add Session behavior", () => {
    expect(SRC).not.toContain("playLatest");
    expect(SRC).not.toContain("playerPlay");
    expect(SRC).not.toContain("Add Session");
    expect(SRC).not.toContain("/artist/book");
  });
});
