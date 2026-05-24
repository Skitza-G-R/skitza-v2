import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Artist-side wrapper tests. Shared rendering lives in `app-topbar.tsx`
// (pinned by app-topbar.test.tsx); this file pins the artist-specific
// configuration: section labels (Home / Music / Book / Store /
// Settings), artist search placeholder, and the absence of an
// onSearchClick handler (the artist palette ships in a separate task,
// per SK-31 — visual parity now, behavior later).

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "artist-topbar.tsx"), "utf-8");

describe("ArtistTopBar (artist wrapper)", () => {
  it("is a client component", () => {
    expect(SRC).toMatch(/^"use client";/);
  });

  it("exports an ArtistTopBar component (function)", () => {
    expect(SRC).toMatch(/export function ArtistTopBar/);
  });

  it("delegates rendering to the shared AppTopBar", () => {
    expect(SRC).toMatch(/from\s+["']\.\/app-topbar["']/);
    expect(SRC).toMatch(/<AppTopBar/);
  });

  it("maps each artist route to its label", () => {
    expect(SRC).toMatch(/"\/artist":\s*"Home"/);
    expect(SRC).toMatch(/"\/artist\/music":\s*"Music"/);
    expect(SRC).toMatch(/"\/artist\/book":\s*"Book"/);
    expect(SRC).toMatch(/"\/artist\/store":\s*"Store"/);
    expect(SRC).toMatch(/"\/artist\/settings":\s*"Settings"/);
  });

  it("uses the artist-appropriate search placeholder", () => {
    expect(SRC).toContain("Search your music, sessions, store");
  });

  it("does NOT wire onSearchClick (the artist palette is a later task)", () => {
    // Visual parity with producer now; popup wiring comes in a
    // separate Linear issue. If a future PR wires a palette here,
    // remove this test along with the change.
    expect(SRC).not.toMatch(/onSearchClick=/);
    expect(SRC).not.toContain("skitza:open-palette");
    expect(SRC).not.toContain("dispatchEvent");
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
