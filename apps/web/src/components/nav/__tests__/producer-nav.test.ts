import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SIDEBAR = readFileSync(join(here, "..", "producer-sidebar.tsx"), "utf8");
const BOTTOM = readFileSync(join(here, "..", "producer-bottom-nav.tsx"), "utf8");
const APP_SHELL = readFileSync(join(here, "..", "..", "shell", "app-shell.tsx"), "utf8");
const APP_TOPBAR = readFileSync(join(here, "..", "..", "shell", "app-topbar.tsx"), "utf8");
const EN_MESSAGES = readFileSync(join(here, "..", "..", "..", "..", "messages", "en.json"), "utf8");
const HE_MESSAGES = readFileSync(join(here, "..", "..", "..", "..", "messages", "he.json"), "utf8");

// Nav history:
//   - 2026-05-15: Portfolio rows removed from both the desktop rail
//     and the mobile bottom-tab bar (CLAUDE.md called for 6 top-level
//     producer pages).
//   - 2026-05-18 (PR #142): Portfolio re-introduced to the DESKTOP
//     sidebar only, directly under Store (Gili's call). Mobile
//     bottom-nav stays at 5 tabs — Portfolio is desktop-only chrome,
//     consistent with the desktop-only producer dashboard preference
//     in CLAUDE.md.
//
// These tests guard the current invariant: Portfolio and Store remain
// in the desktop sidebar, while the five mobile tabs end in Payments.

describe("producer nav: Portfolio in sidebar only", () => {
  it("sidebar Store entry hrefs to /dashboard/store", () => {
    expect(SIDEBAR).toMatch(/href:\s*["']\/dashboard\/store["']/);
  });

  it("sidebar contains a Portfolio entry under Store", () => {
    expect(SIDEBAR).toMatch(/label:\s*["']Portfolio["']/);
    expect(SIDEBAR).toMatch(/href:\s*["']\/dashboard\/portfolio["']/);
  });

  it("adds global Payments to the desktop sidebar", () => {
    expect(SIDEBAR).toMatch(/label:\s*["']Payments["']/);
    expect(SIDEBAR).toMatch(/href:\s*["']\/dashboard\/payments["']/);
    expect(SIDEBAR).toMatch(/icon:\s*["']payments["']/);
  });

  it("uses the approved five mobile labels and routes", () => {
    expect(BOTTOM).toMatch(/label:\s*["']Today["']/);
    expect(BOTTOM).toMatch(/label:\s*["']Music["']/);
    expect(BOTTOM).toMatch(/label:\s*["']Payments["']/);
    expect(BOTTOM).toMatch(/href:\s*["']\/dashboard\/payments["']/);
    expect(BOTTOM).not.toMatch(/href:\s*["']\/dashboard\/store["']/);
  });

  it("fully prefetches the dynamic producer tabs", () => {
    expect(BOTTOM).toMatch(/<Link[\s\S]*href=\{tab\.href\}[\s\S]*prefetch=\{online\}/);
  });

  it("keeps the warmed producer screen open when a tab is tapped offline", () => {
    expect(BOTTOM).toContain("useOnlineStatus()");
    expect(BOTTOM).toContain("useToast()");
    expect(BOTTOM).toContain("aria-disabled={!online}");
    expect(BOTTOM).toMatch(
      /onClick=\{\(event\) => \{[\s\S]*if \(online\) return;[\s\S]*event\.preventDefault\(\);[\s\S]*toast\(/,
    );
    expect(BOTTOM).toContain("This screen will stay open until you reconnect.");
    expect(BOTTOM).not.toMatch(/router\.(?:push|replace)|history\.(?:pushState|replaceState)/);
  });

  it("bottom-nav does NOT contain a Portfolio entry (mobile stays 5 tabs)", () => {
    expect(BOTTOM).not.toMatch(/label:\s*["']Portfolio["']/);
    expect(BOTTOM).not.toMatch(/href:\s*["']\/dashboard\/portfolio["']/);
  });

  it("nav files contain no leftover /dashboard/profile hrefs", () => {
    expect(SIDEBAR).not.toMatch(/href:\s*["']\/dashboard\/profile["']/);
    expect(BOTTOM).not.toMatch(/href:\s*["']\/dashboard\/profile["']/);
  });

  it("provides the Payments sidebar label in both message catalogs", () => {
    expect(EN_MESSAGES).toMatch(/"payments":\s*"Payments"/);
    expect(HE_MESSAGES).toMatch(/"payments":\s*"תשלומים"/);
  });

  it("uses the approved Store label in English navigation", () => {
    expect(EN_MESSAGES).toMatch(/"profile":\s*"Store"/);
  });
});

describe("producer mobile nav viewport anchoring", () => {
  it("locks the mobile app shell to the viewport with an internal content scroller", () => {
    expect(APP_SHELL).toContain("fixed inset-0 flex overflow-hidden");
    expect(APP_SHELL).toContain("lg:static lg:min-h-dvh");
    expect(APP_SHELL).not.toContain('className="flex h-dvh');
    expect(APP_SHELL).toContain("min-h-0 min-w-0 flex-1 flex-col");
    expect(APP_SHELL).toContain("min-h-0 min-w-0 flex-1 overflow-y-auto");
  });

  it("keeps the mobile nav in the shell footer instead of fixing it to the document viewport", () => {
    expect(BOTTOM).toContain("relative z-30 flex shrink-0");
    expect(BOTTOM).toContain("env(safe-area-inset-bottom, 0px)");
    expect(BOTTOM).not.toContain("safe-area-max-inset-bottom");
    expect(BOTTOM).not.toMatch(/className="[^"]*\bfixed\b/);
    expect(BOTTOM).not.toContain("producerBottomNavViewportStyle");
  });

  it("keeps topbar scroll state connected to the app content scroller", () => {
    expect(APP_TOPBAR).toContain('document.getElementById("main-content")');
    expect(APP_TOPBAR).toContain('scrollContainer.addEventListener("scroll"');
    expect(APP_TOPBAR).toContain('scrollContainer.removeEventListener("scroll"');
  });
});
