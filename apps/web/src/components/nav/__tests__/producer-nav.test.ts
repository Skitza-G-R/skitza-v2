import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SIDEBAR = readFileSync(join(here, "..", "producer-sidebar.tsx"), "utf8");
const BOTTOM = readFileSync(join(here, "..", "producer-bottom-nav.tsx"), "utf8");
const SHARED_BOTTOM = readFileSync(join(here, "..", "liquid-glass-bottom-nav.tsx"), "utf8");
const APP_SHELL = readFileSync(join(here, "..", "..", "shell", "app-shell.tsx"), "utf8");
const APP_TOPBAR = readFileSync(join(here, "..", "..", "shell", "app-topbar.tsx"), "utf8");
const GLOBALS = readFileSync(join(here, "..", "..", "..", "app", "globals.css"), "utf8");
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

  it("prefetches only the lightweight Home boundary and leaves full routes to the serial warmer", () => {
    expect(BOTTOM).toContain('prefetch: tab.id === "today" ? null : false');
    expect(BOTTOM).not.toContain("prefetch: true");
    expect(SHARED_BOTTOM).toContain(
      "prefetch={tab.prefetch === undefined ? false : tab.prefetch}",
    );
    expect(SIDEBAR).toContain("prefetch={null}");
    expect(SIDEBAR).toContain(
      'prefetch={item.id === "today" ? null : false}',
    );
    expect(BOTTOM).toContain("announceRuntimeMainNavigationIntent(tab.href)");
    expect(SIDEBAR.match(/announceRuntimeMainNavigationIntent/g)?.length).toBeGreaterThanOrEqual(3);
    expect(SHARED_BOTTOM).toContain("data-sk-nav-destination={tab.href}");
    expect(SIDEBAR.match(/data-sk-nav-destination=/g)).toHaveLength(2);
    expect(BOTTOM).toContain("captureRuntimeMainNavigationTarget(event.currentTarget)");
    expect(SIDEBAR.match(/captureRuntimeMainNavigationTarget/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("keeps the warmed producer screen open when a tab is tapped offline", () => {
    expect(BOTTOM).toContain("useOnlineStatus()");
    expect(BOTTOM).toContain("useToast()");
    expect(BOTTOM).toContain("navigationBlocked: !online");
    expect(BOTTOM).toContain("onNavigationBlocked");
    expect(SHARED_BOTTOM).toContain("aria-disabled={tab.navigationBlocked ?? false}");
    expect(SHARED_BOTTOM).toContain("if (!tab.navigationBlocked) return");
    expect(SHARED_BOTTOM).toContain("event.preventDefault()");
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
  it("removes the shared app tab bar for measured and focused mobile keyboards", () => {
    expect(GLOBALS).toMatch(
      /body\[data-sk-keyboard="open"\]\s+\.liquid-glass-bottom-nav-frame/,
    );
    expect(GLOBALS).toMatch(
      /body:has\([\s\S]*?input:is\([\s\S]*?:focus[\s\S]*?textarea:focus[\s\S]*?\)\s+\.liquid-glass-bottom-nav-frame\s*\{[^}]*display:\s*none;/,
    );
  });

  it("locks the mobile app shell to the viewport with an internal content scroller", () => {
    expect(APP_SHELL).toContain("fixed inset-0 flex overflow-hidden");
    expect(APP_SHELL).toContain("lg:static lg:min-h-dvh");
    expect(APP_SHELL).not.toContain('className="flex h-dvh');
    expect(APP_SHELL).toContain("min-h-0 min-w-0 flex-1 flex-col");
    expect(APP_SHELL).toContain("min-h-0 min-w-0 flex-1 overflow-y-auto");
  });

  it("keeps the glass nav in the shell footer instead of fixing it to the document viewport", () => {
    expect(BOTTOM).toContain('position="in-flow"');
    expect(SHARED_BOTTOM).toContain(
      '"fixed inset-x-0 top-[var(--sk-viewport-offset-top,0px)] flex h-[var(--sk-viewport-height,100dvh)] items-end pointer-events-none"',
    );
    expect(SHARED_BOTTOM).toContain(': "relative"');
    expect(SHARED_BOTTOM).toContain(
      ") max(8px, env(safe-area-inset-bottom, 0px)) max(12px, env(safe-area-inset-left, 0px))",
    );
    expect(GLOBALS).toMatch(
      /\.liquid-glass-bottom-nav__glass\s*\{[\s\S]*?height:\s*68px;[\s\S]*?padding-bottom:\s*0;/,
    );
    expect(GLOBALS).not.toContain(
      "padding-bottom: max(0px, calc(env(safe-area-inset-bottom, 0px) - 8px));",
    );
    expect(BOTTOM).not.toContain("safe-area-max-inset-bottom");
    expect(BOTTOM).not.toMatch(/className="[^"]*\bfixed\b/);
    expect(BOTTOM).not.toContain("producerBottomNavViewportStyle");
  });

  it("centers the tab row, magnified copy, and lens in the same glass height", () => {
    expect(SHARED_BOTTOM.match(/minHeight:\s*68/g)).toHaveLength(2);
    expect(GLOBALS).toContain("--sk-nav-lens-y: 34px");
    expect(GLOBALS).toContain("height: 60px");
    expect(GLOBALS).toMatch(
      /\.liquid-glass-bottom-nav__magnifier-grid\s*\{[\s\S]*?height:\s*68px;/,
    );
  });

  it("renders the producer nav as one compact live glass pill", () => {
    expect(BOTTOM).toContain("producer-bottom-nav-frame");
    expect(BOTTOM).toContain("<LiquidGlassBottomNav");
    expect(SHARED_BOTTOM).toContain("liquid-glass-bottom-nav__glass");
    expect(SHARED_BOTTOM).toContain('data-active={tab.active ? "true" : "false"}');
    expect(GLOBALS).toContain(".liquid-glass-bottom-nav__glass");
    expect(GLOBALS).toContain("background: rgb(var(--bg-sidebar) / 0.9)");
    expect(GLOBALS).toContain("backdrop-filter: blur(24px) saturate(170%)");
    expect(GLOBALS).toContain("-webkit-backdrop-filter: blur(24px) saturate(170%)");
    expect(GLOBALS).toMatch(
      /\.liquid-glass-bottom-nav__glass\s*\{[\s\S]*?grid-template-columns:\s*repeat\(var\(--sk-nav-column-count\),\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(GLOBALS).toContain('.liquid-glass-bottom-nav__tab[data-active="true"]');
    expect(GLOBALS).toContain("rgb(var(--bg-sidebar) / 0.52)");
  });

  it("tracks one real magnifying lens from pointer movement without React render-loop state", () => {
    expect(SHARED_BOTTOM).toContain("liquid-glass-bottom-nav__lens");
    expect(SHARED_BOTTOM).toContain("liquid-glass-bottom-nav__magnifier");
    expect(SHARED_BOTTOM).toContain("liquid-glass-bottom-nav__magnifier-grid");
    expect(SHARED_BOTTOM).toContain("requestAnimationFrame(flushPendingLensPoint)");
    expect(SHARED_BOTTOM).toContain('style.setProperty("--sk-nav-lens-x"');
    expect(SHARED_BOTTOM).toContain('style.setProperty("--sk-nav-lens-y"');
    expect(SHARED_BOTTOM).toContain('style.setProperty("--sk-nav-proximity"');
    expect(SHARED_BOTTOM).toContain("onPointerDown={handlePointerDown}");
    expect(SHARED_BOTTOM).toContain("onPointerMove={handlePointerMove}");
    expect(SHARED_BOTTOM).toContain("onPointerUp={handlePointerEnd}");
    expect(SHARED_BOTTOM).toContain("onPointerCancel={handlePointerEnd}");
    expect(SHARED_BOTTOM).toContain("draggable={false}");
    expect(SHARED_BOTTOM).not.toContain("useState");

    expect(GLOBALS).toContain(".liquid-glass-bottom-nav__lens");
    expect(GLOBALS).toContain(".liquid-glass-bottom-nav__magnifier");
    expect(GLOBALS).toContain("calc(var(--sk-nav-lens-width) / 2) 30px");
    expect(GLOBALS).toContain("transform: scale(1.13)");
    expect(GLOBALS).toContain("touch-action: pan-y");
  });

  it("keeps a static active treatment when reduced motion is requested", () => {
    expect(GLOBALS).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.liquid-glass-bottom-nav__lens,[\s\S]*\.liquid-glass-bottom-nav__magnifier[\s\S]*display: none !important/,
    );
    expect(GLOBALS).toContain('.liquid-glass-bottom-nav__tab[data-active="true"]');
  });

  it("keeps producer topbar controls below the iPhone status area", () => {
    expect(APP_TOPBAR).toContain("sk-safe-top sticky top-0");
    expect(APP_TOPBAR).toContain("lg:pt-0");
  });

  it("keeps topbar scroll state connected to the app content scroller", () => {
    expect(APP_TOPBAR).toContain('document.getElementById("main-content")');
    expect(APP_TOPBAR).toContain('scrollContainer.addEventListener("scroll"');
    expect(APP_TOPBAR).toContain('scrollContainer.removeEventListener("scroll"');
  });
});
