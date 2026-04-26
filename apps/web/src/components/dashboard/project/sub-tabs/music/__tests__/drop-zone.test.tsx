import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Story 05 — DropZone is a presentational primitive: it owns the drag-
// and-drop affordances + click-to-pick fallback, but delegates the
// actual upload trigger to its parent via `onFilesSelected`. Two
// variants:
//   - "empty"  — full-bleed, taller card; main copy "Drop audio files
//                or click to choose."
//   - "pinned" — slim, ~80px, lives at the top of a populated list.
//
// Per CLAUDE.md test conventions (vitest in node env, no jsdom, no
// RTL), we pin the contract via source-text invariants on the .tsx
// file. Hover state, drag-over highlight, and click-to-open behaviours
// are all wired through documented class strings + handler names.

const SRC = readFileSync(
  new URL("../drop-zone.tsx", import.meta.url),
  "utf8",
);

describe("DropZone source invariants (Story 05)", () => {
  it("is a client component", () => {
    expect(SRC.split("\n")[0]).toMatch(/^"use client"/);
  });

  it("imports React useState (drag-over hover state)", () => {
    expect(SRC).toMatch(/from\s+["']react["']/);
    expect(SRC).toMatch(/useState/);
  });

  it("renders a hidden <input type=\"file\"> with multiple", () => {
    // Multi-file drop is allowed (acceptance: "each file becomes its
    // own track row by default"). The fallback file picker must also
    // accept multiple selections.
    expect(SRC).toMatch(/type="file"/);
    expect(SRC).toMatch(/multiple/);
  });

  it("registers all four drag handlers (enter/over/leave/drop)", () => {
    expect(SRC).toMatch(/onDragEnter/);
    expect(SRC).toMatch(/onDragOver/);
    expect(SRC).toMatch(/onDragLeave/);
    expect(SRC).toMatch(/onDrop/);
  });

  it("exposes onFilesSelected callback prop", () => {
    expect(SRC).toMatch(/onFilesSelected/);
  });

  it("supports both 'empty' and 'pinned' variants", () => {
    expect(SRC).toMatch(/variant.*['"]empty['"]/s);
    expect(SRC).toMatch(/variant.*['"]pinned['"]/s);
  });

  it("uses CSS variable colours, no hex / no Tailwind named palette", () => {
    // CSS-vars-only — see CLAUDE.md § Styling.
    expect(SRC).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(SRC).not.toMatch(/\b(?:bg|text|border)-(?:red|blue|green|yellow|gray|slate|zinc|neutral|stone)-\d/);
  });

  it("hover state uses the brand-primary token at low alpha", () => {
    // Acceptance: "drag a file over → highlighted hover state with
    // bg-[rgb(var(--brand-primary)/0.06)]"
    expect(SRC).toMatch(/var\(--brand-primary\)\s*\/\s*0\.0\d/);
  });

  it("uses dashed border so the affordance reads as droppable", () => {
    // Standard drop-zone visual language (matches AudioUploader).
    expect(SRC).toMatch(/border-dashed/);
  });

  it("touch target meets >= 44px floor (mobile ergonomics)", () => {
    // Either via min-h on the empty variant or sk-tap utility — we
    // accept any of these as evidence that touch-target sizing was
    // considered.
    const ok =
      /min-h-\[\d{2,3}/.test(SRC) ||
      /min-h-\d{2,3}/.test(SRC) ||
      /sk-tap/.test(SRC);
    expect(ok).toBe(true);
  });

  it("uses :focus-visible for keyboard focus rings (not :focus)", () => {
    expect(SRC).toMatch(/focus-visible:/);
  });
});
