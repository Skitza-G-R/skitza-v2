import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// SPA / prefetch invariants — catches regressions where someone reverts a
// <Link prefetch> back to <button onClick={() => router.push(...)}> or
// drops a useEffect prefetch. These are "source-text contains" assertions
// (the same pattern used by motion-primitives.test.ts and the
// "use client" boundary tests) — fast, no jsdom needed, and pin the
// concrete invariants that make the dashboard feel SPA-like.
//
// Why this matters: router.push() does NOT trigger Next.js's prefetch
// engine. Only <Link> auto-prefetches on viewport enter + hover, and
// router.prefetch() is the programmatic equivalent. A regression here
// silently breaks the "instant navigation" UX without breaking any
// other test.

const ROOT = join(__dirname, "..");

function readSrc(name: string): string {
  return readFileSync(join(ROOT, name), "utf8");
}

describe("Sidebar — uses <Link prefetch> for all nav (no router.push)", () => {
  const src = readSrc("shell.tsx");

  it("imports Link from next/link", () => {
    expect(src).toMatch(/from\s+["']next\/link["']/);
  });

  it("does NOT use router.push for nav (would skip prefetch)", () => {
    expect(src).not.toMatch(/router\.push\(/);
  });

  it("does NOT use useRouter (Sidebar should be hook-light, declarative)", () => {
    // Sidebar still uses usePathname for active-pill state, but no
    // useRouter anymore — that was only used for nav, which is now Link.
    expect(src).not.toMatch(/useRouter\b/);
  });

  it("renders <Link prefetch> for nav items", () => {
    // The NavLink helper component must use <Link prefetch ...>.
    expect(src).toMatch(/<Link[\s\S]*?prefetch/);
  });
});

describe("OverviewTab — prefetches the most-likely next routes on mount", () => {
  const src = readSrc("overview-tab.tsx");

  it("prefetches /dashboard/projects on mount", () => {
    expect(src).toMatch(/router\.prefetch\(["']\/dashboard\/projects["']\)/);
  });

  it("prefetches /dashboard/music on mount", () => {
    expect(src).toMatch(/router\.prefetch\(["']\/dashboard\/music["']\)/);
  });
});

describe("ClientsProjectsTab — pre-warms /new + project rows on hover", () => {
  const src = readSrc("clients-projects-tab.tsx");

  it("prefetches /dashboard/projects/new on mount", () => {
    expect(src).toMatch(
      /router\.prefetch\(["']\/dashboard\/projects\/new["']\)/,
    );
  });

  it("ProjectsTable accepts an onHover prop (hover-to-prefetch wiring)", () => {
    expect(src).toMatch(/onHover:\s*\(id:\s*string\)\s*=>\s*void/);
  });

  it("ProjectsTable parent passes router.prefetch through onHover", () => {
    expect(src).toMatch(
      /onHover=\{\(id\)\s*=>\s*router\.prefetch\(`\/dashboard\/projects\/\$\{id\}`\)\}/,
    );
  });

  it("project rows wire onMouseEnter → onHover (NOT just onClick)", () => {
    expect(src).toMatch(/onMouseEnter=\{\(\)\s*=>\s*onHover\(p\.id\)\}/);
  });
});

describe("MusicLibraryTab — prefetches song page on row hover", () => {
  const src = readSrc("music-library-tab.tsx");

  it("calls router.prefetch on track row mouseenter (TableView)", () => {
    expect(src).toMatch(
      /router\.prefetch\(`\/dashboard\/music\/\$\{t\.id\}`\)/,
    );
  });
});

describe("CommandPalette — prefetches highlighted result", () => {
  const src = readSrc("command-palette.tsx");

  it("defines urlForItem helper used by both fire + prefetch", () => {
    // Single source of truth for "where does this palette item nav?"
    expect(src).toMatch(/urlForItem/);
  });

  it("prefetches the currently-highlighted item via useEffect on sel", () => {
    expect(src).toMatch(/router\.prefetch\(urlForItem\(item\)\)/);
  });

  it("prefetches on mouseenter too (belt + suspenders)", () => {
    expect(src).toMatch(/onMouseEnter=\{\(\)\s*=>\s*\{[\s\S]*?prefetchItem/);
  });
});

describe("ProjectRoom — prefetches back-target on mount", () => {
  const src = readSrc("project-room.tsx");

  it("prefetches /dashboard/projects on mount (back-button target)", () => {
    expect(src).toMatch(/router\.prefetch\(["']\/dashboard\/projects["']\)/);
  });
});

describe("SongPage — prefetches back-target on mount", () => {
  const src = readSrc("song-page.tsx");

  it("prefetches /dashboard/music on mount (back-button + breadcrumb target)", () => {
    expect(src).toMatch(/router\.prefetch\(["']\/dashboard\/music["']\)/);
  });
});

describe("FloatingPlayer — prefetches the active track's song page", () => {
  const src = readSrc("floating-player.tsx");

  it("prefetches /dashboard/music/<currentId> when a track loads", () => {
    expect(src).toMatch(
      /router\.prefetch\(`\/dashboard\/music\/\$\{currentId\}`\)/,
    );
  });

  it("prefetch hook runs BEFORE the early-return for null state", () => {
    // React hooks order requires the prefetch effect to run on every
    // render, including renders where state.current is null. Putting
    // useEffect after `if (state.current === null) return null` would
    // change the hook order between renders — runtime crash.
    const effectIdx = src.search(/useEffect\(\(\)\s*=>\s*\{[\s\S]*?prefetch/);
    const earlyReturnIdx = src.search(/if\s*\(state\.current\s*===\s*null\)/);
    expect(effectIdx).toBeGreaterThan(0);
    expect(earlyReturnIdx).toBeGreaterThan(0);
    expect(effectIdx).toBeLessThan(earlyReturnIdx);
  });
});
