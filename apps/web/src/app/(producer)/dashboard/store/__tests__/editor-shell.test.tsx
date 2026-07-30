import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "editor-shell.tsx"), "utf8");

describe("EditorShell shell", () => {
  it("uses Radix Dialog for portal + scrim", () => {
    expect(SRC).toMatch(/@radix-ui\/react-dialog/);
  });

  it("renders the step indicator label (Step N of M)", () => {
    expect(SRC).toMatch(/Step\s+\$\{|Step \$/);
  });

  it("renders the StepBar component", () => {
    expect(SRC).toMatch(/<StepBar/);
  });

  it("renders Back and Continue labels in the footer", () => {
    expect(SRC).toContain("Back");
    expect(SRC).toContain("Continue");
  });

  it("makes publish explicit and offers an atomic hidden alternative", () => {
    expect(SRC).toMatch(/Publish product/);
    expect(SRC).toMatch(/Save hidden/);
    expect(SRC).toMatch(/Publishing makes this visible to connected artists immediately/);
  });

  it("labels edits according to their current visibility", () => {
    expect(SRC).toMatch(/Save live changes/);
    expect(SRC).toMatch(/Save hidden changes/);
    expect(SRC).toMatch(/Artists will see this update immediately/);
  });

  it("keeps discard separate from the close button", () => {
    expect(SRC).toMatch(/Discard draft/);
    expect(SRC).toMatch(/onDiscard/);
  });

  it("has a close X button in the header", () => {
    expect(SRC).toMatch(/aria-label="Close"/);
  });

  it("uses popIn animation per the design brief", () => {
    expect(SRC).toMatch(/popIn|scale\(0\.97\)|translateY\(12/);
  });

  it("uses the wider desktop modal and a true full-screen mobile flow", () => {
    expect(SRC).toContain("max-w-[680px]");
    expect(SRC).toContain("max-sm:inset-0");
    expect(SRC).toContain("max-sm:h-[100dvh]");
    expect(SRC).toContain("max-sm:max-h-none");
    expect(SRC).not.toContain("max-sm:max-h-[92dvh]");
  });

  it("wraps the final action row and clears the iOS home indicator", () => {
    expect(SRC).toMatch(/max-sm:flex-wrap/);
    expect(SRC).toMatch(/safe-area-inset-bottom/);
  });

  it("keeps only the body scrollable and allows instructions to wrap", () => {
    expect(SRC.match(/overflow-y-auto/g)).toHaveLength(1);
    expect(SRC).toMatch(/whitespace-normal/);
    expect(SRC).not.toMatch(/DialogPrimitive\.Description[^>]*truncate/);
  });

  it("resets the body scroll position when the active step changes", () => {
    expect(SRC).toMatch(/useLayoutEffect/);
    expect(SRC).toMatch(/bodyRef\.current\.scrollTop\s*=\s*0/);
    expect(SRC).toMatch(/\[current, open\]/);
  });
});
