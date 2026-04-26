import { describe, expect, it } from "vitest";

import { __TEST_ONLY__, TRACK_COVER_PALETTE } from "../track-cover";

// TrackCover renders a deterministic linear-gradient cover keyed off
// trackId. Same input MUST produce the same output every render — no
// randomness, no Date.now, no per-mount drift. The cover is purely
// visual (no asset round-trip), so determinism IS the contract: a
// producer who saw a copper-rust gradient yesterday must still see it
// today. The hash + palette index + angle picks are tested directly
// against the underlying pure helpers (the exported __TEST_ONLY__ bag)
// so we don't need a DOM to assert "same input, same output."
//
// Repo convention (CLAUDE.md): no React Testing Library — vitest is
// node-env. We pin the deterministic math, not the rendered pixels.

const { hashStr, pickGradient } = __TEST_ONLY__;

describe("TrackCover hashStr", () => {
  it("returns 0 for empty string", () => {
    expect(hashStr("")).toBe(0);
  });

  it("returns the same hash for the same input every call", () => {
    const id = "track-abc-123";
    const a = hashStr(id);
    const b = hashStr(id);
    const c = hashStr(id);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("returns a non-negative integer", () => {
    for (const id of ["a", "track-1", "lll-very-long-uuid-style-id-9999"]) {
      const h = hashStr(id);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(h)).toBe(true);
    }
  });

  it("differs between distinct inputs (cheap collision smoke test)", () => {
    // 32-bit space, but we just want to assert the hash is at least
    // varying — collisions across these 4 specific strings would imply
    // the function is broken (always returning 0, etc.).
    const seen = new Set([
      hashStr("track-1"),
      hashStr("track-2"),
      hashStr("alpha"),
      hashStr("omega"),
    ]);
    expect(seen.size).toBe(4);
  });
});

describe("TrackCover palette", () => {
  it("has exactly 12 entries", () => {
    expect(TRACK_COVER_PALETTE).toHaveLength(12);
  });

  it("each entry is a [start, end] pair of 6-digit hex colors", () => {
    for (const pair of TRACK_COVER_PALETTE) {
      expect(pair).toHaveLength(2);
      expect(pair[0]).toMatch(/^#[0-9A-F]{6}$/i);
      expect(pair[1]).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });
});

describe("TrackCover pickGradient", () => {
  it("produces the same gradient for the same trackId", () => {
    const a = pickGradient("track-abc-123");
    const b = pickGradient("track-abc-123");
    expect(a.colors).toEqual(b.colors);
    expect(a.angle).toBe(b.angle);
  });

  it("returns colors from the palette and an angle in [0, 360)", () => {
    const g = pickGradient("track-xyz-987");
    expect(TRACK_COVER_PALETTE).toContainEqual(g.colors);
    expect(g.angle).toBeGreaterThanOrEqual(0);
    expect(g.angle).toBeLessThan(360);
    expect(Number.isInteger(g.angle)).toBe(true);
  });

  it("produces (potentially) different gradients for different trackIds", () => {
    // We don't strictly require all 4 to differ (palette is only 12
    // entries, so collisions exist) — but at least 2 of these distinct
    // inputs should land on different palette pairs, otherwise the
    // function is degenerate.
    const ids = [
      "track-001",
      "track-002",
      "track-003",
      "track-004",
      "track-005",
      "track-006",
    ];
    const distinctColorPairs = new Set(
      ids.map((id) => pickGradient(id).colors.join("→")),
    );
    expect(distinctColorPairs.size).toBeGreaterThanOrEqual(2);
  });

  it("returns a deterministic CSS gradient string via toCss helper", () => {
    const css = __TEST_ONLY__.toCss(pickGradient("track-stable"));
    expect(css).toMatch(
      /^linear-gradient\(\d+deg, #[0-9A-F]{6}, #[0-9A-F]{6}\)$/i,
    );
  });
});
