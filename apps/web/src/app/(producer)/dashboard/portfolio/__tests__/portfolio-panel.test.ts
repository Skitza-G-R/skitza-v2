import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  canReorder,
  formatDuration,
  LINK_CAP,
  PLATFORM_LABEL,
  seededBars,
  swapAdjacent,
  TRACK_CAP,
} from "../portfolio-panel";

// Portfolio redesign 2026-05-17 — panel unit + source-grep tests.
//
// Skitza vitest convention (per docs/plans/.../sidebar-share-chip):
// no jsdom, no @testing-library/react. We extract pure helpers from the
// panel and unit-test those; the JSX shell is validated via source-grep
// for structural invariants (Public badge, smart-paste pill, 2-col grid,
// reorder arrows, ban on a platform <select>, etc).

const here = dirname(fileURLToPath(import.meta.url));
const PANEL_PATH = join(here, "..", "portfolio-panel.tsx");
const PAGE_PATH = join(here, "..", "page.tsx");
const ACTIONS_PATH = join(here, "..", "actions.ts");
const panelSource = readFileSync(PANEL_PATH, "utf8");
const pageSource = readFileSync(PAGE_PATH, "utf8");
const actionsSource = readFileSync(ACTIONS_PATH, "utf8");

// ─── Caps ────────────────────────────────────────────────────────────

describe("caps", () => {
  it("TRACK_CAP is 5 (one-screen invariant)", () => {
    expect(TRACK_CAP).toBe(5);
  });

  it("LINK_CAP is 7 (one per supported platform)", () => {
    expect(LINK_CAP).toBe(7);
  });
});

// ─── PLATFORM_LABEL ─────────────────────────────────────────────────

describe("PLATFORM_LABEL", () => {
  it("has a label for each of the seven supported platforms", () => {
    expect(PLATFORM_LABEL.spotify).toBe("Spotify");
    expect(PLATFORM_LABEL.apple_music).toBe("Apple Music");
    expect(PLATFORM_LABEL.youtube).toBe("YouTube");
    expect(PLATFORM_LABEL.soundcloud).toBe("SoundCloud");
    expect(PLATFORM_LABEL.bandcamp).toBe("Bandcamp");
    expect(PLATFORM_LABEL.tidal).toBe("Tidal");
    expect(PLATFORM_LABEL.instagram_reels).toBe("Instagram");
  });
});

// ─── swapAdjacent ───────────────────────────────────────────────────

describe("swapAdjacent", () => {
  it("swaps index 1 up with index 0", () => {
    const arr = [{ id: "a" }, { id: "b" }, { id: "c" }] as const;
    expect(swapAdjacent(arr, 1, "up")).toEqual([
      { id: "b" },
      { id: "a" },
      { id: "c" },
    ]);
  });

  it("swaps index 1 down with index 2", () => {
    const arr = [{ id: "a" }, { id: "b" }, { id: "c" }] as const;
    expect(swapAdjacent(arr, 1, "down")).toEqual([
      { id: "a" },
      { id: "c" },
      { id: "b" },
    ]);
  });

  it("returns null when ▲ pressed on first row (no-op)", () => {
    const arr = [{ id: "a" }, { id: "b" }] as const;
    expect(swapAdjacent(arr, 0, "up")).toBeNull();
  });

  it("returns null when ▼ pressed on last row (no-op)", () => {
    const arr = [{ id: "a" }, { id: "b" }] as const;
    expect(swapAdjacent(arr, 1, "down")).toBeNull();
  });

  it("returns null on out-of-range index", () => {
    const arr = [{ id: "a" }] as const;
    expect(swapAdjacent(arr, -1, "up")).toBeNull();
    expect(swapAdjacent(arr, 1, "down")).toBeNull();
  });

  it("does not mutate the input array", () => {
    const arr = [{ id: "a" }, { id: "b" }];
    const next = swapAdjacent(arr, 1, "up");
    expect(arr.map((x) => x.id)).toEqual(["a", "b"]);
    expect(next?.map((x) => x.id)).toEqual(["b", "a"]);
  });
});

// ─── seededBars ─────────────────────────────────────────────────────

