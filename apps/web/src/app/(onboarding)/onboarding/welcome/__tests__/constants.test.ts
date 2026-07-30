import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { nextRouteAfterWelcome } from "../constants";

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "page.tsx"),
  "utf8",
);

// Step 0 — Welcome screen.
//
// Welcome is the new entry to the wizard introduced by the May 2026
// redesign. It sits BEFORE Step 1 (studio) and is not counted in the
// shell's "Step N of 6" numbering — it's a context-set screen, not a
// data-capture step. Tapping the "Start setting up" CTA advances the
// producer to Step 1 (/onboarding/studio).

describe("welcome constants — Step 0 of the producer onboarding wizard", () => {
  it('"Start setting up" CTA routes to /onboarding/studio (Step 1)', () => {
    expect(nextRouteAfterWelcome()).toBe("/onboarding/studio");
  });

  it("starts with the real account-created win and a saved-progress promise", () => {
    expect(source).toContain("Account created");
    expect(source).toMatch(/progress is saved/i);
    expect(source).toMatch(/public page/i);
  });

  it("does not make the old two-minute or payment promise", () => {
    expect(source).not.toMatch(/two minutes|2 minutes/i);
    expect(source).not.toMatch(/book,? and pay/i);
  });

  it("keeps Start setup inside the no-write visual walkthrough", () => {
    expect(source).toContain('isPreview ? "?__preview=1" : ""');
    expect(source).toContain("previewMode={isPreview}");
  });
});
