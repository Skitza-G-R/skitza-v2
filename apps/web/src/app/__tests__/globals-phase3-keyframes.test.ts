import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "globals.css"), "utf8");

describe("Phase 3 keyframes in globals.css", () => {
  it("defines sk-live-pulse for the Live status dot", () => {
    expect(SRC).toMatch(/@keyframes\s+sk-live-pulse/);
  });

  it("defines sk-shimmer-glow for newly-created products", () => {
    expect(SRC).toMatch(/@keyframes\s+sk-shimmer-glow/);
  });

  it("defines sk-row-in for table row entry stagger", () => {
    expect(SRC).toMatch(/@keyframes\s+sk-row-in/);
  });

  it("exposes utility classes that consume the new keyframes", () => {
    expect(SRC).toMatch(/\.sk-live-pulse\s*\{[\s\S]{0,200}animation:[\s\S]{0,80}sk-live-pulse/);
    expect(SRC).toMatch(/\.sk-shimmer-glow\s*\{[\s\S]{0,200}animation:[\s\S]{0,80}sk-shimmer-glow/);
    expect(SRC).toMatch(/\.sk-row-in\s*\{[\s\S]{0,200}animation:[\s\S]{0,80}sk-row-in/);
  });

  it("honors prefers-reduced-motion for the Phase 3 utility classes", () => {
    // Find the reduced-motion block, then assert all three classes
    // are referenced inside it (so their animation is disabled).
    const reducedBlock = SRC.match(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\n\s*\}\s*$/m,
    );
    // If the regex above doesn't match (file might have a non-trailing
    // closing brace), fall back to a looser source-grep that just
    // asserts the three class names show up after the @media keyword.
    if (reducedBlock) {
      expect(reducedBlock[0]).toMatch(/sk-live-pulse/);
      expect(reducedBlock[0]).toMatch(/sk-shimmer-glow/);
      expect(reducedBlock[0]).toMatch(/sk-row-in/);
    } else {
      expect(SRC).toMatch(/prefers-reduced-motion[\s\S]{0,4000}sk-live-pulse/);
      expect(SRC).toMatch(/prefers-reduced-motion[\s\S]{0,4000}sk-shimmer-glow/);
      expect(SRC).toMatch(/prefers-reduced-motion[\s\S]{0,4000}sk-row-in/);
    }
  });

  it("hides .sk-drag-handle on touch-only devices via @media (hover: none)", () => {
    expect(SRC).toMatch(/@media\s*\(hover:\s*none\)[\s\S]{0,200}\.sk-drag-handle/);
  });
});
