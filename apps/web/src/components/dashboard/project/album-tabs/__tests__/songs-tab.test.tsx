import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "songs-tab.tsx"), "utf-8");

describe("SongsTab — Songs panel for the album page", () => {
  it("exports a SongsTab component (function)", () => {
    expect(SRC).toMatch(/export function SongsTab/);
  });

  it("imports TrackRow for each tracklist row", () => {
    expect(SRC).toContain("TrackRow");
    expect(SRC).toContain("~/components/dashboard/project/track-row");
  });

  it("renders a level-two Songs heading above the rows", () => {
    expect(SRC).toMatch(/<h2[\s\S]*?>\s*Songs\s*<\/h2>/);
  });

  it("leaves the one generic Add Song action on the compact header + button", () => {
    expect(SRC).not.toContain("handleAddSong();");
    expect(SRC).toContain("Use the project + button");
  });

  it("renders an empty state when the tracks list is empty", () => {
    // Empty-state copy literal lives in source so a localized swap is
    // a one-place change later.
    expect(SRC).toMatch(/No songs yet/);
  });

  it("renders a 1-based index on each TrackRow", () => {
    expect(SRC).toMatch(/index=\{[^}]*\+\s*1\s*\}/);
  });

  it("opens songs in the existing player without a lower content slot", () => {
    expect(SRC).toContain("Open a song in the player");
    expect(SRC).not.toContain("selectedSongId");
    expect(SRC).not.toContain("selected={");
    expect(SRC).not.toContain("children");
  });

  it("exposes Add Song without an unpersisted reorder callback", () => {
    expect(SRC).not.toContain("onAddSong");
    expect(SRC).not.toContain("onReorder");
  });

  it("renders the server-provided order without drag handlers", () => {
    expect(SRC).toContain("tracks.map");
    expect(SRC).not.toContain("onDragStart");
    expect(SRC).not.toContain("onDragOver");
    expect(SRC).not.toContain("onDrop");
  });

  it("leaves the single Add Song action to the contextual Project header", () => {
    expect(SRC).not.toContain("UploadTrackModal");
    expect(SRC).not.toContain("~/components/dashboard/song/upload-track-modal");
    expect(SRC).not.toMatch(/mode=["']new-song["']/);
  });

  it("renders only durable Songs and never purchased empty spaces", () => {
    expect(SRC).not.toContain("emptySlots");
    expect(SRC).not.toContain("Purchased song space");
    expect(SRC).toContain("tracks.map");
  });

  it("sets role=tabpanel on the wrapping section", () => {
    expect(SRC).toContain('role="tabpanel"');
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
