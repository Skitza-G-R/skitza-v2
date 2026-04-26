import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Story 06 — RangeCommentOverlay: drag-on-waveform → range-selection →
// composer flow. Sits on top of the WaveformPlayer container; window-
// level mousemove + mouseup listeners drive the band visualization and
// classify the gesture (point vs range) via classifyDrag(200ms).
//
// No jsdom in this repo (CLAUDE.md test conventions) — we pin the
// contract via source-text invariants. Branch logic is exercised through
// pure helpers (classifyDrag, pixelsToMs, msToPixels, formatRangeAnchor)
// in music-helpers.test.ts.

const SRC = readFileSync(
  new URL("../range-comment-overlay.tsx", import.meta.url),
  "utf8",
);

describe("RangeCommentOverlay source invariants (Story 06)", () => {
  it("is a client component", () => {
    expect(SRC.split("\n")[0]).toMatch(/^"use client"/);
  });

  it("imports React useState (drag state) + useEffect / useRef", () => {
    expect(SRC).toMatch(/from\s+["']react["']/);
    expect(SRC).toMatch(/useState/);
  });

  it("imports the pure helpers (classifyDrag, pixelsToMs, formatRangeAnchor)", () => {
    // The component must consume the pure helpers — that's how branch
    // logic gets unit-test coverage without jsdom. Re-implementing the
    // math inline would silently bypass the tests.
    expect(SRC).toMatch(/classifyDrag/);
    expect(SRC).toMatch(/pixelsToMs/);
    expect(SRC).toMatch(/formatRangeAnchor/);
  });

  it("references the 200ms drag-vs-point threshold (or imports default)", () => {
    // The classifyDrag default is 200ms — accept either an explicit
    // numeric reference or the bare classifyDrag() call (which uses
    // the 200ms default).
    const ok = /200/.test(SRC) || /classifyDrag\([^,)]+,[^,)]+\)/.test(SRC);
    expect(ok).toBe(true);
  });

  it("listens for mousedown on the waveform container", () => {
    // The drag starts on a mousedown on the waveform area. We accept
    // either the React onMouseDown prop or addEventListener('mousedown').
    expect(SRC).toMatch(/onMouseDown|mousedown/);
  });

  it("attaches window-level mousemove and mouseup listeners during drag", () => {
    // The drag end can happen outside the original element if the user
    // dragged past the edge of the waveform — window-level listeners
    // catch that case. (This is the "live drag" pattern.)
    expect(SRC).toMatch(/mousemove/);
    expect(SRC).toMatch(/mouseup/);
  });

  it("renders a translucent band on the waveform during drag", () => {
    // Per acceptance: the dragging visual is a brand-primary band at
    // ~18% alpha. We accept the documented colour token at any low alpha.
    expect(SRC).toMatch(/var\(--brand-primary\)\s*\/\s*0\.\d{1,2}/);
  });

  it("calls addRangeCommentAction on submit", () => {
    // The composer's submit button triggers the server action wrapper
    // that fronts projectRoom.addRangeComment.
    expect(SRC).toMatch(/addRangeCommentAction/);
  });

  it("calls addPointCommentAction for point comments (sub-200ms drags)", () => {
    // Below-threshold drags fall back to the point-comment surface.
    expect(SRC).toMatch(/addPointCommentAction/);
  });

  it("renders the time anchor via formatRangeAnchor (point + range)", () => {
    // The composer chip shows "0:30" or "0:30 – 1:15" depending on the
    // drag classification. formatRangeAnchor handles both shapes.
    expect(SRC).toMatch(/formatRangeAnchor/);
  });

  it("uses CSS variables only, no hex / no Tailwind named palette", () => {
    expect(SRC).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(SRC).not.toMatch(/\b(?:bg|text|border)-(?:red|blue|green|yellow|gray|slate|zinc|neutral|stone)-\d/);
  });

  it("uses :focus-visible for keyboard rings", () => {
    expect(SRC).toMatch(/focus-visible:/);
  });

  it("auto-pauses playback while typing in the composer", () => {
    // Reuses the existing PersistentPlayer event bus (skitza:player:toggle).
    // Grep accepts either the imperative helper (playerToggle) or the
    // event constant.
    const ok =
      /playerToggle/.test(SRC) ||
      /skitza:player:toggle/.test(SRC) ||
      /PLAYER_EVENTS/.test(SRC);
    expect(ok).toBe(true);
  });

  it("provides a Cancel control to dismiss the composer", () => {
    // A11y baseline — the composer must be dismissable without submitting.
    expect(SRC).toMatch(/[Cc]ancel/);
  });
});
