import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Story 06 — CommentsPanel: list of comments for the active version,
// with cross-version unresolved threads appended below. Composition:
//   1. Active-version comments (DESC by createdAt — caller pre-sorts)
//   2. Cross-version unresolved (with `(from V<N>)` subscript)
//   3. Resolved comments NOT shown
//   4. Empty state copy when both buckets are empty.

const SRC = readFileSync(
  new URL("../comments-panel.tsx", import.meta.url),
  "utf8",
);

describe("CommentsPanel source invariants (Story 06)", () => {
  it("is a client component", () => {
    expect(SRC.split("\n")[0]).toMatch(/^"use client"/);
  });

  it("imports the partitionComments helper for the bucketing", () => {
    // Pure helper covers branch logic; the .tsx just renders. The
    // helper is the only way for unit tests to pin the bucket logic
    // (no jsdom in this repo).
    expect(SRC).toMatch(/partitionComments/);
  });

  it("imports the CommentThread component for each row", () => {
    expect(SRC).toMatch(/CommentThread/);
  });

  it("renders an empty state when both onActive and fromOtherVersions are empty", () => {
    // Acceptance copy: "No comments on this version yet — drag the
    // waveform to leave one." We accept any "No comments" prefix.
    expect(SRC).toMatch(/No comments/i);
  });

  it("renders active-version comments BEFORE cross-version comments", () => {
    // We pin via order — the JSX must render onActive earlier in the
    // file than fromOtherVersions. Source-text regex doesn't enforce
    // strict DOM order, but it does enforce the structural intent.
    const onActiveIdx = SRC.indexOf("onActive");
    const fromOtherIdx = SRC.indexOf("fromOtherVersions");
    expect(onActiveIdx).toBeGreaterThan(-1);
    expect(fromOtherIdx).toBeGreaterThan(-1);
    expect(onActiveIdx).toBeLessThan(fromOtherIdx);
  });

  it("never renders the resolved bucket directly", () => {
    // The .resolved field is exposed by the helper (for future audit
    // views) but the panel must NOT iterate over it. We assert no
    // `.map` / `.forEach` against the resolved bucket.
    expect(SRC).not.toMatch(/\.resolved\.map/);
    expect(SRC).not.toMatch(/\.resolved\.forEach/);
  });

  it("uses CSS variable colours, no hex / no Tailwind named palette", () => {
    expect(SRC).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(SRC).not.toMatch(/\b(?:bg|text|border)-(?:red|blue|green|yellow|gray|slate|zinc|neutral|stone)-\d/);
  });

  it("passes activeVersionId to each CommentThread (so subscript can render)", () => {
    // The subscript decision lives inside CommentThread — but the panel
    // has to feed it the activeVersionId. Pin via the prop name.
    expect(SRC).toMatch(/activeVersionId/);
  });
});
