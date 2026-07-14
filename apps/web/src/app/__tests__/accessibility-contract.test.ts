import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const globalsSrc = readFileSync(join(here, "..", "globals.css"), "utf8");
const skipLinkSrc = readFileSync(
  join(here, "..", "..", "components", "a11y", "skip-to-content.tsx"),
  "utf8",
);

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
});
