import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Phase C shipped five reusable motion primitives plus matching
// reduced-motion neutralisation. This test reads globals.css and
// asserts each class exists *and* has its @media guard — if someone
// adds a primitive but forgets the reduce gate (an accessibility
// regression), this catches it in CI rather than on the user.

const GLOBALS_CSS = readFileSync(
  fileURLToPath(new URL("../globals.css", import.meta.url)),
  "utf8",
);

// Extract the `@media (prefers-reduced-motion: reduce)` block so we
// can assert each primitive's neutralisation lives there specifically.
// Matches the last reduce block in the file (there may be more than
// one — we care about the motion-primitives one which is last).
function extractReduceBlock(): string {
  const blocks = [...GLOBALS_CSS.matchAll(
    /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n {2}\}/g,
  )];
  // Concatenate every reduce block so we catch selectors split across
  // multiple blocks (current file has three).
  return blocks.map((m) => m[1] ?? "").join("\n");
}

describe("Phase C motion primitives", () => {
  const reduceBlock = extractReduceBlock();

  it("defines .sk-lift with a :hover transform", () => {
    expect(GLOBALS_CSS).toMatch(/\.sk-lift\s*\{/);
    expect(GLOBALS_CSS).toMatch(/\.sk-lift:hover\s*\{[\s\S]*translateY\(-1px\)/);
  });

  it("defines .sk-pop and .sk-pop-center with pop-in keyframe", () => {
    expect(GLOBALS_CSS).toMatch(/\.sk-pop\s*\{/);
    expect(GLOBALS_CSS).toMatch(/\.sk-pop-center\s*\{/);
    expect(GLOBALS_CSS).toMatch(/@keyframes skitza-pop-in\b/);
  });

  it("defines .sk-cta-shine with a diagonal shine keyframe", () => {
    expect(GLOBALS_CSS).toMatch(/\.sk-cta-shine\s*\{/);
    expect(GLOBALS_CSS).toMatch(/@keyframes skitza-cta-shine\b/);
    expect(GLOBALS_CSS).toMatch(/\.sk-cta-shine:hover::after/);
  });

  it("defines .sk-pulse-hover wired to the existing pulse-glow keyframe", () => {
    expect(GLOBALS_CSS).toMatch(/\.sk-pulse-hover:hover\s*\{[\s\S]*skitza-pulse-glow/);
  });

  // Each Phase C primitive MUST have a reduce gate. Losing any of
  // these is an a11y regression — the test covers each one.
  it.each([
    ".sk-lift",
    ".sk-pop",
    ".sk-pop-center",
    ".sk-cta-shine",
    ".sk-pulse-hover",
  ])("respects prefers-reduced-motion for %s", (selector) => {
    expect(reduceBlock).toContain(selector);
  });
});
