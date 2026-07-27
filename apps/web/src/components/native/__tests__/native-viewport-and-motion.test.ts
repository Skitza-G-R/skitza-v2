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
const tailwindRequire = createRequire(
  createRequire(import.meta.url).resolve("@tailwindcss/postcss"),
);
const postcss = tailwindRequire("postcss") as (plugins: unknown[]) => {
  process: (
    css: string,
    options: { from: string },
  ) => Promise<{ css: string }>;
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
      offsetTop: 0,
      keyboardInset: 324,
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
    expect(flowSource).toContain(
      "fixed inset-x-0 z-[71] flex w-full flex-col",
    );
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

  it("gates directional flow and progress motion for reduced-motion users", () => {
    const reduceBlocks = [
      ...globalsCss.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n {2}\}/g),
    ]
      .map((match) => match[1] ?? "")
      .join("\n");

    expect(reduceBlocks).toContain(".sk-native-flow-motion");
    expect(reduceBlocks).toContain(".sk-native-spinner");
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
