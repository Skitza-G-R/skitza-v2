import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Source-grep tests for the DashboardTopBar — the sticky chrome strip
// that lives at the top of every dashboard page (mockup-match against
// /Volumes/KINGSTON/Downloads/Clients Projects Room.html topbar row).
//
// Three slots, three behaviours we want pinned:
//   1. Section label derived from the URL pathname (no per-page wiring).
//   2. Search trigger opens the existing command palette via the
//      `skitza:open-palette` custom event — one search surface.
//   3. Notifications bell with an amber dot when unreadCount > 0.

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "dashboard-topbar.tsx"), "utf-8");

describe("DashboardTopBar", () => {
  it("is a client component (uses usePathname)", () => {
    expect(SRC).toMatch(/^"use client";/);
    expect(SRC).toContain("usePathname");
  });

  it("exports a DashboardTopBar component (function)", () => {
    expect(SRC).toMatch(/export function DashboardTopBar/);
  });

  it("maps each producer dashboard section to its label", () => {
    // The label table is the single source of truth for the top-left
    // section name. Add a route to the table → the topbar updates.
    expect(SRC).toMatch(/"\/dashboard":\s*"Overview"/);
    expect(SRC).toMatch(/"\/dashboard\/clients-projects":\s*"Clients & Projects"/);
    expect(SRC).toMatch(/"\/dashboard\/music":\s*"Music"/);
    expect(SRC).toMatch(/"\/dashboard\/calendar":\s*"Calendar"/);
    expect(SRC).toMatch(/"\/dashboard\/settings":\s*"Settings"/);
  });

  it("walks the path up to find the closest known section (deep pages)", () => {
    // For /dashboard/clients-projects/clients/[id] the label should
    // resolve to "Clients & Projects" — the deriveSectionLabel walks
    // up the path until it hits the section root.
    expect(SRC).toMatch(/deriveSectionLabel/);
    expect(SRC).toMatch(/lastIndexOf\(["']\/["']\)/);
  });

  it("renders the section label in a md+ slot", () => {
    // Hidden on the smallest screens where the search pill needs the
    // full row; section context is still readable via the URL there.
    expect(SRC).toMatch(/data-testid="topbar-section-label"/);
    expect(SRC).toMatch(/hidden[\s\S]{0,200}md:block/);
  });

  it("renders the section label inside a <Breadcrumb /> so deep pages can append crumbs", () => {
    // Single source of truth for in-page navigation — the in-page
    // Breadcrumb under each deep hero was removed in favour of a
    // context that pushes extras up to this single topbar surface.
    expect(SRC).toContain("Breadcrumb");
    expect(SRC).toContain("useTopBarBreadcrumb");
    expect(SRC).toMatch(/<Breadcrumb\s+items=\{items\}/);
  });

  it("renders a search trigger that dispatches skitza:open-palette", () => {
    // Reusing the existing CommandPaletteTrigger event keeps a single
    // source of truth — ⌘K and the visual trigger open the same UI.
    expect(SRC).toMatch(/data-testid="topbar-search-trigger"/);
    expect(SRC).toMatch(/skitza:open-palette/);
    expect(SRC).toMatch(/dispatchEvent/);
  });

  it("displays the ⌘K keyboard hint inside the search trigger", () => {
    // `<kbd …>⌘K</kbd>` with arbitrary attributes between. The
    // unbounded `\s\S]+?` matches across multi-line className/style
    // props without needing a magic char limit.
    expect(SRC).toMatch(/<kbd[\s\S]+?⌘K/);
  });

  it("renders the search placeholder text", () => {
    expect(SRC).toContain("Search projects, clients, songs");
  });

  it("renders the notifications bell with a data-testid", () => {
    expect(SRC).toMatch(/data-testid="topbar-bell"/);
  });

  it("shows an unread dot when unreadCount > 0", () => {
    // The dot is the at-a-glance signal — the actual drawer isn't
    // wired yet (kept as a follow-up PR). We pin the conditional so
    // the dot doesn't render when unread is zero (avoiding a false
    // "you have stuff to do" alarm).
    expect(SRC).toMatch(/unreadCount\s*>\s*0/);
    expect(SRC).toMatch(/aria-label=[^>]*unread/);
  });

  it("uses sticky positioning with a backdrop blur (premium frosted bar)", () => {
    expect(SRC).toMatch(/sticky[\s\S]{0,40}top-0/);
    expect(SRC).toMatch(/backdrop-blur/);
  });

  it("uses Skitza CSS tokens (no forbidden surface/text aliases)", () => {
    expect(SRC).not.toContain("--surface-card");
    expect(SRC).not.toContain("--surface-hover");
    expect(SRC).not.toContain("--text-muted");
    expect(SRC).not.toContain("--text-strong");
    expect(SRC).not.toContain("--brand-primary-on");
  });

  it("uses custom cubic-bezier easing (not plain ease-in-out)", () => {
    // emil-design-eng: built-in easings are too weak; strong custom
    // curves give UI motion the intentional snap it needs.
    expect(SRC).toMatch(/cubic-bezier/);
  });

  it("provides press feedback (active:scale) on interactive elements", () => {
    // The search trigger and bell both get a subtle scale-down on
    // active to confirm the press visually.
    expect(SRC).toMatch(/active:scale-\[/);
  });
});
