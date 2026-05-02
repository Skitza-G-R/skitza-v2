import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Persistence-shell invariants — pins the architectural fix where
// DesignShell lives in a layout (so the Sidebar literally never
// unmounts during nav between sandbox tabs) instead of being remounted
// per page.
//
// Why this matters: a page-level <DesignShell> means each navigation
// tears down the entire chrome (sidebar, palette, floating player) and
// rebuilds it from scratch. Even with prefetch, the user sees a frame
// of "shell missing" → loading.tsx → new shell. That visual flash is
// what reads as "page reload" even though the network shows a soft
// RSC swap. Hoisting the shell into a layout means the Sidebar is
// rendered ONCE and the {children} slot swaps inside it — true SPA.
//
// The route group (sandbox) scopes this layout so onboarding/revenue
// (legacy non-design-test routes under /dashboard) stay unaffected.

const APP = join(__dirname, "..", "..", "..", "..");
const DASHBOARD = join(APP, "(app)", "dashboard");
const SANDBOX = join(DASHBOARD, "(sandbox)");

function pageSrc(rel: string): string {
  const path = join(SANDBOX, rel);
  return readFileSync(path, "utf8");
}

describe("(sandbox)/layout.tsx — owns the design-test shell", () => {
  it("the (sandbox)/layout.tsx file exists", () => {
    expect(existsSync(join(SANDBOX, "layout.tsx"))).toBe(true);
  });

  it("layout renders <DesignShell> (so the Sidebar persists across nav)", () => {
    const src = readFileSync(join(SANDBOX, "layout.tsx"), "utf8");
    expect(src).toMatch(/<DesignShell\b/);
  });

  it("layout fetches the shared producer + paletteData server-side once", () => {
    const src = readFileSync(join(SANDBOX, "layout.tsx"), "utf8");
    expect(src).toMatch(/producer\.me\(\)/);
    expect(src).toMatch(/buildPaletteData\(/);
  });

  it("layout authenticates and redirects unauth via Clerk", () => {
    const src = readFileSync(join(SANDBOX, "layout.tsx"), "utf8");
    expect(src).toMatch(/auth\(\)/);
    expect(src).toMatch(/redirect\(["']\/sign-in["']\)/);
  });
});

describe("Sandbox pages — DO NOT wrap in <DesignShell> (layout owns it)", () => {
  const pages = [
    "page.tsx",
    "projects/page.tsx",
    "projects/[id]/page.tsx",
    "music/page.tsx",
    "music/[trackId]/page.tsx",
    "booking/page.tsx",
    "store/page.tsx",
    "insights/page.tsx",
    "settings/page.tsx",
  ];

  for (const rel of pages) {
    it(`${rel} returns the tab body directly (no DesignShell wrap)`, () => {
      const src = pageSrc(rel);
      expect(src).not.toMatch(/<DesignShell\b/);
      // Also: should not import DesignShell — no point in the import
      // if it isn't being rendered.
      expect(src).not.toMatch(/import\s*{\s*DesignShell\s*}/);
    });
  }
});

describe("Loading state mirrors the layout (no fake sidebar — real one persists)", () => {
  it("(sandbox)/loading.tsx exists and renders ONLY the main-area skeleton", () => {
    const path = join(SANDBOX, "loading.tsx");
    expect(existsSync(path)).toBe(true);
    const src = readFileSync(path, "utf8");
    // The previous loading.tsx mocked a sidebar because the per-page
    // shell ALSO unmounted. Now the real Sidebar (in layout.tsx) stays
    // mounted, so the loading slot only fills the <main> area. No
    // <aside> placeholder needed.
    expect(src).not.toMatch(/<aside\b/);
  });
});
