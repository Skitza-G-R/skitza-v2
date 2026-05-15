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

  it("renders a Tracklist header above the rows", () => {
    expect(SRC).toMatch(/Tracklist/);
  });

  it("renders an 'Add song' button in the panel header", () => {
    expect(SRC).toMatch(/Add\s*song/);
  });

  it("renders an empty state when the tracks list is empty", () => {
    // Empty-state copy literal lives in source so a localized swap is
    // a one-place change later.
    expect(SRC).toMatch(/No songs yet/);
  });

  it("renders a 1-based index on each TrackRow", () => {
    expect(SRC).toMatch(/index=\{[^}]*\+\s*1\s*\}/);
  });

  it("exposes onAddSong + onReorder callbacks", () => {
    expect(SRC).toContain("onAddSong");
    expect(SRC).toContain("onReorder");
  });

  it("wires draggable handlers via local state for optimistic reorder", () => {
    expect(SRC).toContain("useState");
    expect(SRC).toContain("onDragStart");
    expect(SRC).toContain("onDragOver");
    expect(SRC).toContain("onDrop");
  });

  it("imports + mounts UploadTrackModal so '+ Add song' opens the modal (Phase 4)", () => {
    expect(SRC).toContain("UploadTrackModal");
    expect(SRC).toContain("~/components/dashboard/song/upload-track-modal");
    // Modal mode is locked to "new-song" — the picker defaults to "+ New song"
    expect(SRC).toMatch(/mode=["']new-song["']/);
  });

  it("owns uploadOpen state locally so the modal lives next to the trigger", () => {
    expect(SRC).toMatch(/uploadOpen/);
    expect(SRC).toMatch(/setUploadOpen/);
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