describe("seededBars", () => {
  it("returns the requested count of bars", () => {
    expect(seededBars("track-1", 40)).toHaveLength(40);
    expect(seededBars("track-1", 24)).toHaveLength(24);
  });

  it("each bar height falls in [0.35, 1.0]", () => {
    const bars = seededBars("track-xyz", 40);
    for (const h of bars) {
      expect(h).toBeGreaterThanOrEqual(0.35);
      expect(h).toBeLessThanOrEqual(1.0);
    }
  });

  it("is deterministic for the same id", () => {
    expect(seededBars("track-1", 40)).toEqual(seededBars("track-1", 40));
  });

  it("differs for different ids (pseudo-random spread)", () => {
    expect(seededBars("track-1", 40)).not.toEqual(seededBars("track-2", 40));
  });
});

// ─── formatDuration ─────────────────────────────────────────────────

describe("formatDuration", () => {
  it("formats whole-minute durations as m:00", () => {
    expect(formatDuration(120_000)).toBe("2:00");
  });

  it("zero-pads seconds under 10", () => {
    expect(formatDuration(65_000)).toBe("1:05");
  });

  it("handles long durations (over an hour reads as straight minutes)", () => {
    expect(formatDuration(3_900_000)).toBe("65:00");
  });

  it("returns empty string for null / zero / negative", () => {
    expect(formatDuration(null)).toBe("");
    expect(formatDuration(0)).toBe("");
    expect(formatDuration(-500)).toBe("");
  });

  it("rounds sub-second remainder", () => {
    expect(formatDuration(65_400)).toBe("1:05");
    expect(formatDuration(65_600)).toBe("1:06");
  });
});

// ─── canReorder ─────────────────────────────────────────────────────

describe("canReorder", () => {
  it("disables ▲ at the top (index 0)", () => {
    expect(canReorder("up", 0, 5)).toBe(false);
    expect(canReorder("up", 1, 5)).toBe(true);
  });

  it("disables ▼ at the bottom (index total-1)", () => {
    expect(canReorder("down", 4, 5)).toBe(false);
    expect(canReorder("down", 3, 5)).toBe(true);
  });

  it("handles a single-row list (both directions disabled)", () => {
    expect(canReorder("up", 0, 1)).toBe(false);
    expect(canReorder("down", 0, 1)).toBe(false);
  });
});

// ─── Panel source-grep: structural invariants ───────────────────────

