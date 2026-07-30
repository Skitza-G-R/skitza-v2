import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindPostcss from "@tailwindcss/postcss";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const globalsSrc = readFileSync(join(here, "..", "globals.css"), "utf8");
const layoutSrc = readFileSync(join(here, "..", "layout.tsx"), "utf8");
const pricingStepSrc = readFileSync(
  join(
    here,
    "..",
    "(producer)",
    "dashboard",
    "store",
    "editor-steps",
    "pricing-step.tsx",
  ),
  "utf8",
);
const uploadProofSrc = readFileSync(
  join(
    here,
    "..",
    "..",
    "components",
    "artist",
    "purchase",
    "upload-proof-screen.tsx",
  ),
  "utf8",
);
const skipLinkSrc = readFileSync(
  join(here, "..", "..", "components", "a11y", "skip-to-content.tsx"),
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

describe("global accessibility contract", () => {
  it("keeps the keyboard skip link at least 44px tall when it appears", () => {
    const skipLinkRule = globalsSrc.match(/\.skip-to-content\s*\{([\s\S]*?)\}/)?.[1];

    expect(skipLinkRule).toBeDefined();
    expect(skipLinkRule).toMatch(/min-height:\s*44px/);
  });

  it("uses high-contrast on-brand text on the amber skip link", () => {
    const skipLinkRule = globalsSrc.match(/\.skip-to-content\s*\{([\s\S]*?)\}/)?.[1];

    expect(skipLinkRule).toBeDefined();
    expect(skipLinkRule).toMatch(/color:\s*rgb\(var\(--fg-on-brand\)\)/);
  });

  it("moves focus into the main content after activation", () => {
    expect(skipLinkSrc).toContain('getElementById("main-content")');
    expect(skipLinkSrc).toMatch(/\.focus\(/);
  });

  it("prevents iPhone form focus zoom without disabling pinch zoom", async () => {
    const phoneTextControlRule = globalsSrc.match(
      /\/\* SK-156[\s\S]*?@media \(max-width: 1023px\) \{([\s\S]*?)\n\}/,
    )?.[1];
    const productionCss = await postcss([
      tailwindPostcss({
        base: join(here, "..", "..", ".."),
        optimize: true,
      }),
    ]).process(globalsSrc, {
      from: join(here, "..", "globals.production-test.css"),
    });
    const optimizedPhoneRule = productionCss.css.match(
      /@media \(max-width:1023px\)\{input:not\(\[type\]\),[\s\S]*?textarea:not\(\[hidden\]\)\{([^}]*)\}\}/,
    )?.[1];

    expect(phoneTextControlRule).toBeDefined();
    expect(phoneTextControlRule).toContain("input:not([type])");
    expect(phoneTextControlRule).toContain('input[type="text"]');
    expect(phoneTextControlRule).toContain('input[type="search"]');
    expect(phoneTextControlRule).toContain('input[type="tel"]');
    expect(phoneTextControlRule).toContain('input[type="date"]');
    expect(phoneTextControlRule).toContain('input[type="datetime-local"]');
    expect(phoneTextControlRule).toContain("select:not([hidden])");
    expect(phoneTextControlRule).toContain("textarea:not([hidden])");
    expect(phoneTextControlRule).toMatch(
      /font-size:\s*max\(\s*16px,\s*var\(--sk-mobile-control-font-size,\s*1em\)\s*\)\s*!important/,
    );
    expect(phoneTextControlRule).not.toContain('input[type="checkbox"]');
    expect(phoneTextControlRule).not.toContain('input[type="radio"]');
    expect(phoneTextControlRule).not.toContain('input[type="range"]');
    expect(phoneTextControlRule).not.toContain('input[type="file"]');
    expect(optimizedPhoneRule).toBeDefined();
    expect(optimizedPhoneRule).toMatch(
      /font-size:max\(16px,\s*var\(--sk-mobile-control-font-size,1em\)\)!important/,
    );

    expect(layoutSrc).toContain("maximumScale: 5");
    expect(layoutSrc).toContain("userScalable: true");
    expect(layoutSrc).toContain("[--sk-mobile-control-font-size:22px]");
    expect(pricingStepSrc).toContain(
      "[--sk-mobile-control-font-size:19px]",
    );
    expect(uploadProofSrc).toContain(
      "[--sk-mobile-control-font-size:28px]",
    );
  });
});
