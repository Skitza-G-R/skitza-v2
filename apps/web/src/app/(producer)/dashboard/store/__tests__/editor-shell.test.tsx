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

  it("renders Back, Continue, and Save labels in the footer", () => {
    expect(SRC).toContain("Back");
    expect(SRC).toContain("Continue");
    expect(SRC).toContain("Save");
  });

  it("renders mode-aware Save label (Create product on new, Save changes on edit)", () => {
    expect(SRC).toMatch(/Create product/);
    expect(SRC).toMatch(/Save changes/);
    expect(SRC).toMatch(/mode === "new"/);
  });

  it("has a close X button in the header", () => {
    expect(SRC).toMatch(/aria-label="Close"/);
  });

  it("uses popIn animation per the design brief", () => {
    expect(SRC).toMatch(/popIn|scale\(0\.97\)|translateY\(12/);
  });
});
