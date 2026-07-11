import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Source-grep tests for the shared AppTopBar — the dumb component
// rendered by BOTH the producer DashboardTopBar wrapper and the
// artist ArtistTopBar wrapper. Pins the structural slots, sticky
// behavior, and scroll-aware separation that every consumer relies
// on.

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "app-topbar.tsx"), "utf-8");

describe("AppTopBar (shared)", () => {
  it("is a client component that derives the section from usePathname", () => {
    expect(SRC).toMatch(/^"use client";/);
    expect(SRC).toContain("usePathname");
  });

  it("exports an AppTopBar component (function) with typed props", () => {
    expect(SRC).toMatch(/export function AppTopBar/);
    expect(SRC).toMatch(/export interface AppTopBarProps/);
  });

  it("accepts sections + fallback so each side can configure its own labels", () => {
    // The label map is no longer hardcoded — producer + artist
    // wrappers each pass their own `sections` plus a `fallback` for
    // unknown pathnames. The shared component just walks the URL
    // until it finds a known prefix.
    expect(SRC).toMatch(/sections:\s*Readonly<Record<string, string>>/);
    expect(SRC).toMatch(/fallback:\s*Section/);
  });

  it("walks the path up to find the closest known section (deep pages)", () => {
    // /dashboard/clients-projects/clients/[id] → "Clients & Projects".
    // /artist/music/[songId] → "Music". Same logic for both sides.
    expect(SRC).toMatch(/deriveSectionLabel/);
    expect(SRC).toMatch(/lastIndexOf\(["']\/["']\)/);
  });

  it("renders the section label at every width via <Breadcrumb />", () => {
    // Single source of truth for in-page navigation. Deep pages
    // append crumbs through `useTopBarBreadcrumb`; the section root
    // itself becomes a clickable Link when extras exist (one-click
    // return to the list). Since SK-53 (mobile audit) the label slot
    // is visible at EVERY width — on phones the search pill is gone,
    // so the label is what anchors the slim chrome strip.
    expect(SRC).toMatch(/data-testid="topbar-section-label"\s*\n?\s*className="min-w-0/);
    expect(SRC).toContain("Breadcrumb");
    expect(SRC).toContain("useTopBarBreadcrumb");
    expect(SRC).toMatch(/<Breadcrumb\s+items=\{items\}/);
  });

  it("hides the search trigger below lg (mobile chrome = label + bell)", () => {
    // SK-53: a ⌘K search pill is dead weight on a phone — it ate the
    // whole strip and the shortcut hint means nothing without a
    // keyboard. Desktop (lg+) keeps the pill exactly as before. The
    // artist side mounts this bar desktop-only, so the change is
    // producer-mobile by construction.
    expect(SRC).toMatch(
      /data-testid="topbar-search-trigger"[\s\S]{0,800}className=\{[\s\S]{0,800}lg:inline-flex/,
    );
  });

  it("renders a search trigger that delegates to onSearchClick", () => {
    // Producer wrapper passes a function that dispatches the command
    // palette open event; artist wrapper omits the prop today so the
    // button stays visible and identical-looking but is a no-op until
    // the artist palette ships.
    expect(SRC).toMatch(/data-testid="topbar-search-trigger"/);
    expect(SRC).toMatch(/onClick=\{onSearchClick\}/);
  });

  it("renders the search placeholder text via the searchPlaceholder prop", () => {
    expect(SRC).toMatch(/\{searchPlaceholder\}/);
  });

  it("displays the ⌘K keyboard hint inside the search trigger", () => {
    expect(SRC).toMatch(/<kbd[\s\S]+?⌘K/);
  });

  it("renders the notifications bell with a data-testid", () => {
    expect(SRC).toMatch(/data-testid="topbar-bell"/);
  });

  it("shows an unread dot only when unreadCount > 0 (no false alarm at zero)", () => {
    expect(SRC).toMatch(/unreadCount\s*>\s*0/);
    expect(SRC).toMatch(/aria-label=[^>]*unread/);
  });

  it("requires an explicit producer or artist chrome variant", () => {
    expect(SRC).toContain('export type AppTopBarVariant = "producer" | "artist"');
    expect(SRC).toMatch(/variant:\s*AppTopBarVariant/);
    expect(SRC).toContain('variant === "producer"');
    expect(SRC).toContain("data-variant={variant}");
  });

  it("uses an opaque sticky 64px control strip for producers", () => {
    expect(SRC).toMatch(/sticky[\s\S]{0,40}top-0/);
    expect(SRC).toContain("bg-[rgb(var(--bg-elevated))]");
    expect(SRC).toContain("h-16");
    expect(SRC).toContain('variant === "producer"');
  });

  it("preserves the compact translucent pre-SK-76 artist geometry", () => {
    expect(SRC).toContain("backdrop-blur-[60px]");
    expect(SRC).toContain('WebkitBackdropFilter: "blur(60px)"');
    expect(SRC).toContain("px-3 py-1 sm:gap-4 sm:px-4");
    expect(SRC).toContain("h-8 w-8");
    expect(SRC).toContain("rounded-full border py-1.5");
  });

  it("fades in a soft separation shadow only once the page has scrolled (Emil-pass)", () => {
    expect(SRC).toContain("scrolled");
    expect(SRC).toMatch(/window\.scrollY/);
    expect(SRC).toMatch(/addEventListener\(["']scroll["']/);
    expect(SRC).toMatch(/data-scrolled/);
  });

  it("uses Skitza CSS tokens (no forbidden surface/text aliases)", () => {
    expect(SRC).not.toContain("--surface-card");
    expect(SRC).not.toContain("--surface-hover");
    expect(SRC).not.toContain("--text-muted");
    expect(SRC).not.toContain("--text-strong");
    expect(SRC).not.toContain("--brand-primary-on");
  });

  it("uses custom cubic-bezier easing (not plain ease-in-out)", () => {
    expect(SRC).toMatch(/cubic-bezier/);
  });

  it("provides press feedback (active:scale) on interactive elements", () => {
    expect(SRC).toMatch(/active:scale-\[/);
  });

  it("accepts a producer notification control while preserving the artist fallback", () => {
    expect(SRC).toMatch(/notificationControl\?:\s*ReactNode/);
    expect(SRC).toContain("notificationControl ??");
  });

  it("follows the no-pill rule for the producer search control", () => {
    expect(SRC).toContain("rounded-[var(--radius-md)]");
    expect(SRC).toContain("isProducer");
  });
});
