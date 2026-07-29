import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parseMusicLibraryUrlState } from "../library-screen";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "library-screen.tsx"), "utf8");

describe("mobile library toolbar", () => {
  it("opens on Songs by default while preserving an explicit Projects mode", () => {
    expect(parseMusicLibraryUrlState("").mode).toBe("songs");
    expect(parseMusicLibraryUrlState("mode=projects").mode).toBe("projects");
    expect(source).toContain('replaceUrlState("mode", next, "songs")');
  });

  it("uses the same compact two-column phone grid for Projects and Songs", () => {
    const projectsGrid = source.slice(
      source.indexOf("function ProjectsGrid"),
      source.indexOf("function ProjectCard"),
    );
    const songsGrid = source.slice(
      source.indexOf("function SongsGrid"),
      source.indexOf("function SongCard"),
    );

    for (const grid of [projectsGrid, songsGrid]) {
      expect(grid).toContain(
        "grid grid-cols-2 gap-3.5 sm:grid-cols-[repeat(auto-fill,minmax(196px,1fr))] sm:gap-[22px]",
      );
    }
    expect(projectsGrid).not.toContain('role === "producer" ? "grid-cols-1"');
  });

  it("removes the inapplicable sort control instead of rendering it disabled", () => {
    expect(source).toMatch(
      /mode === "songs" && view === "table"\s*\?\s*\(\s*<SortDropdown/,
    );
    expect(source).not.toMatch(/<SortDropdown[\s\S]{0,180}disabled=/);
  });

  it("uses one accessible View menu on phones and preserves the desktop switch", () => {
    expect(source).toMatch(/<CompactViewMenu value=\{view\} onChange=\{updateView\}/);
    expect(source).toMatch(/aria-label="Library view"/);
    expect(source).toMatch(/md:hidden/);
    expect(source).toMatch(/hidden md:block[\s\S]{0,100}<ViewToggle/);
  });

  it("restores bounded view state from the URL without persisting catalog data", () => {
    expect(source).toContain("parseMusicLibraryUrlState");
    expect(source).toContain("window.history.replaceState");
    expect(source).toMatch(/params\.get\("search"\)[\s\S]{0,80}\.slice\(0, 120\)/);
    expect(source).not.toMatch(/localStorage|sessionStorage/);
  });

  it("uses truthful pressed-button groups instead of incomplete tab semantics", () => {
    expect(source).toContain('role="group"');
    expect(source).toContain("aria-pressed={active}");
    expect(source).toContain('role="region"');
    expect(source).not.toContain('role="tablist"');
    expect(source).not.toContain('role="tab"');
    expect(source).not.toContain('role="tabpanel"');
  });

  it("swipes the results surface through the existing URL-synced mode updater", () => {
    expect(source).toContain('import { useTabSwipe } from "~/components/native/use-tab-swipe"');
    expect(source).toMatch(
      /useTabSwipe\(\{\s*items:\s*MUSIC_LIBRARY_MODES,\s*value:\s*mode,\s*onChange:\s*updateMode,\s*\}\)/,
    );
    expect(source).toMatch(
      /id=\{RESULTS_PANEL_ID\}[\s\S]{0,180}data-tab-swipe-surface[\s\S]{0,100}\{\.\.\.modeSwipeHandlers\}/,
    );
    expect(source).toContain('className="[touch-action:pan-y_pinch-zoom]"');
    expect(source.match(/data-tab-swipe-surface/g)).toHaveLength(1);
  });

  it("makes the actual search input a 44px target", () => {
    expect(source).toMatch(/aria-label="Search music library"[\s\S]{0,180}className="h-11/);
  });

  it("makes each actual mobile dropdown a 44px target", () => {
    for (const label of ["Filter by artist", "Sort songs", "Library view"]) {
      expect(source).toMatch(
        new RegExp(`aria-label="${label}"[\\s\\S]{0,180}className="[^"]*min-h-11`),
      );
    }
  });
});
