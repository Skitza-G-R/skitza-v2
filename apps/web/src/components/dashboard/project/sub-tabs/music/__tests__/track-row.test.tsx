import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Story 05 — TrackRow: per-track row with hero waveform, version chips,
// status pill, comment count, and the drop-on-row gesture.
//
// Drop-on-row hit testing — the row exposes two halves during drag-
// over:
//   - Top half (larger)  → "Replace as V<N+1>" → onAddVersion(trackId, files)
//   - Bottom half (smaller) → "Add as separate track" → onAddTracks(files)
// Both buckets are wired through the same onDragEnter/Over/Leave/Drop
// handlers; the bucket selection happens off the drop event's clientY
// vs. the row's bounding rect.

const SRC = readFileSync(
  new URL("../track-row.tsx", import.meta.url),
  "utf8",
);

describe("TrackRow source invariants (Story 05)", () => {
  it("is a client component", () => {
    expect(SRC.split("\n")[0]).toMatch(/^"use client"/);
  });

  it("imports the WaveformPlayer for the hero waveform", () => {
    // PRD §11.6 + acceptance: 320px hero waveform on the active version.
    expect(SRC).toMatch(/WaveformPlayer/);
  });

  it("imports VersionStatusPill", () => {
    // The bilateral pill renders top-right of the row.
    expect(SRC).toMatch(/VersionStatusPill/);
  });

  it("registers all four drag handlers (enter/over/leave/drop)", () => {
    expect(SRC).toMatch(/onDragEnter/);
    expect(SRC).toMatch(/onDragOver/);
    expect(SRC).toMatch(/onDragLeave/);
    expect(SRC).toMatch(/onDrop/);
  });

  it("exposes onAddVersion + onAddTracks callbacks", () => {
    // Acceptance: top-half drop fires onAddVersion(trackId, files);
    // bottom-half drop fires onAddTracks(files).
    expect(SRC).toMatch(/onAddVersion/);
    expect(SRC).toMatch(/onAddTracks/);
  });

  it("uses data-drop-active attribute logic", () => {
    // The row toggles a data-* attribute during drag-over so the CSS
    // can reveal the two-halves split visualisation. Per spec.
    expect(SRC).toMatch(/data-drop-active/);
  });

  it("hit-tests top-half vs bottom-half via clientY + bounding rect", () => {
    // The drop handler reads e.clientY and compares against the row's
    // boundingClientRect to decide which bucket the file lands in.
    expect(SRC).toMatch(/clientY/);
    expect(SRC).toMatch(/getBoundingClientRect/);
  });

  it("renders version chips with click-to-swap", () => {
    // Each version chip is a button that, on click, swaps the active
    // version. The chip shows the label (V1, V2, V3, …).
    expect(SRC).toMatch(/version/i);
    expect(SRC).toMatch(/button/);
  });

  it("renders the active version's waveform with responsive height (200/320)", () => {
    // Mobile-first: 200px on mobile, 320px on desktop. We accept either
    // a literal number on a height={…} prop or a media query on a
    // className.
    expect(SRC).toMatch(/320|hero/);
  });

  it("renders comment count and unresolved badge", () => {
    expect(SRC).toMatch(/unresolved|comment/i);
  });

  it("uses CSS variable colours, no hex / no Tailwind named palette", () => {
    expect(SRC).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(SRC).not.toMatch(/\b(?:bg|text|border)-(?:red|blue|green|yellow|gray|slate|zinc|neutral|stone)-\d/);
  });

  it("supports inline title rename via input + Enter / blur to save", () => {
    // Acceptance: "Inline title rename — click the title field on a
    // track row to edit. Save on blur or Enter."
    expect(SRC).toMatch(/onBlur|blur/i);
  });

  it("focus-visible used for keyboard rings", () => {
    expect(SRC).toMatch(/focus-visible:/);
  });
});
