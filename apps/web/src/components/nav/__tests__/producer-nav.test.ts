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
//   - SK-306: Store and Payments swapped places on MOBILE. Store took
//     the fifth tab; Payments moved into the account sheet behind the
//     avatar. Producers open the store far more often than the payments
//     workspace, because private offers start there.
//
// These tests guard the current invariant: Portfolio, Store and Payments
// all remain in the desktop sidebar, while the five mobile tabs end in
// Store and Payments is reachable only from the account sheet.

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
    expect(BOTTOM).toMatch(/label:\s*["']Store["']/);
    expect(BOTTOM).toMatch(/href:\s*["']\/dashboard\/store["']/);
    expect(BOTTOM).not.toMatch(/href:\s*["']\/dashboard\/payments["']/);
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

  // SK-306. The bar used to be an in-flow flex sibling *below* the scroller,
  // so the scroll box ended at the bar's top edge: the screen read as chopped
  // off there and nothing could ever pass under the glass.
  it("scrolls page content under the bar and reserves its height in the scroller", () => {
    expect(APP_SHELL).toContain('<div className="relative flex min-h-0 min-w-0 flex-1 flex-col">');
    expect(APP_SHELL).toContain("sk-bottom-nav-inset min-h-0 min-w-0 flex-1 overflow-y-auto");
    // The bar overlays the column, not the document viewport, so iOS
    // rubber-band still cannot carry it away (SK-143).
    expect(SHARED_BOTTOM).toContain('overlay: "absolute inset-x-0 bottom-0 pointer-events-none"');
    expect(GLOBALS).toMatch(
      /\.sk-bottom-nav-inset\s*\{[\s\S]*?padding-bottom:\s*calc\(\s*var\(--sk-bottom-nav-inset, 0px\) \+ var\(--sk-dock-inset, 0px\)\s*\);/,
    );
  });

  it("overlays the glass nav on the scroller instead of fixing it to the document viewport", () => {
    expect(BOTTOM).toContain('position="overlay"');
    expect(SHARED_BOTTOM).toContain(
      '"fixed inset-x-0 top-[var(--sk-viewport-offset-top,0px)] flex h-[var(--sk-viewport-height,100dvh)] items-end pointer-events-none"',
    );
    expect(SHARED_BOTTOM).toContain('overlay: "absolute inset-x-0 bottom-0 pointer-events-none"');
    expect(SHARED_BOTTOM).toContain('"in-flow": "relative"');
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
    expect(GLOBALS).toMatch(
      /\.liquid-glass-bottom-nav__glass\s*\{[\s\S]*?grid-template-columns:\s*repeat\(var\(--sk-nav-column-count\),\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(GLOBALS).toContain(".liquid-glass-bottom-nav__lens");
  });

  // SK-306. The bar takes no colour of its own: it frosts the page behind it,
  // so its tint and ink follow the page surface instead of the dark sidebar
  // chrome, and page content stays visible through it.
  it("frosts the page through a colourless, theme-following pill", () => {
    expect(SHARED_BOTTOM).toContain('className="liquid-glass-bottom-nav__pane"');
    expect(SHARED_BOTTOM).toContain('className="liquid-glass-bottom-nav__rim"');
    expect(SHARED_BOTTOM).toContain("liquid-glass-bottom-nav__stack");
    expect(SHARED_BOTTOM).toContain('const NAV_INK = "rgb(var(--sk-nav-glass-ink))"');
    expect(SHARED_BOTTOM).not.toContain("--fg-onsidebar");

    expect(GLOBALS).toContain("--sk-nav-glass-tint: var(--bg-elevated);");
    expect(GLOBALS).toContain("--sk-nav-glass-ink: var(--fg-default);");
    expect(GLOBALS).toContain(
      "background: rgb(var(--sk-nav-glass-tint) / var(--sk-nav-glass-alpha));",
    );
    expect(GLOBALS).toMatch(
      /\.liquid-glass-bottom-nav__glass\s*\{[\s\S]*?background:\s*transparent;/,
    );
    // The pane must stay a sibling of the tab row: an element with
    // backdrop-filter is a backdrop root, so a nested rim would sample the
    // pane instead of the page.
    const paneIndex = SHARED_BOTTOM.indexOf('className="liquid-glass-bottom-nav__pane"');
    const navIndex = SHARED_BOTTOM.indexOf("<nav");
    expect(paneIndex).toBeGreaterThan(0);
    expect(paneIndex).toBeLessThan(navIndex);
  });

  // The refraction rim re-filters the page + pane composite in an edge band,
  // so the boundary bends light instead of ending in a flat border.
  it("carries an edge-refraction rim and a press-growth scale", () => {
    expect(GLOBALS).toMatch(
      /\.liquid-glass-bottom-nav__rim\s*\{[\s\S]*?backdrop-filter:\s*blur\(1\.5px\)\s*saturate\(1\.7\)\s*brightness\(var\(--sk-nav-rim-lift\)\)/,
    );
    expect(GLOBALS).toContain("-webkit-mask-image:");
    expect(GLOBALS).toContain("--sk-nav-press-scale: 1.038;");
    expect(GLOBALS).toContain("--sk-nav-press-scale: 0.975;");
    expect(GLOBALS).toContain("transform: scale(var(--sk-nav-press-scale));");
    expect(GLOBALS).toMatch(
      /:has\(\s*\.liquid-glass-bottom-nav__glass\[data-interacting="true"\]\s*\)/,
    );
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

  // SK-306 A. Gili asked for the brand amber out of the tab bar. The active
  // tab now reads through the frosted capsule, weight and icon stroke, so the
  // only --brand-primary left in the surface is the accessibility focus ring.
  it("tints no tab with the brand colour, but keeps the focus ring", () => {
    expect(SHARED_BOTTOM).toContain(
      "focus-visible:ring-[rgb(var(--brand-primary))]",
    );
    expect(SHARED_BOTTOM.match(/--brand-primary/g)).toHaveLength(1);
    expect(SHARED_BOTTOM).not.toContain('color: tab.active');
    // The lens capsule carries the active state now, so it must stay — and
    // the tab must not draw a second one on top of it.
    expect(GLOBALS).toMatch(
      /\.liquid-glass-bottom-nav__lens::before\s*\{[\s\S]*?radial-gradient/,
    );
    expect(GLOBALS).not.toMatch(
      /\.liquid-glass-bottom-nav__tab\[data-active="true"\]::before\s*\{/,
    );
    expect(GLOBALS).not.toContain(".liquid-glass-bottom-nav__lens::after");
  });

  // The selected capsule slides between tabs. Its position rides on a custom
  // property, and an unregistered one is a discrete value — the transition
  // that used to sit on the lens interpolated nothing and the capsule
  // teleported. Registering the property is the whole fix.
  it("glides the selected capsule instead of teleporting it", () => {
    expect(GLOBALS).toMatch(
      /@property --sk-nav-lens-x\s*\{[\s\S]*?syntax: "<length>";[\s\S]*?inherits: true;/,
    );
    expect(GLOBALS).toContain("--sk-nav-lens-x 440ms var(--ease-out-strong)");
    // A tap glides; only a resolved horizontal drag pins it to the finger.
    expect(SHARED_BOTTOM).toContain('dataset.tracking = "true"');
    expect(SHARED_BOTTOM).toContain('nav.dataset.tracking = "false"');
    expect(GLOBALS).toMatch(
      /\.liquid-glass-bottom-nav__glass\[data-tracking="true"\]\s*\{\s*transition: transform/,
    );
    // Behind the tabs, or it washes out the label it is meant to emphasise.
    expect(GLOBALS).toMatch(/\.liquid-glass-bottom-nav__lens\s*\{[\s\S]*?z-index: 0;/);
  });

  // SK-306 B. Dropping the pane's alpha is what makes the page visible through
  // the bar; the tint-coloured halo is what stops that costing legibility.
  // Measured over black, white, flat purple, flat amber and hard stripes in
  // both themes, every case beats the alpha-0.54 bar it replaces.
  it("buys transparency back with a self-hiding halo rather than more alpha", () => {
    expect(GLOBALS).toContain("--sk-nav-glass-alpha: 0.30;");
    expect(GLOBALS).toContain("--sk-nav-glass-alpha: 0.32;");
    expect(GLOBALS).toMatch(
      /\.liquid-glass-bottom-nav__label\s*\{\s*text-shadow:[\s\S]*?rgb\(var\(--sk-nav-glass-tint\)/,
    );
    expect(GLOBALS).toMatch(
      /\.liquid-glass-bottom-nav__icon\s*\{\s*filter: drop-shadow\([\s\S]*?--sk-nav-glass-tint/,
    );
  });

  // SK-306 C. The one layer that actually moves the page's pixels. It has to
  // stay a *sibling* of the pane and paint before it, and it has to fail
  // invisibly: the neutral grey flood under the map means a browser that
  // never draws the feImage displaces nothing at all, rather than shoving the
  // backdrop sideways by half the scale.
  it("adds the displacement warp as a sibling that degrades to nothing", () => {
    expect(SHARED_BOTTOM).toContain("liquid-glass-bottom-nav__warp");
    expect(SHARED_BOTTOM).toContain("feDisplacementMap");
    expect(SHARED_BOTTOM).toContain('xChannelSelector="R"');
    expect(SHARED_BOTTOM).toContain('colorInterpolationFilters="sRGB"');
    const flood = SHARED_BOTTOM.indexOf("<feFlood");
    const image = SHARED_BOTTOM.indexOf("<feImage");
    expect(flood).toBeGreaterThan(0);
    expect(flood).toBeLessThan(image);
    const warp = SHARED_BOTTOM.indexOf("liquid-glass-bottom-nav__warp");
    const pane = SHARED_BOTTOM.indexOf('className="liquid-glass-bottom-nav__pane"');
    expect(warp).toBeLessThan(pane);
    expect(GLOBALS).toMatch(
      /\.liquid-glass-bottom-nav__warp\s*\{[\s\S]*?z-index: 0;/,
    );
  });

  // SK-306 D. The bar breathes so it reads as a live surface. The breath uses
  // the standalone `scale` property so it composes with the press `transform`
  // instead of overwriting it, and it never touches the tab row — keeping the
  // icons and labels still means they never re-rasterise.
  it("breathes on the glass layers only, and stands down under a finger", () => {
    expect(GLOBALS).toMatch(
      /@keyframes liquid-glass-bottom-nav-breath\s*\{\s*from \{ scale: 1; \}/,
    );
    const breathRule = GLOBALS.match(
      /\.liquid-glass-bottom-nav__pane,\n\s{4}\.liquid-glass-bottom-nav__rim \{\n\s{6}animation: liquid-glass-bottom-nav-breath[^\n]*\n/,
    );
    expect(breathRule).not.toBeNull();
    // The tab row must be excluded from the breath: exactly one rule applies
    // it, and the match above proves that rule lists only the pane and rim.
    expect(GLOBALS.match(/animation: liquid-glass-bottom-nav-breath/g)).toHaveLength(1);
    expect(GLOBALS).toMatch(
      /:is\(\.liquid-glass-bottom-nav__pane, \.liquid-glass-bottom-nav__rim\) \{\n\s+animation: none;/,
    );
    // Growing and settling are asymmetric on purpose.
    expect(GLOBALS).toContain("transition: transform 420ms var(--ease-out-strong);");
    expect(GLOBALS).toContain("transition: transform 220ms var(--ease-press);");
  });

  it("keeps a static active treatment when reduced motion is requested", () => {
    // The lens is the selected state now, so reduced motion keeps it visible
    // and merely stops it sliding. Only the magnifier goes.
    expect(GLOBALS).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.liquid-glass-bottom-nav__magnifier \{\n\s+display: none !important;/,
    );
    expect(GLOBALS).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.liquid-glass-bottom-nav__lens,\n\s+\.liquid-glass-bottom-nav__lens::before \{\n\s+transition: none !important;/,
    );
    expect(GLOBALS).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*--sk-nav-press-scale: 1 !important;/,
    );
    // The breath has to die with the press scale, not just the transition.
    expect(GLOBALS).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.liquid-glass-bottom-nav__warp,[\s\S]*?animation: none !important;\n\s+scale: none !important;/,
    );
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
