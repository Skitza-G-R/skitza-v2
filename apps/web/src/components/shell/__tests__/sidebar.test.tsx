import { describe, it, expect } from "vitest";
import { NAV_ITEMS } from "../sidebar";

// Phase 2 — labels and G-leader shortcuts updated to the locked
// design system. Internal `id`s are unchanged so URL → ActiveKey
// derivation stays stable. Route mapping (Gili's brief Q3) drops the
// non-existent /dashboard/insights.
//
// Sidebar history:
//   - 2026-05-15: Portfolio row removed from the rail (CLAUDE.md
//     called for 6 producer pages, file header promised 6).
//   - 2026-05-18 (PR #142): Portfolio re-introduced as the 7th rail
//     entry directly under Storefront. Gili's call as the product
//     owner; CLAUDE.md's surface count is now stale and will refresh
//     when the portfolio redesign promotes to prod.
//
// G-leader shortcuts mirror the locked design's `ShortcutsHelp`
// (notes/nav.jsx): G H (overview), G P (projects), G M (music),
// G C (calendar), G S (storefront), G F (portfolio), G T (settings).

describe("Sidebar NAV_ITEMS", () => {
  it("contains exactly 7 top-level items (Portfolio re-added 2026-05-18)", () => {
    expect(NAV_ITEMS).toHaveLength(7);
  });

  it("has the 7 canonical labels in order", () => {
    // 2026-05-16: "Store" was renamed to "Storefront" to match the
    // HTML mockup's locked sidebar nomenclature. The /dashboard/store
    // route is unchanged; only the visible label moved.
    // 2026-05-18: Portfolio re-introduced as the 7th entry directly
    // under Storefront.
    expect(NAV_ITEMS.map((i) => i.label)).toEqual([
      "Overview",
      "Clients & Projects",
      "Music",
      "Calendar",
      "Storefront",
      "Portfolio",
      "Settings",
    ]);
  });

  it("maps each item to its route", () => {
    expect(NAV_ITEMS.find((i) => i.id === "today")?.href).toBe("/dashboard");
    expect(NAV_ITEMS.find((i) => i.id === "clients-projects")?.href).toBe("/dashboard/clients-projects");
    expect(NAV_ITEMS.find((i) => i.id === "music")?.href).toBe("/dashboard/music");
    expect(NAV_ITEMS.find((i) => i.id === "calendar")?.href).toBe("/dashboard/calendar");
    expect(NAV_ITEMS.find((i) => i.id === "profile")?.href).toBe("/dashboard/store");
    expect(NAV_ITEMS.find((i) => i.id === "portfolio")?.href).toBe("/dashboard/portfolio");
    expect(NAV_ITEMS.find((i) => i.id === "setup")?.href).toBe("/dashboard/settings");
  });

  it("assigns a G-leader shortcut to each item matching the locked design", () => {
    expect(NAV_ITEMS.find((i) => i.id === "today")?.shortcut).toBe("G H");
    expect(NAV_ITEMS.find((i) => i.id === "clients-projects")?.shortcut).toBe("G P");
    expect(NAV_ITEMS.find((i) => i.id === "music")?.shortcut).toBe("G M");
    expect(NAV_ITEMS.find((i) => i.id === "calendar")?.shortcut).toBe("G C");
    expect(NAV_ITEMS.find((i) => i.id === "profile")?.shortcut).toBe("G S");
    expect(NAV_ITEMS.find((i) => i.id === "portfolio")?.shortcut).toBe("G F");
    expect(NAV_ITEMS.find((i) => i.id === "setup")?.shortcut).toBe("G T");
  });

  it("contains a Portfolio nav row directly under Storefront", () => {
    const idx = NAV_ITEMS.findIndex((i) => i.id === "portfolio");
    const prev = idx > 0 ? NAV_ITEMS[idx - 1] : undefined;
    expect(idx).toBeGreaterThan(-1);
    expect(prev?.id).toBe("profile");
  });
});

// ─── Insights placeholder + sidebar footer chip (mockup-match) ───
import { readFileSync as readSrc } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SIDEBAR_SRC = readSrc(
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "nav", "producer-sidebar.tsx"),
  "utf-8",
);

describe("ProducerSidebar — Insights placeholder + footer chip", () => {
  it("renders an InsightsPlaceholder between Portfolio and Settings", () => {
    // The placeholder is rendered conditionally inside the NAV_ITEMS
    // loop after the "portfolio" item — no /dashboard/insights route
    // exists yet, so it has to be a button (not a Link). Toast on
    // click signals "Coming soon" to the producer.
    // Moved from after "profile" → after "portfolio" on 2026-05-18 so
    // Storefront → Portfolio reads as a contiguous group.
    expect(SIDEBAR_SRC).toContain("InsightsPlaceholder");
    expect(SIDEBAR_SRC).toMatch(/item\.id\s*===\s*["']portfolio["'][\s\S]{0,200}InsightsPlaceholder/);
  });

  it("Insights placeholder is a button (not a Link) so it can't 404", () => {
    // Pin that the placeholder doesn't render as a <Link href=...> —
    // every Link would need a real route, which we don't have.
    expect(SIDEBAR_SRC).toMatch(/function InsightsPlaceholder[\s\S]{0,200}<button/);
    expect(SIDEBAR_SRC).not.toMatch(/function InsightsPlaceholder[\s\S]{0,200}<Link/);
  });

  it("Insights placeholder toasts 'coming soon' on click (no silent failure)", () => {
    expect(SIDEBAR_SRC).toMatch(/coming\s+soon/i);
    expect(SIDEBAR_SRC).toMatch(/useToast/);
  });

  it("accepts displayName + plan props on ProducerSidebar (footer chip data)", () => {
    expect(SIDEBAR_SRC).toMatch(/displayName\?:\s*string\s*\|\s*null/);
    expect(SIDEBAR_SRC).toMatch(/plan\?:\s*string/);
  });

  it("renders the footer chip with display name + plan label when expanded", () => {
    expect(SIDEBAR_SRC).toMatch(/data-testid="sidebar-footer-chip"/);
    expect(SIDEBAR_SRC).toContain("formatPlanLabel");
  });

  it("formatPlanLabel knows the Free / Pro / Studio / Team tiers", () => {
    expect(SIDEBAR_SRC).toContain('"Free plan"');
    expect(SIDEBAR_SRC).toContain('"Pro plan"');
    expect(SIDEBAR_SRC).toContain('"Studio plan"');
    expect(SIDEBAR_SRC).toContain('"Team plan"');
  });

  it("footer chip falls back to bare UserButton when displayName is null", () => {
    // The collapsed rail keeps just the avatar so the 64px column
    // doesn't overflow. Same fallback when displayName is missing.
    expect(SIDEBAR_SRC).toMatch(/!collapsed\s*&&\s*displayName\s*\?/);
  });
});
