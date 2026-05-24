import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Producer-side wrapper tests. The shared shell rendering lives in
// `app-topbar.tsx` (see app-topbar.test.tsx for structural pins); this
// file pins the producer-specific configuration: section labels,
// search placeholder copy, and the click handler that opens the
// existing command palette via the `skitza:open-palette` event.

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "dashboard-topbar.tsx"), "utf-8");

describe("DashboardTopBar (producer wrapper)", () => {
  it("is a client component (needs window to dispatch the palette event)", () => {
    expect(SRC).toMatch(/^"use client";/);
  });

  it("exports a DashboardTopBar component (function)", () => {
    expect(SRC).toMatch(/export function DashboardTopBar/);
  });

  it("delegates rendering to the shared AppTopBar", () => {
    expect(SRC).toMatch(/from\s+["']\.\/app-topbar["']/);
    expect(SRC).toMatch(/<AppTopBar/);
  });

  it("maps each producer dashboard section to its label", () => {
    // The label table is the single source of truth for the top-left
    // section name on the producer side. Add a route to the table →
    // the topbar updates.
    expect(SRC).toMatch(/"\/dashboard":\s*"Overview"/);
    expect(SRC).toMatch(/"\/dashboard\/clients-projects":\s*"Clients & Projects"/);
    expect(SRC).toMatch(/"\/dashboard\/music":\s*"Music"/);
    expect(SRC).toMatch(/"\/dashboard\/calendar":\s*"Calendar"/);
    expect(SRC).toMatch(/"\/dashboard\/settings":\s*"Settings"/);
  });

  it("passes the producer search placeholder", () => {
    expect(SRC).toContain("Search projects, clients, songs");
  });

  it("dispatches skitza:open-palette when the search pill is clicked", () => {
    // Reusing the existing CommandPaletteTrigger event keeps a single
    // source of truth — ⌘K and the visual trigger open the same UI.
    expect(SRC).toMatch(/skitza:open-palette/);
    expect(SRC).toMatch(/dispatchEvent/);
    expect(SRC).toMatch(/onSearchClick=/);
  });

  it("threads unreadCount through to the shared topbar", () => {
    expect(SRC).toMatch(/unreadCount=\{unreadCount\}/);
  });

  it("uses no forbidden Skitza CSS tokens", () => {
    expect(SRC).not.toContain("--surface-card");
    expect(SRC).not.toContain("--surface-hover");
    expect(SRC).not.toContain("--text-muted");
    expect(SRC).not.toContain("--text-strong");
    expect(SRC).not.toContain("--brand-primary-on");
  });
});
