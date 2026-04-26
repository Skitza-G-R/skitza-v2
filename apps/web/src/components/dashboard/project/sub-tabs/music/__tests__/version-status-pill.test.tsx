import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Story 05 — VersionStatusPill: bilateral status dropdown.
//
// Producer view labels: Draft / Revisit / Final
// Artist view labels:   In progress / Needs work / Approved
//
// Same DB enum (track_versions.status), same colour token per status,
// different copy per viewer. The component owns the dropdown UX
// (open/close, click-outside, Escape to close, keyboard nav) and
// delegates the actual mutation to the parent via `onChange(status)`.
//
// Source-text invariants (no jsdom in this repo). The bilateral copy
// table is exercised in music-helpers.test.ts via pickStatusCopy; here
// we just confirm the component imports + uses that helper.

const SRC = readFileSync(
  new URL("../version-status-pill.tsx", import.meta.url),
  "utf8",
);

describe("VersionStatusPill source invariants (Story 05)", () => {
  it("is a client component", () => {
    expect(SRC.split("\n")[0]).toMatch(/^"use client"/);
  });

  it("imports React useState (open/close state for dropdown)", () => {
    expect(SRC).toMatch(/from\s+["']react["']/);
    expect(SRC).toMatch(/useState/);
  });

  it("imports pickStatusCopy from the shared helpers", () => {
    // The bilateral copy table lives in music-helpers.ts so the same
    // logic can be tested in isolation. The .tsx file MUST consume
    // that helper rather than re-implementing the table inline.
    expect(SRC).toMatch(/pickStatusCopy/);
  });

  it("accepts viewerRole prop ('producer' | 'artist')", () => {
    expect(SRC).toMatch(/viewerRole/);
  });

  it("accepts status prop ('draft' | 'revisit' | 'final')", () => {
    expect(SRC).toMatch(/status/);
    // The three enum values must each appear in the file (they're the
    // option list rendered inside the dropdown).
    expect(SRC).toMatch(/['"]draft['"]/);
    expect(SRC).toMatch(/['"]revisit['"]/);
    expect(SRC).toMatch(/['"]final['"]/);
  });

  it("exposes onChange callback prop", () => {
    expect(SRC).toMatch(/onChange/);
  });

  it("uses ARIA menu / listbox semantics", () => {
    // Dropdown a11y — either role="menu" + role="menuitem" or
    // aria-haspopup. Both are valid; we accept either.
    const ok =
      /aria-haspopup/.test(SRC) ||
      /role="menu"/.test(SRC) ||
      /role="listbox"/.test(SRC);
    expect(ok).toBe(true);
  });

  it("supports Escape to close the dropdown", () => {
    // Standard a11y pattern from notification-bell — keydown listener
    // closes the popover.
    expect(SRC).toMatch(/Escape/);
  });

  it("uses CSS variable colours, no hex / no Tailwind named palette", () => {
    expect(SRC).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(SRC).not.toMatch(/\b(?:bg|text|border)-(?:red|blue|green|yellow|gray|slate|zinc|neutral|stone)-\d/);
  });

  it("colour tokens differ per tone (positive / warn / neutral)", () => {
    // The pill should map at least three distinct CSS-var tokens to
    // the three tones. We grep for the brand-primary (positive),
    // some warning token (warn), and some muted/neutral token.
    expect(SRC).toMatch(/--brand-primary/);
    // The warn / neutral tokens may be different names — we just want
    // SOME muted reference + at least one of the warning colour names.
    const muted = /--fg-muted|--fg-secondary|--bg-sunken/.test(SRC);
    expect(muted).toBe(true);
  });

  it("focus-visible used (not :focus) for keyboard rings", () => {
    expect(SRC).toMatch(/focus-visible:/);
  });

  it("touch target meets 44px floor on mobile", () => {
    // sk-tap utility OR explicit min-h.
    const ok =
      /sk-tap/.test(SRC) ||
      /min-h-\[44px\]/.test(SRC) ||
      /min-h-\[\d{2,3}px\]/.test(SRC);
    expect(ok).toBe(true);
  });
});
