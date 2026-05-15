import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SIDEBAR = readFileSync(join(here, "..", "producer-sidebar.tsx"), "utf8");
const BOTTOM = readFileSync(join(here, "..", "producer-bottom-nav.tsx"), "utf8");

// Sidebar polish (2026-05-15): Portfolio rows are gone from both the
// desktop rail and the mobile bottom-tab bar. The /dashboard/portfolio
// route still exists and is reachable from inside the Store
// experience; these tests guard against a regression that
// re-introduces Portfolio as a top-level nav entry without an
// explicit product decision.

describe("producer nav: Store row only (Portfolio removed)", () => {
  it("sidebar Store entry hrefs to /dashboard/store", () => {
    expect(SIDEBAR).toMatch(/href:\s*["']\/dashboard\/store["']/);
  });

  it("sidebar does NOT contain a Portfolio entry", () => {
    expect(SIDEBAR).not.toMatch(/label:\s*["']Portfolio["']/);
    expect(SIDEBAR).not.toMatch(/href:\s*["']\/dashboard\/portfolio["']/);
  });

  it("bottom-nav Store entry hrefs to /dashboard/store", () => {
    expect(BOTTOM).toMatch(/href:\s*["']\/dashboard\/store["']/);
  });

  it("bottom-nav does NOT contain a Portfolio entry", () => {
    expect(BOTTOM).not.toMatch(/label:\s*["']Portfolio["']/);
    expect(BOTTOM).not.toMatch(/href:\s*["']\/dashboard\/portfolio["']/);
  });

  it("nav files contain no leftover /dashboard/profile hrefs", () => {
    expect(SIDEBAR).not.toMatch(/href:\s*["']\/dashboard\/profile["']/);
    expect(BOTTOM).not.toMatch(/href:\s*["']\/dashboard\/profile["']/);
  });
});