describe("portfolio-panel.tsx — structural invariants", () => {
  it("uses the 2-col grid (38/62 split via fr units)", () => {
    expect(panelSource).toContain(
      "grid-cols-[minmax(0,38fr)_minmax(0,62fr)]",
    );
  });

  it("renders 'Featured tracks' and 'Social links' as section headings", () => {
    // JSX inlines the text on its own indented line, so allow whitespace
    // between the opening > and the heading text.
    expect(panelSource).toMatch(/>\s*Featured tracks\s*</);
    expect(panelSource).toMatch(/>\s*Social links\s*</);
  });

  it("smart-paste input has no platform <select>", () => {
    // The new social-links section drops the platform dropdown — server
    // detects the platform from the pasted URL.
    expect(panelSource).not.toMatch(/<select[\s>]/);
  });

  it("renders 'Public' badge text (Q1=B passive label)", () => {
    // The badge JSX renders bare "Public" inside a <span>. Whitespace-
    // flexible match so JSX indentation doesn't break this.
    expect(panelSource).toMatch(/>\s*Public\s*</);
  });

  it("does not render a public-sample toggle / switch", () => {
    expect(panelSource).not.toMatch(/togglePublicSample|isPublicSampleToggle/);
  });

  it("uses Move up / Move down aria-labels on reorder arrows", () => {
    expect(panelSource).toContain('aria-label="Move up"');
    expect(panelSource).toContain('aria-label="Move down"');
  });

  it("calls reorderPortfolioTracks and reorderExternalLinks (bulk reorder API)", () => {
    expect(panelSource).toContain("reorderPortfolioTracks");
    expect(panelSource).toContain("reorderExternalLinks");
  });

  it("calls addExternalLink with a URL-only payload (no platform/title)", () => {
    expect(panelSource).toMatch(/addExternalLink\(\{\s*url:/);
    // Platform/title should not be passed in the panel call anymore.
    expect(panelSource).not.toMatch(/addExternalLink\(\{[^}]*platform:/s);
    expect(panelSource).not.toMatch(/addExternalLink\(\{[^}]*title:/s);
  });

  it("renders the helper mono micro-labels for both sections", () => {
    expect(panelSource).toContain("PICK YOUR BEST. ARROWS REORCDER".replace("REORCDER", "REORDER"));
    expect(panelSource).toContain("PASTE THE URL. WE FIGURE OUT THE PLATFORM.");
  });

  it("renders the smart-paste placeholder copy", () => {
    expect(panelSource).toMatch(
      /Paste a Spotify, YouTube, SoundCloud link/,
    );
  });

  it("renders the LIMIT REACHED mono helper at cap (5/5)", () => {
    expect(panelSource).toContain("LIMIT REACHED");
  });

  it("uses CSS tokens from Skitza's real palette (no nonexistent tokens)", () => {
    // Guard against the documented memory: tokens like --surface-card,
    // --text-muted, --text-strong, --surface-hover, --brand-primary-on
    // don't exist and result in transparent/invisible UI.
    const codeOnly = panelSource
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(codeOnly).not.toMatch(/--surface-card\b/);
    expect(codeOnly).not.toMatch(/--text-muted\b/);
    expect(codeOnly).not.toMatch(/--text-strong\b/);
    expect(codeOnly).not.toMatch(/--surface-hover\b/);
    expect(codeOnly).not.toMatch(/--brand-primary-on\b/);
  });

  it("text rectangles use rounded-[var(--radius-lg)] or rounded-[1.25rem]; rounded-full reserved for actual squares (avatars, dots, play, icon-only)", () => {
    // No literal `rounded-md` on text containers — design system uses
    // the radius-lg token for those. (rounded-sm / rounded-full are
    // both allowed for their intended purposes.)
    expect(panelSource).not.toMatch(/className=["`][^"`]*\brounded-md\b/);
  });

  it("does not import framer-motion (CSS primitives only)", () => {
    expect(panelSource).not.toMatch(/from\s+["']framer-motion["']/);
  });

  it("opens the public profile link in a new tab from the page header", () => {
    // The View public page pill lives in page.tsx, not the panel.
    expect(pageSource).toMatch(/target=["']_blank["']/);
    expect(pageSource).toMatch(/rel=["']noreferrer noopener["']/);
    expect(pageSource).toContain("View public page");
  });
});

// ─── Page source-grep: header + slug fetch ──────────────────────────

describe("portfolio/page.tsx — slug + header pill", () => {
  it("calls producer.me() to fetch the slug for the public-page link", () => {
    expect(pageSource).toMatch(/caller\.producer\.me\(\)/);
  });

  it("composes publicProfileUrl as `/join/${me.slug}`", () => {
    expect(pageSource).toMatch(/\/join\/\$\{me\.slug\}/);
  });

  it("passes audioUrl and durationMs into PortfolioTrackRow rows", () => {
    expect(pageSource).toMatch(/audioUrl:\s*t\.audioUrl/);
    expect(pageSource).toMatch(/durationMs:\s*t\.durationMs/);
  });

  it("drops the per-link title from ExternalLinkRow mapping (no longer captured)", () => {
    expect(pageSource).not.toMatch(/title:\s*l\.title/);
  });
});

// ─── actions.ts: shape + reorder wrappers ───────────────────────────

describe("actions.ts — final URL-only + reorder wrappers", () => {
  it("addExternalLink input is URL-only", () => {
    expect(actionsSource).toMatch(
      /export async function addExternalLink\(input:\s*\{\s*url:\s*string;\s*\}\)/,
    );
  });

  it("exports reorderPortfolioTracks", () => {
    expect(actionsSource).toMatch(
      /export async function reorderPortfolioTracks/,
    );
  });

  it("exports reorderExternalLinks", () => {
    expect(actionsSource).toMatch(
      /export async function reorderExternalLinks/,
    );
  });

  it("reorder wrappers call the bulk { orderedIds } router mutations", () => {
    expect(actionsSource).toMatch(
      /portfolio\.reorder\(\{\s*orderedIds:\s*input\.orderedIds/,
    );
    expect(actionsSource).toMatch(
      /producerExternalLinks\.reorder\(\{\s*orderedIds:\s*input\.orderedIds/,
    );
  });
});
