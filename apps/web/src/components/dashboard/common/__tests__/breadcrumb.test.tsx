import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "breadcrumb.tsx"), "utf-8");

describe("Breadcrumb", () => {
  it("exports a Breadcrumb component (function)", () => {
    expect(SRC).toMatch(/export function Breadcrumb/);
  });

  it("declares a BreadcrumbCrumb interface with label + optional href", () => {
    expect(SRC).toMatch(/export interface BreadcrumbCrumb/);
    expect(SRC).toMatch(/label:\s*string/);
    expect(SRC).toMatch(/href\?:\s*string/);
  });

  it("renders a <nav> with aria-label='Breadcrumb'", () => {
    expect(SRC).toMatch(/<nav[\s\S]*?aria-label="Breadcrumb"/);
  });

  it("renders intermediate crumbs as Next <Link> when href is set", () => {
    expect(SRC).toMatch(/from\s+["']next\/link["']/);
    expect(SRC).toMatch(/<Link/);
    expect(SRC).toMatch(/item\.href/);
  });

  it("marks the last crumb as aria-current='page' (non-clickable)", () => {
    // Standard accessibility pattern — the current page shouldn't be a
    // link, and screen readers need the cue. We also enforce this for
    // the LAST crumb regardless of whether href was provided.
    expect(SRC).toMatch(/aria-current=\{isLast\s*\?\s*["']page["']/);
    expect(SRC).toMatch(/isLast/);
  });

  it("uses a ChevronRight separator between crumbs", () => {
    expect(SRC).toMatch(/ChevronRight/);
    expect(SRC).toMatch(/from\s+["']lucide-react["']/);
  });

  it("uses canonical Skitza tokens (no forbidden ones)", () => {
    expect(SRC).not.toContain("--surface-card");
    expect(SRC).not.toContain("--text-muted");
    expect(SRC).not.toContain("--text-strong");
    expect(SRC).not.toContain("--surface-hover");
    expect(SRC).not.toContain("--brand-primary-on");
  });

  it("returns null when items array is empty (no DOM clutter)", () => {
    expect(SRC).toMatch(/items\.length\s*===\s*0/);
  });

  it("truncates a too-long current-page crumb (keeps single-line)", () => {
    // The hero already constrains its width via flex; if the song
    // title is 80+ chars the breadcrumb should still fit on one line.
    expect(SRC).toMatch(/max-w-\[28ch\]/);
    expect(SRC).toMatch(/truncate/);
  });
});
