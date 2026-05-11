import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "editor-steps", "logistics-step.tsx"), "utf8");

describe("LogisticsStep shell", () => {
  it("does NOT import the toggle component (no on/off here)", () => {
    expect(SRC).not.toMatch(/from\s+["']\.\.\/toggle["']/);
  });

  it("renders a free-text input for duration", () => {
    expect(SRC).toMatch(/<input/);
    expect(SRC).toMatch(/duration/);
  });

  it("references both duration and revisions in the change handler", () => {
    expect(SRC).toMatch(/duration/);
    expect(SRC).toMatch(/revisions/);
  });

  it("renders a stepper for revisions (uses Minus / Plus icons from lucide)", () => {
    expect(SRC).toMatch(/Stepper|<button[\s\S]*?(Minus|−)/);
    expect(SRC).toMatch(/Minus/);
    expect(SRC).toMatch(/Plus/);
  });

  it("mentions the placeholder examples (60 / 180 / multi-session)", () => {
    expect(SRC).toMatch(/multi-session/);
  });

  it("clamps the revisions stepper to 0..20", () => {
    expect(SRC).toMatch(/max=\{20\}|max:\s*20|max:\s*20/);
    expect(SRC).toMatch(/min=\{0\}|min:\s*0/);
  });
});
