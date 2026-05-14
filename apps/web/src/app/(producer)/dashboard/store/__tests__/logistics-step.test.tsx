import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  customMinutesFromDuration,
  parsePresetFromDuration,
} from "../editor-steps/logistics-step";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "editor-steps", "logistics-step.tsx"), "utf8");

describe("LogisticsStep shell", () => {
  it("does NOT import the toggle component (no on/off here)", () => {
    expect(SRC).not.toMatch(/from\s+["']\.\.\/toggle["']/);
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

  it("renders the four duration chip labels (1 hr / 2 hr / 3 hr / Custom)", () => {
    expect(SRC).toMatch(/"1 hr"/);
    expect(SRC).toMatch(/"2 hr"/);
    expect(SRC).toMatch(/"3 hr"/);
    expect(SRC).toMatch(/"Custom"/);
  });

  it("each duration chip emits a '{N} min' string up the onChange", () => {
    expect(SRC).toMatch(/duration:\s*"60 min"/);
    expect(SRC).toMatch(/duration:\s*"120 min"/);
    expect(SRC).toMatch(/duration:\s*"180 min"/);
  });

  it("custom chip emits empty string so canContinue blocks until a number is typed", () => {
    // The Custom click handler clears the duration to "".
    expect(SRC).toMatch(/duration:\s*""/);
  });

  it("clamps the revisions stepper to 0..20", () => {
    expect(SRC).toMatch(/max=\{20\}|max:\s*20/);
    expect(SRC).toMatch(/min=\{0\}|min:\s*0/);
  });

  it("no longer mentions the dropped multi-session option", () => {
    expect(SRC).not.toMatch(/multi-session/);
  });

  it("renders an Unlimited toggle button beside the revisions stepper", () => {
    expect(SRC).toMatch(/Unlimited/);
    expect(SRC).toMatch(/unlimitedRevisions/);
    expect(SRC).toMatch(/aria-pressed=\{unlimitedRevisions\}/);
  });

  it("shows ∞ in the stepper when unlimitedRevisions is true", () => {
    expect(SRC).toMatch(/display:\s*"∞"/);
  });

  it("disables the stepper when unlimitedRevisions is true", () => {
    expect(SRC).toMatch(/disabled=\{unlimitedRevisions\}/);
  });

  it("toggles the unlimitedRevisions flag on click", () => {
    expect(SRC).toMatch(/onChange\(\{\s*unlimitedRevisions:\s*!unlimitedRevisions/);
  });
});

describe("parsePresetFromDuration", () => {
  it("maps the three canonical hour values", () => {
    expect(parsePresetFromDuration("60 min")).toBe("1hr");
    expect(parsePresetFromDuration("120 min")).toBe("2hr");
    expect(parsePresetFromDuration("180 min")).toBe("3hr");
  });

  it("returns 'custom' for an empty string", () => {
    expect(parsePresetFromDuration("")).toBe("custom");
  });

  it("returns 'custom' for any non-canonical minute value", () => {
    expect(parsePresetFromDuration("45 min")).toBe("custom");
    expect(parsePresetFromDuration("90 min")).toBe("custom");
  });
});

describe("customMinutesFromDuration", () => {
  it("returns empty string for the canonical chip values", () => {
    expect(customMinutesFromDuration("60 min")).toBe("");
    expect(customMinutesFromDuration("120 min")).toBe("");
    expect(customMinutesFromDuration("180 min")).toBe("");
  });

  it("returns empty string for empty input", () => {
    expect(customMinutesFromDuration("")).toBe("");
  });

  it("extracts the numeric portion of a non-canonical '{N} min' string", () => {
    expect(customMinutesFromDuration("45 min")).toBe("45");
    expect(customMinutesFromDuration("90 min")).toBe("90");
  });
});
