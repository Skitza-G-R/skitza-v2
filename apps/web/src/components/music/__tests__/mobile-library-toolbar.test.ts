import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "library-screen.tsx"), "utf8");

describe("mobile library toolbar", () => {
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
