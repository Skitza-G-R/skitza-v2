import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Pins that ArtistAppShell mounts the new ArtistTopBar inside a
// TopBarBreadcrumbProvider, guarded behind `hidden lg:block` so it
// only shows on computer screens (per Gili's SK-31 decision —
// "computer only"). Mobile keeps its existing ArtistMobileTopBar
// untouched.

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(
  join(here, "..", "artist-app-shell.tsx"),
  "utf-8",
);

describe("ArtistAppShell + ArtistTopBar wiring", () => {
  it("imports ArtistTopBar from the shared shell folder", () => {
    expect(SRC).toMatch(
      /import\s+\{\s*ArtistTopBar\s*\}\s+from\s+["']~\/components\/shell\/artist-topbar["']/,
    );
  });

  it("imports TopBarBreadcrumbProvider so deep pages can publish crumbs", () => {
    expect(SRC).toMatch(
      /import\s+\{\s*TopBarBreadcrumbProvider\s*\}\s+from\s+["']~\/components\/shell\/topbar-breadcrumb-context["']/,
    );
  });

  it("renders ArtistTopBar inside a TopBarBreadcrumbProvider", () => {
    const providerOpenIdx = SRC.indexOf("<TopBarBreadcrumbProvider");
    const topbarIdx = SRC.indexOf("<ArtistTopBar");
    const providerCloseIdx = SRC.indexOf("</TopBarBreadcrumbProvider>");
    expect(providerOpenIdx).toBeGreaterThan(-1);
    expect(topbarIdx).toBeGreaterThan(providerOpenIdx);
    expect(providerCloseIdx).toBeGreaterThan(topbarIdx);
  });

  it("wraps ArtistTopBar in a `hidden lg:block` slot (desktop only)", () => {
    // The visible chrome strip only appears on lg+ — Gili picked
    // "Computer only" in the SK-31 placement question. Mobile keeps
    // the existing ArtistMobileTopBar (wordmark + studio switcher +
    // UserButton), which the producer-style topbar does not contain.
    expect(SRC).toMatch(/hidden\s+lg:block[\s\S]{0,80}<ArtistTopBar/);
  });

  it("threads unreadCount into ArtistTopBar", () => {
    expect(SRC).toMatch(/<ArtistTopBar[\s\S]{0,80}unreadCount=\{unreadCount\}/);
  });

  it("keeps the existing ArtistMobileTopBar mounted (mobile chrome untouched)", () => {
    expect(SRC).toMatch(/<ArtistMobileTopBar/);
  });

  it("renders the topbar above <main> so it sits at the top of the column", () => {
    // Match the JSX element specifically (`<main className=`) so we
    // don't pick up the literal `<main>` text in the rationale
    // comment above.
    const topbarIdx = SRC.indexOf("<ArtistTopBar");
    const mainIdx = SRC.indexOf("<main className");
    expect(topbarIdx).toBeGreaterThan(-1);
    expect(mainIdx).toBeGreaterThan(topbarIdx);
  });
});
