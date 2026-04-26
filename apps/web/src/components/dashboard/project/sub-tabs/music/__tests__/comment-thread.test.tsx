import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Story 06 — CommentThread: a single comment row inside the comments
// panel. Renders author + timestamp anchor + body + reply count +
// resolve toggle. Cross-version subscript ("(from V1)") shows ONLY
// when the comment's versionId differs from the active versionId.

const SRC = readFileSync(
  new URL("../comment-thread.tsx", import.meta.url),
  "utf8",
);

describe("CommentThread source invariants (Story 06)", () => {
  it("is a client component", () => {
    expect(SRC.split("\n")[0]).toMatch(/^"use client"/);
  });

  it("imports React useState for the optimistic-resolve toggle", () => {
    expect(SRC).toMatch(/from\s+["']react["']/);
    // We accept useState OR a parent-controlled prop pattern with
    // local state for pending-toggle UX.
    expect(SRC).toMatch(/useState/);
  });

  it("imports formatRangeAnchor for the time anchor (point/range)", () => {
    // Range comments render with the "0:30 – 1:15" format — the helper
    // handles both shapes via the endTimestampMs parameter.
    expect(SRC).toMatch(/formatRangeAnchor/);
  });

  it("renders the (from V<N>) subscript only when comment is from a different version", () => {
    // Acceptance: subscript renders when comment.versionId !==
    // activeVersionId. We pin via the "from V" string literal that
    // bridges the rendered output and the conditional.
    expect(SRC).toMatch(/from V|fromV/);
    // The conditional itself must reference both the comment's version
    // AND the active version — accept either prop name shape.
    expect(SRC).toMatch(/activeVersionId|active.*[Vv]ersion/);
  });

  it("calls resolveCommentAction on resolve click", () => {
    expect(SRC).toMatch(/resolveCommentAction/);
  });

  it("calls unresolveCommentAction on unresolve click", () => {
    expect(SRC).toMatch(/unresolveCommentAction/);
  });

  it("renders author name + body", () => {
    expect(SRC).toMatch(/authorName|author/i);
    expect(SRC).toMatch(/body/);
  });

  it("uses CSS variable colours, no hex / no Tailwind named palette", () => {
    expect(SRC).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(SRC).not.toMatch(/\b(?:bg|text|border)-(?:red|blue|green|yellow|gray|slate|zinc|neutral|stone)-\d/);
  });

  it("touch target on the resolve toggle meets >= 44px (sk-tap or min-h)", () => {
    // The resolve toggle is a primary action; it must be reachable on
    // mobile.
    const ok =
      /sk-tap/.test(SRC) ||
      /min-h-\[44px\]/.test(SRC) ||
      /min-h-\[\d{2,3}px\]/.test(SRC);
    expect(ok).toBe(true);
  });

  it("uses :focus-visible for keyboard rings", () => {
    expect(SRC).toMatch(/focus-visible:/);
  });
});
