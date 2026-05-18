import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SIDEBAR = readFileSync(join(here, "..", "producer-sidebar.tsx"), "utf8");
const BOTTOM = readFileSync(join(here, "..", "producer-bottom-nav.tsx"), "utf8");

// Nav history:
//   - 2026-05-15: Portfolio rows removed from both the desktop rail
//     and the mobile bottom-tab bar (CLAUDE.md called for 6 top-level
//     producer pages).
//   - 2026-05-18 (PR #142): Portfolio re-introduced to the DESKTOP
//     sidebar only, directly under Storefront (Gili's call). Mobile
//     bottom-nav stays at 5 tabs — Portfolio is desktop-only chrome,
//     consistent with the desktop-only producer dashboard preference
//     in CLAUDE.md.
//
// These tests guard the current invariant: Portfolio IS in the
// sidebar, NOT in the bottom-nav; both Store entries point to
// /dashboard/store; no leftover /dashboard/profile hrefs.

describe("producer nav: Portfolio in sidebar only", () => {
  it("sidebar Store entry hrefs to /dashboard/store", () => {
    expect(SIDEBAR).toMatch(/href:\s*["']\/dashboard\/store["']/);
  });

  it("sidebar contains a Portfolio entry under Storefront", () => {
    expect(SIDEBAR).toMatch(/label:\s*["']Portfolio["']/);
    expect(SIDEBAR).toMatch(/href:\s*["']\/dashboard\/portfolio["']/);
  });

  it("bottom-nav Store entry hrefs to /dashboard/store", () => {
    expect(BOTTOM).toMatch(/href:\s*["']\/dashboard\/store["']/);
  });

  it("bottom-nav does NOT contain a Portfolio entry (mobile stays 5 tabs)", () => {
    expect(BOTTOM).not.toMatch(/label:\s*["']Portfolio["']/);
    expect(BOTTOM).not.toMatch(/href:\s*["']\/dashboard\/portfolio["']/);
  });

  it("nav files contain no leftover /dashboard/profile hrefs", () => {
    expect(SIDEBAR).not.toMatch(/href:\s*["']\/dashboard\/profile["']/);
    expect(BOTTOM).not.toMatch(/href:\s*["']\/dashboard\/profile["']/);
  });
});
