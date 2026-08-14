import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import tailwindPostcss from "@tailwindcss/postcss";
import { describe, expect, it } from "vitest";

import { calculateNativeViewportMetrics } from "../native-viewport";
import { isCompletedBackSwipe } from "../use-native-navigation";

const globalsCss = readFileSync(
  fileURLToPath(new URL("../../../app/globals.css", import.meta.url)),
  "utf8",
);
const webRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const productionCssPath = fileURLToPath(
  new URL("../../../app/globals.production-test.css", import.meta.url),
);
const flowSource = readFileSync(
  fileURLToPath(new URL("../native-full-screen-flow.tsx", import.meta.url)),
  "utf8",
);
const appShellSource = readFileSync(
  fileURLToPath(new URL("../../shell/app-shell.tsx", import.meta.url)),
  "utf8",
);
const artistAppShellSource = readFileSync(
  fileURLToPath(new URL("../../artist/artist-app-shell.tsx", import.meta.url)),
  "utf8",
);
const nativeViewportSource = readFileSync(
  fileURLToPath(new URL("../native-viewport.tsx", import.meta.url)),
  "utf8",
);
const playerSource = readFileSync(
  fileURLToPath(new URL("../../audio/persistent-player.tsx", import.meta.url)),
  "utf8",
);
const tailwindRequire = createRequire(
  createRequire(import.meta.url).resolve("@tailwindcss/postcss"),
);
interface ParsedCssNode {
  type: string;
  name?: string;
  params?: string;
  parent?: ParsedCssNode;
}

interface ParsedCssDeclaration extends ParsedCssNode {
  prop?: string;
  value?: string;
}

interface ParsedCssRule extends ParsedCssNode {
  selector: string;
  nodes?: ParsedCssDeclaration[];
}

const postcss = tailwindRequire("postcss") as {
  (plugins: unknown[]): {
    process: (css: string, options: { from: string }) => Promise<{ css: string }>;
  };
  parse: (css: string) => {
    walkRules: (callback: (rule: ParsedCssRule) => void) => void;
  };
};

describe("native viewport metrics", () => {
  it("tracks a visible software keyboard", () => {
    expect(
      calculateNativeViewportMetrics({
        innerHeight: 844,
        viewportHeight: 520,
        viewportOffsetTop: 0,
      }),
    ).toEqual({
      height: 520,
      layoutTop: 0,
      layoutHeight: 520,
      offsetTop: 0,
      keyboardInset: 324,
      keyboardOpen: true,
    });

    expect(
      calculateNativeViewportMetrics({
        innerHeight: 844,
        viewportHeight: 520,
        viewportOffsetTop: 59,
      }),
    ).toEqual({
      height: 520,
      layoutTop: 59,
      layoutHeight: 520,
      offsetTop: 59,
      keyboardInset: 265,
      keyboardOpen: true,
    });
  });

  it("does not mistake small browser chrome changes for a keyboard", () => {
    expect(
      calculateNativeViewportMetrics({
        innerHeight: 844,
        viewportHeight: 800,
        viewportOffsetTop: 0,
      }),
    ).toMatchObject({
      height: 800,
      keyboardInset: 0,
      keyboardOpen: false,
    });
  });

  it("keeps a full-screen layout through a non-keyboard Home Indicator gap", () => {
    expect(
      calculateNativeViewportMetrics({
        innerHeight: 812,
        viewportHeight: 770,
        viewportOffsetTop: 0,
      }),
    ).toMatchObject({
      height: 770,
      layoutTop: 0,
      layoutHeight: 812,
      keyboardInset: 0,
      keyboardOpen: false,
    });
  });

  it("does not rewrite page scroll range during visual-viewport movement", () => {
    expect(nativeViewportSource).not.toContain("calculateNativeViewportGrowth");
    expect(nativeViewportSource).not.toContain("--sk-viewport-growth");
  });
});

