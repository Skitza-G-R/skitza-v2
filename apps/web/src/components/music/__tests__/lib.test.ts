import { describe, expect, it } from "vitest";

// New helpers added in the polish pass — pure functions used by the
// library cards, project page, and tracklists. Test-first: every
// behavior below was specced in the design critique before the helper
// existed; if the helper changes shape, these tests pin the contract.

import {
  coverPattern,
  fmtCount,
  formatProjectFooter,
} from "../lib";

// ─── fmtCount ────────────────────────────────────────────────────────
//
// Replaces the em-dash "—" placeholder per the impeccable rule "no em
// dashes." Returns an empty string for zero/missing — the call site
// reserves the column width via `min-width` so empty cells still align.

describe("fmtCount — counts in tabular columns", () => {
  it("returns empty string for 0 (no em-dash placeholder)", () => {
    expect(fmtCount(0)).toBe("");
  });

  it("returns empty string for null", () => {
    expect(fmtCount(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(fmtCount(undefined)).toBe("");
  });

  it("returns the number as a string for positive integers", () => {
    expect(fmtCount(1)).toBe("1");
    expect(fmtCount(42)).toBe("42");
    expect(fmtCount(1000)).toBe("1000");
  });

  it("never returns an em-dash, en-dash, or hyphen", () => {
    // Defensive: the entire reason this helper exists is to drop the
    // dash-as-placeholder pattern. If anyone ever changes the
    // implementation to "—" or "-", this test catches it.
    for (const n of [0, null, undefined, 5, 100]) {
      const out = fmtCount(n);
      expect(out).not.toContain("—");
      expect(out).not.toContain("–");
      expect(out).not.toContain("-");
    }
  });
});

// ─── formatProjectFooter ─────────────────────────────────────────────
//
// Project page footer copy: previously a static "N tracks · duration".
// Now also surfaces "Created <date>" + "Last upload <relative>" so the
// row is worth reading. Pure function; takes ISO strings + a clock.

describe("formatProjectFooter — meta line copy", () => {
  // A fixed clock so "yesterday" / "today" don't drift across CI runs.
  const NOW = new Date("2026-05-15T12:00:00Z").getTime();

  it("renders both 'Created' and 'Last upload' when both present", () => {
    const out = formatProjectFooter({
      createdAtIso: "2026-04-22T10:00:00Z",
      lastUploadIso: "2026-05-14T09:00:00Z",
      now: NOW,
    });
    expect(out).toContain("Created Apr 22");
    expect(out).toContain("Last upload yesterday");
    expect(out).toContain(" · ");
  });

  it("uses 'today' when last upload is the same day", () => {
    const out = formatProjectFooter({
      createdAtIso: "2026-04-22T10:00:00Z",
      lastUploadIso: "2026-05-15T08:00:00Z",
      now: NOW,
    });
    expect(out).toContain("Last upload today");
  });

  it("falls back to 'No uploads yet' when lastUploadIso is null", () => {
    const out = formatProjectFooter({
      createdAtIso: "2026-04-22T10:00:00Z",
      lastUploadIso: null,
      now: NOW,
    });
    expect(out).toContain("Created Apr 22");
    expect(out).toContain("No uploads yet");
  });

  it("renders only the upload line when createdAtIso is null", () => {
    const out = formatProjectFooter({
      createdAtIso: null,
      lastUploadIso: "2026-05-14T09:00:00Z",
      now: NOW,
    });
    expect(out).not.toContain("Created");
    expect(out).toContain("Last upload yesterday");
  });

  it("renders empty when both are null (graceful)", () => {
    const out = formatProjectFooter({
      createdAtIso: null,
      lastUploadIso: null,
      now: NOW,
    });
    expect(out).toBe("");
  });

  it("formats older dates as 'X days ago' before falling back to absolute", () => {
    const out = formatProjectFooter({
      createdAtIso: "2026-04-22T10:00:00Z",
      lastUploadIso: "2026-05-12T09:00:00Z",
      now: NOW,
    });
    expect(out).toContain("3 days ago");
  });

  it("uses absolute date for uploads older than a week", () => {
    const out = formatProjectFooter({
      createdAtIso: "2026-04-22T10:00:00Z",
      lastUploadIso: "2026-04-30T09:00:00Z",
      now: NOW,
    });
    expect(out).toMatch(/Last upload (Apr 30|Apr 29)/);
  });
});

// ─── coverPattern ────────────────────────────────────────────────────
//
// The original pattern was always 5 concentric circles; every project
// looked like the same topographic ring silhouette in different
// colors. The new generator picks 3, 5, or 7 rings deterministically
// from the seed AND varies their offsets/radii. Pure function — same
// seed always produces the same pattern.

describe("coverPattern — generative ring shapes per seed", () => {
  it("is deterministic: same seed produces identical output", () => {
    const a = coverPattern("seed-uuid-1");
    const b = coverPattern("seed-uuid-1");
    expect(a).toEqual(b);
  });

  it("produces different outputs for different seeds", () => {
    const a = coverPattern("seed-uuid-1");
    const b = coverPattern("seed-uuid-2");
    expect(a).not.toEqual(b);
  });

  it("varies ring count across the 3/5/7 set (not always 5)", () => {
    // Sample 60 distinct seeds. With three possible counts and a
    // hash-based picker, all three counts should appear in 60 samples
    // unless the picker is broken.
    const counts = new Set<number>();
    for (let i = 0; i < 60; i++) {
      counts.add(coverPattern(`seed-${String(i)}`).length);
    }
    expect(counts.has(3)).toBe(true);
    expect(counts.has(5)).toBe(true);
    expect(counts.has(7)).toBe(true);
    // Defensive: ONLY those three counts should appear.
    for (const c of counts) {
      expect([3, 5, 7]).toContain(c);
    }
  });

  it("each ring has cx/cy/r within a 64-unit canvas", () => {
    // The cover SVG uses viewBox=0 0 64 64. Ensure no ring is positioned
    // off-canvas (which would render invisibly).
    for (let i = 0; i < 30; i++) {
      const rings = coverPattern(`seed-${String(i)}`);
      for (const r of rings) {
        expect(r.cx).toBeGreaterThanOrEqual(0);
        expect(r.cx).toBeLessThanOrEqual(64);
        expect(r.cy).toBeGreaterThanOrEqual(0);
        expect(r.cy).toBeLessThanOrEqual(64);
        expect(r.r).toBeGreaterThan(0);
      }
    }
  });

  it("varies ring radii within a single pattern (not all the same)", () => {
    // If every ring in a pattern has the same radius, the pattern looks
    // like a bullseye — boring. Validate that at least some patterns
    // have varied radii by checking a sample.
    let foundVaried = 0;
    for (let i = 0; i < 30; i++) {
      const radii = coverPattern(`seed-${String(i)}`).map((r) => r.r);
      const unique = new Set(radii);
      if (unique.size > 1) foundVaried++;
    }
    // Most patterns should have varied radii.
    expect(foundVaried).toBeGreaterThan(20);
  });
});
