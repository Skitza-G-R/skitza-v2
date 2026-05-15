import { describe, it, expect } from "vitest";
import { NAV_ITEMS } from "../sidebar";

// Phase 2 — labels and G-leader shortcuts updated to the locked
// design system. Internal `id`s are unchanged so URL → ActiveKey
// derivation stays stable. Route mapping (Gili's brief Q3) drops the
// non-existent /dashboard/insights and surfaces seven items:
//   Overview / Clients & Projects / Music / Calendar / Store /
//   Portfolio / Settings.
//
// Task 19 of the storefront redesign (commit c688054) split the prior
// /dashboard/profile entry into two: the "Store" row (id `profile`
// kept intentionally so URL → ActiveKey lookups stay stable) now
// points at `/dashboard/store`, and a new "Portfolio" row was added
// at `/dashboard/portfolio` between Store and Settings.
//
// G-leader shortcuts mirror the locked design's `ShortcutsHelp`
// (notes/nav.jsx): G H (home/overview), G P (projects), G M (music),
// G C (calendar), G S (storefront), G B (portfolio book), G T (settings).

describe("Sidebar NAV_ITEMS", () => {
  it("contains exactly 7 top-level items", () => {
    expect(NAV_ITEMS).toHaveLength(7);
  });

  it("has the 7 canonical labels in order", () => {
    expect(NAV_ITEMS.map((i) => i.label)).toEqual([
      "Overview",
      "Clients & Projects",
      "Music",
      "Calendar",
      "Store",
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
    expect(NAV_ITEMS.find((i) => i.id === "portfolio")?.shortcut).toBe("G B");
    expect(NAV_ITEMS.find((i) => i.id === "setup")?.shortcut).toBe("G T");
  });
});
