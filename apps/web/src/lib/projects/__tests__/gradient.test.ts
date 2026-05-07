import { describe, expect, it } from "vitest";

import { GRADIENT_KEYS, gradientForId, type GradientKey } from "../gradient";

// gradientForId() picks one of six warm-toned hero gradients for the
// Project Room based on a deterministic hash of the project id. The
// reference design uses these as the per-project background — like
// album artwork on Spotify — so a project always opens with the same
// color (no jitter on revisit) but the producer's roster looks varied.
//
// New branching logic per CLAUDE.md mistake log 2026-04-22: failing
// test first (RED), then implement (GREEN).

describe("gradientForId — deterministic project hero gradient picker", () => {
  it("exposes the 6 canonical gradient keys", () => {
    // Pin the literal tuple — if someone adds a 7th gradient class to
    // globals.css they'll need to update this test (and the .grad-*
    // CSS classes) together.
    expect([...GRADIENT_KEYS]).toEqual([
      "grad-rose",
      "grad-amber",
      "grad-slate",
      "grad-emerald",
      "grad-violet",
      "grad-indigo",
    ]);
  });

  it("returns one of the 6 valid keys for any input", () => {
    const ids = [
      "proj_001",
      "proj_xyz",
      "00000000-0000-0000-0000-000000000000",
      "project-with-very-long-id-and-special-chars-/!@#",
    ];
    for (const id of ids) {
      const key = gradientForId(id);
      expect(GRADIENT_KEYS).toContain(key);
    }
  });

  it("is deterministic — same id always returns the same gradient", () => {
    // The producer should see the same hero color every time they open
    // a project. Re-running the picker on the same id must be stable.
    const id = "proj_stability_check";
    const first = gradientForId(id);
    for (let i = 0; i < 100; i++) {
      expect(gradientForId(id)).toBe(first);
    }
  });

  it("distributes across all 6 buckets given a varied id pool", () => {
    // Across 60 distinct ids, every bucket should be hit at least once.
    // If the hash collapses to one bucket, this catches it. Not a
    // chi-squared test — just a lower bound that pins "hash actually
    // hashes" without being flaky.
    const ids = Array.from({ length: 60 }, (_, i) => `proj_${String(i)}`);
    const seen = new Set<GradientKey>();
    for (const id of ids) seen.add(gradientForId(id));
    expect(seen.size).toBe(GRADIENT_KEYS.length);
  });

  it("handles empty + edge inputs without crashing", () => {
    // Empty id should still return a valid key (nullable id paths in
    // RSC pages would otherwise crash the hero render).
    expect(GRADIENT_KEYS).toContain(gradientForId(""));
    expect(GRADIENT_KEYS).toContain(gradientForId("a"));
  });
});
