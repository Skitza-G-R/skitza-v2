import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "versions-tab.tsx"), "utf-8");

describe("versions-tab — drop zone first + version list", () => {
  it("exports a VersionsTab component (function)", () => {
    expect(SRC).toMatch(/export function VersionsTab/);
  });

  it("imports AddVersionDropZone as the first row", () => {
    expect(SRC).toContain("AddVersionDropZone");
    expect(SRC).toContain("~/components/dashboard/song/add-version-drop-zone");
  });

  it("imports VersionRow for each version row", () => {
    expect(SRC).toContain("VersionRow");
    expect(SRC).toContain("~/components/dashboard/song/version-row");
  });

  it("renders an empty-state copy when there are no versions yet", () => {
    expect(SRC).toMatch(/No\s*versions\s*yet/);
  });

  it("maps versions newest-first (parent passes already-sorted list)", () => {
    // We assert the panel iterates over the `versions` prop directly
    // — no resort inside the component. The parent owns ordering.
    expect(SRC).toContain("versions");
    expect(SRC).toMatch(/versions\.map/);
  });

  it("renders the AddVersionDropZone BEFORE the VersionRow list", () => {
    // Source-order check — the dropzone JSX element occurs before the
    // VersionRow map call.
    const dropIdx = SRC.indexOf("<AddVersionDropZone");
    const rowMapIdx = SRC.indexOf("versions.map");
    expect(dropIdx).toBeGreaterThan(-1);
    expect(rowMapIdx).toBeGreaterThan(-1);
    expect(dropIdx).toBeLessThan(rowMapIdx);
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