describe("native navigation motion", () => {
  it("commits a clear LTR or RTL leading-edge back swipe", () => {
    expect(
      isCompletedBackSwipe({
        deltaX: 90,
        deltaY: 12,
        direction: 1,
        threshold: 72,
      }),
    ).toBe(true);
    expect(
      isCompletedBackSwipe({
        deltaX: -90,
        deltaY: 12,
        direction: -1,
        threshold: 72,
      }),
    ).toBe(true);
  });

  it("rejects short and primarily vertical gestures", () => {
    expect(
      isCompletedBackSwipe({
        deltaX: 60,
        deltaY: 4,
        direction: 1,
        threshold: 72,
      }),
    ).toBe(false);
    expect(
      isCompletedBackSwipe({
        deltaX: 90,
        deltaY: 85,
        direction: 1,
        threshold: 72,
      }),
    ).toBe(false);
  });

  it("uses Radix semantics and an opt-in edge swipe in the flow surface", () => {
    expect(flowSource).toContain("DialogPrimitive.Content");
    expect(flowSource).toContain("DialogPrimitive.Title");
    expect(flowSource).toContain("DialogPrimitive.Description");
    expect(flowSource).toContain("useSwipeBack");
    expect(flowSource).toContain('data-native-full-screen-flow=""');
  });

  it("stays fluid at 360/390px and constrains the desktop reference state", () => {
    expect(flowSource).toContain("fixed inset-x-0 z-[71] flex w-full flex-col");
    expect(flowSource).toContain("md:max-w-3xl");
    expect(flowSource).toContain("md:rounded-[var(--radius-xl)]");
  });
});

