import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SIDEBAR = readFileSync(join(here, "..", "producer-sidebar.tsx"), "utf8");
const GLOBALS = readFileSync(join(here, "..", "..", "..", "app", "globals.css"), "utf8");

describe("ProducerSidebar hover feedback", () => {
  it("marks the navigation row and icon for scoped hover motion", () => {
    expect(SIDEBAR).toContain("sk-sidebar-nav-item");
    expect(SIDEBAR).toContain("sk-sidebar-nav-icon");
  });

  it("brightens hovered rows while keeping the active row stronger", () => {
    expect(GLOBALS).toMatch(/\.sk-sidebar-nav-item:hover\s*\{[^}]*background/s);
    expect(GLOBALS).toMatch(
      /\.sk-sidebar-nav-item\[aria-current="page"\]:hover\s*\{[^}]*background/s,
    );
  });

  it("removes hover transforms for reduced-motion users", () => {
    const reducedMotion = GLOBALS.match(
      /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n {2}\}/,
    )?.[0];

    expect(reducedMotion).toContain(".sk-sidebar-nav-item");
    expect(reducedMotion).toContain(".sk-sidebar-nav-icon");
    expect(reducedMotion).toMatch(/\.sk-sidebar-nav-item:hover\s*\{[^}]*transform:\s*none/s);
  });
});