describe("native CSS contracts", () => {
  it("supports notch, Home Indicator, keyboard, and dynamic viewport values", () => {
    expect(globalsCss).toContain("--sk-viewport-height: 100dvh");
    expect(globalsCss).toContain("--sk-keyboard-inset: 0px");
    expect(globalsCss).toContain("env(safe-area-inset-top, 0px)");
    expect(globalsCss).toContain("env(safe-area-inset-bottom, 0px)");
    expect(globalsCss).toContain(".sk-native-full-screen-flow");
    expect(globalsCss).toContain(".sk-native-action-dock");
  });

  it("keeps both app footers inside the paintable installed-iPhone viewport", async () => {
    expect(appShellSource).toContain("sk-producer-app-shell");
    expect(artistAppShellSource).toContain("sk-artist-app-shell");

    const productionCss = await postcss([
      tailwindPostcss({ base: webRoot, optimize: true }),
    ]).process(globalsCss, { from: productionCssPath });
    const producerShellRules: ParsedCssRule[] = [];
    const artistShellRules: ParsedCssRule[] = [];
    postcss.parse(productionCss.css).walkRules((rule) => {
      const selectors = rule.selector
        .split(",")
        .map((selector) => selector.trim());
      if (selectors.includes(".sk-producer-app-shell")) {
        producerShellRules.push(rule);
      }
      if (selectors.includes(".sk-artist-app-shell")) {
        artistShellRules.push(rule);
      }
    });
    const standaloneShellRule = producerShellRules[0];
    const shellDeclarations = Object.fromEntries(
      (standaloneShellRule?.nodes ?? [])
        .filter(
          (node): node is ParsedCssDeclaration & { prop: string; value: string } =>
            node.type === "decl" && typeof node.prop === "string" && typeof node.value === "string",
        )
        .map((node) => [node.prop, node.value]),
    );
    const keyboardShellRule = productionCss.css.match(
      /body\[data-sk-keyboard=open\] \.sk-producer-app-shell\{([^}]*)\}/,
    )?.[1];

    expect(producerShellRules).toHaveLength(1);
    expect(artistShellRules).toHaveLength(1);
    expect(artistShellRules[0]).toBe(standaloneShellRule);
    expect(standaloneShellRule).toBeDefined();
    expect(standaloneShellRule?.parent).toMatchObject({
      type: "atrule",
      name: "media",
      params: "(display-mode:standalone) and (max-width:1023px)",
    });
    expect(shellDeclarations).toMatchObject({
      inset: "0 0 auto",
      height: "var(--sk-viewport-height,100dvh)",
      "max-height": "var(--sk-viewport-height,100dvh)",
    });
    expect(Object.values(shellDeclarations).join(" ")).not.toContain("100vh");
    expect(keyboardShellRule).toBeUndefined();
    expect(nativeViewportSource).not.toContain("--sk-viewport-bottom");
    expect(nativeViewportSource).toContain(
      'setProperty("--sk-layout-viewport-top", `${String(metrics.layoutTop)}px`)',
    );
    expect(nativeViewportSource).toContain(
      'setProperty("--sk-layout-viewport-height", `${String(metrics.layoutHeight)}px`)',
    );
    expect(productionCss.css).toContain(".sk-producer-app-shell .persistent-player-dock");
    expect(productionCss.css).not.toContain(".sk-producer-app-shell .mobile-full-player-sheet");
    expect(productionCss.css).toContain(
      ".sk-artist-app-shell .persistent-player-dock",
    );
    expect(productionCss.css).not.toContain(
      ".sk-artist-app-shell .mobile-full-player-sheet",
    );
    expect(productionCss.css).toContain("position:absolute");
    expect(playerSource).toContain('top: "var(--sk-layout-viewport-top, 0px)"');
    expect(playerSource).toContain('height: "var(--sk-layout-viewport-height, 100dvh)"');
    expect(playerSource).toContain("createPortal(");

    const sheetRules: ParsedCssRule[] = [];
    postcss.parse(productionCss.css).walkRules((rule) => {
      if (
        rule.selector === ".mobile-full-player-sheet" ||
        rule.selector.startsWith(".mobile-full-player-sheet[data-player-state=")
      ) {
        sheetRules.push(rule);
      }
    });
    const sheetDeclarations = sheetRules.map((rule) =>
      Object.fromEntries(
        (rule.nodes ?? [])
          .filter(
            (node): node is ParsedCssDeclaration & { prop: string; value: string } =>
              node.type === "decl" &&
              typeof node.prop === "string" &&
              typeof node.value === "string",
          )
          .map((node) => [node.prop, node.value]),
      ),
    );
    expect(sheetDeclarations).toContainEqual(expect.objectContaining({ visibility: "hidden" }));
    expect(sheetDeclarations).toContainEqual(expect.objectContaining({ visibility: "visible" }));

    // Current iOS standalone can expose a 402 x 874 physical screen while
    // only 812 CSS pixels are paintable. The shell must end at 812 rather
    // than selecting classic 100vh (874) and clipping the 68px nav row.
    expect(
      calculateNativeViewportMetrics({
        innerHeight: 812,
        viewportHeight: 812,
        viewportOffsetTop: 0,
      }),
    ).toMatchObject({
      height: 812,
      offsetTop: 0,
      keyboardOpen: false,
    });
  });

  it("gates directional flow and progress motion for reduced-motion users", () => {
    const reduceBlocks = [
      ...globalsCss.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n {2}\}/g),
    ]
      .map((match) => match[1] ?? "")
      .join("\n");

    expect(reduceBlocks).toContain(".sk-native-flow-motion");
    expect(reduceBlocks).toContain(".sk-native-spinner");
  });

  it("animates the PWA startup mark with CSS and keeps reduced motion still", () => {
    const motionBlocks = [
      ...globalsCss.matchAll(
        /@media \(prefers-reduced-motion: no-preference\) \{([\s\S]*?)\n {2}\}/g,
      ),
    ]
      .map((match) => match[1] ?? "")
      .join("\n");
    const reduceBlocks = [
      ...globalsCss.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n {2}\}/g),
    ]
      .map((match) => match[1] ?? "")
      .join("\n");

    expect(globalsCss).toContain("@keyframes skitza-pwa-startup-float");
    expect(globalsCss).toContain("@keyframes skitza-pwa-startup-pulse");
    expect(motionBlocks).toContain(".sk-pwa-startup__mark");
    expect(motionBlocks).toContain("animation: skitza-pwa-startup-float");
    expect(reduceBlocks).toContain(".sk-pwa-startup__mark");
    expect(reduceBlocks).toContain("animation: none");
  });

  it("provides immediate coarse-pointer feedback and comfortable targets", () => {
    expect(globalsCss).toMatch(
      /\.sk-press:active,\s*\.sk-press\[data-sk-nav-pending\]\s*\{[\s\S]*transition-duration:\s*60ms/,
    );
    expect(globalsCss).toContain("@media (pointer: coarse)");
    expect(globalsCss).toContain("min-width: 44px");
    expect(globalsCss).toContain("min-height: 44px");
  });

  it("keeps opted-in mobile sheets centered in optimized production CSS", async () => {
    const productionCss = await postcss([
      tailwindPostcss({ base: webRoot, optimize: true }),
    ]).process(globalsCss, { from: productionCssPath });
    const sheetRule = productionCss.css.match(/\.sk-sheet-mobile\{([^}]*)\}/)?.[1];

    expect(sheetRule).toBeDefined();
    expect(sheetRule).toContain("position:fixed");
    expect(sheetRule).toContain("inset:auto 0 0");
    expect(sheetRule).toContain("width:100%");
    expect(sheetRule).toContain("translate:var(--sk-sheet-mobile-translate,0px)");
  });
});
